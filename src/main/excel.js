// 판정 결과를 진짜 엑셀(xlsx) 파일로 저장 — 상품 썸네일 이미지까지 셀에 넣는다.
import ExcelJS from "exceljs";
import { net } from "electron";

const IMG = "https://thumbnail6.coupangcdn.com/thumbnails/remote/230x230ex/image/";
const imgUrl = (p) => (!p ? "" : /^https?:/.test(p) ? p : IMG + String(p).replace(/^\//, ""));
const FILL = { go: "FFC6EFCE", warn: "FFFFEB9C", stop: "FFFFC7CE" };
const LT = { go: "초록", warn: "노랑", stop: "빨강" };

export async function buildXlsx(payload, filePath, log) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "쿠팡 소싱 신호등";
  const ws = wb.addWorksheet("상품 판정", { views: [{ state: "frozen", ySplit: 4 }] });
  ws.mergeCells("A1:Q1");
  ws.getCell("A1").value = `쿠팡 소싱 신호등 — ${payload.path ? payload.path + " > " : ""}${payload.name} (${payload.date})`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells("A2:Q2");
  ws.getCell("A2").value = `카테고리 판정: ${payload.verdict}  ·  1688 허용 소싱가: ${payload.yuan > 0 ? "¥" + payload.yuan.toFixed(1) + " 이하" : "없음"}  ·  목표 판매가 ${payload.target ? payload.target.toLocaleString() + "원" : "-"}  ·  데이터: Wing 쿠팡 트렌드 실데이터`;
  const head = ["이미지", "순위", "상품명", "브랜드", "판매가", "평점", "리뷰수", "28일 조회(구간)", "28일 조회(정확)", "28일 판매량", "전환율", "신호",
    "전환율(중앙 대비)", "최대 ROAS", "본전 ROAS", "광고 판정", "최적 CPC(원)"];
  ws.getRow(4).values = head;
  ws.getRow(4).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(4).eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF23345A" } }; c.alignment = { vertical: "middle", horizontal: "center" }; });
  [10, 6, 46, 14, 11, 7, 9, 16, 13, 12, 9, 8, 13, 11, 10, 16, 12].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const AD = { go: "광고 여유", warn: "광고 빠듯", stop: "광고로 이익 불가" };

  const items = payload.items;
  for (let i = 0; i < items.length; i++) {
    const it = items[i], r = 5 + i, ex = it.ex;
    const range = it.pvLo == null ? "" : Math.max(0, it.pvLo) === 0 ? `~${it.pvHi}` : `${it.pvLo}~${it.pvHi}`;
    const row = ws.getRow(r);
    row.values = ["", it.order, it.name, it.brand, it.price, it.rating, it.reviews, range, ex?.views ?? "", ex?.sales ?? "",
      ex?.sales != null && ex?.views ? ex.sales / ex.views : "", LT[it.light],
      it.rel != null ? `${it.rel.toFixed(2)}배${it.hot === "hot" ? " 🔥" : it.hot === "cold" ? " ❄" : ""}` : "",
      it.maxRoas != null ? it.maxRoas : "", it.maxRoas != null ? it.endRoas : "", it.ad ? AD[it.ad] : "", it.optCpc != null ? Math.round(it.optCpc) : ""];
    row.height = 60;
    row.getCell(3).value = { text: it.name, hyperlink: `https://www.coupang.com/vp/products/${it.pid}?vendorItemId=${it.vid ?? ""}` };
    row.getCell(3).font = { color: { argb: "FF0563C1" }, underline: true };
    row.getCell(5).numFmt = "#,##0"; row.getCell(7).numFmt = "#,##0"; row.getCell(9).numFmt = "#,##0"; row.getCell(10).numFmt = "#,##0"; row.getCell(11).numFmt = "0.0%";
    row.getCell(12).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[it.light] } };
    row.getCell(14).numFmt = "0%"; row.getCell(15).numFmt = "0%";
    if (it.ad) row.getCell(16).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[it.ad] } };
    row.eachCell((c) => { c.alignment = { ...(c.alignment || {}), vertical: "middle", wrapText: c.col === 3 }; });
    // 썸네일 내려받아 넣기
    if (it.img) {
      try {
        const res = await net.fetch(imgUrl(it.img));
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const ext = /png/i.test(res.headers.get("content-type") || "") ? "png" : "jpeg";
          const id = wb.addImage({ buffer: buf, extension: ext });
          ws.addImage(id, { tl: { col: 0.1, row: r - 1 + 0.08 }, ext: { width: 72, height: 72 } });
        }
      } catch {}
    }
    log?.("dim", `  ${i + 1}/${items.length} ${it.name.slice(0, 26)}${it.img ? " · 이미지 포함" : ""}`, (i + 1) / items.length);
  }
  await wb.xlsx.writeFile(filePath);
  return filePath;
}
