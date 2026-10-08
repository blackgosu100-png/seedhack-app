// 리스트업 → 대표님 양식 그대로의 엑셀. 계산 칸은 엑셀 수식(설정 시트의 계수 참조)이라 엑셀에서 바꿔도 다시 계산된다.
import ExcelJS from "exceljs";
import { net } from "electron";

const IMG = "https://thumbnail6.coupangcdn.com/thumbnails/remote/230x230ex/image/";
const imgUrl = (p) => (!p ? "" : /^https?:/.test(p) ? p : IMG + String(p).replace(/^\//, ""));
// 엑셀은 png·jpeg만 넣을 수 있어 webp 등은 건너뛴다
async function fetchImage(p) {
  try {
    const res = await net.fetch(imgUrl(p), { headers: { Accept: "image/jpeg,image/png;q=0.9" } });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    const ext = /png/i.test(type) ? "png" : /jpe?g/i.test(type) ? "jpeg" : null;
    return ext ? { buffer: Buffer.from(await res.arrayBuffer()), extension: ext } : null;
  } catch { return null; }
}

export const COLS = [
  ["대표키워드", 14], ["월검색량", 9], ["서브키워드", 14], ["월검색량", 9], ["소싱이유", 30], ["판매전략", 30],
  ["1페이지최고가", 11], ["1페이지최저가", 11], ["내판매가", 10], ["상품명", 28], ["벤치마킹URL", 24], ["중국URL", 24],
  ["위안", 8], ["원가", 9], ["세변의합", 8], ["입출고비/배송비", 11], ["판매가", 10], ["쿠팡수수료", 10], ["마진", 10], ["마진율", 8],
  ["월판매량", 9], ["원가", 12], ["매출", 13], ["마진", 12], ["광고비", 12], ["순이익", 12], ["투자대비수익율(ROI)", 12],
  // 우리 프로그램이 덧붙이는 열 (벤치마킹 상품의 실지표)
  ["벤치마킹 28일 판매", 11], ["벤치마킹 28일 조회", 11], ["벤치마킹 전환율", 10], ["광고 판정", 14], ["1개당 광고비", 11],
  ["사진", 11],
];

export async function buildListupXlsx(rows, s, filePath) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "쿠팡 소싱 신호등";
  const ws = wb.addWorksheet("리스트업", { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  const cfg = wb.addWorksheet("설정");
  cfg.columns = [{ width: 22 }, { width: 12 }, { width: 50 }];
  cfg.addRows([
    ["항목", "값", "설명"],
    ["원가 계수(원/위안)", s.fx, "위안 × 계수 = 한국 도착 원가 (암산용 300, 실제는 품목·물량에 따라 다름)"],
    ["쿠팡 수수료율", s.fee, "부가세 포함 11.88% / 별도 10.8%"],
    ["광고비 비율", s.adRate, "매출 대비 광고비"],
  ]);
  cfg.getRow(1).font = { bold: true };
  cfg.getCell("B3").numFmt = "0.00%"; cfg.getCell("B4").numFmt = "0%";
  ["B2", "B3", "B4"].forEach((a) => (cfg.getCell(a).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } }));

  ws.columns = COLS.map(([, w]) => ({ width: w }));
  ws.getRow(1).values = COLS.map(([h]) => (h === "광고비" ? `광고비 ${Math.round(s.adRate * 100)}%` : h));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).height = 30;
  ws.getRow(1).eachCell((c, i) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i > 27 ? "FF0F5C3F" : "FF23345A" } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  const AD = { go: "광고 시 여유", warn: "광고 시 빠듯", stop: "광고 시 적자", off: "광고 안 함" };
  const pics = await Promise.all(rows.map((r) => (r.img ? fetchImage(r.img) : null)));
  rows.forEach((r, i) => {
    const n = i + 2;
    const v = (x) => (x === "" || x == null || Number.isNaN(+x) ? null : +x);
    const row = ws.getRow(n);
    row.values = [
      r.keyword, v(r.kwVol), r.subKw || "", v(r.subVol), r.reason || "", r.strategy || "",
      v(r.maxPrice), v(r.minPrice), v(r.myPrice), r.name || "",
      r.benchUrl ? { text: "쿠팡", hyperlink: r.benchUrl } : "", r.cnUrl ? { text: "1688", hyperlink: r.cnUrl } : "",
      v(r.yuan), { formula: `IF(M${n}="","",M${n}*설정!$B$2)` }, v(r.size), v(r.logi), v(r.price),
      { formula: `IF(Q${n}="","",Q${n}*설정!$B$3)` }, { formula: `IF(OR(Q${n}="",N${n}=""),"",Q${n}-N${n}-P${n}-R${n})` },
      { formula: `IF(S${n}="","",S${n}/Q${n})` }, v(r.monthly),
      { formula: `IF(OR(N${n}="",U${n}=""),"",N${n}*U${n})` }, { formula: `IF(OR(Q${n}="",U${n}=""),"",Q${n}*U${n})` },
      { formula: `IF(OR(S${n}="",U${n}=""),"",S${n}*U${n})` }, { formula: `IF(W${n}="","",W${n}*설정!$B$4)` },
      { formula: `IF(X${n}="","",X${n}-Y${n})` }, { formula: `IF(OR(Z${n}="",V${n}="",V${n}=0),"",Z${n}/V${n})` },
      v(r.bSales), v(r.bViews), v(r.bCvr), r.ad ? AD[r.ad] : "", v(r.cpa),
    ];
    row.alignment = { vertical: "top", wrapText: true };
    [2, 4, 7, 8, 9, 14, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 28, 29].forEach((c) => (row.getCell(c).numFmt = "#,##0"));
    [20, 27, 30].forEach((c) => (row.getCell(c).numFmt = "0.00%"));
    row.getCell(32).numFmt = "#,##0";
    [5, 6, 9, 12, 13, 15, 16, 17, 21].forEach((c) => (row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9E6" } }));
    if (pics[i]) {
      row.height = 62;
      ws.addImage(wb.addImage(pics[i]), { tl: { col: 32 + 0.1, row: n - 1 + 0.08 }, ext: { width: 72, height: 72 } });
    }
    if (r.ad) row.getCell(31).fill = { type: "pattern", pattern: "solid", fgColor: { argb: { go: "FFC6EFCE", warn: "FFFFEB9C", stop: "FFFFC7CE" }[r.ad] } };
  });
  ws.autoFilter = { from: "A1", to: { row: 1, column: COLS.length } };
  await wb.xlsx.writeFile(filePath);
  return filePath;
}

// 📦 수집함 원본 — 필터로 보이는 그대로. 엑셀에서 피벗·추가 필터용
export async function buildCollectXlsx(rows, s, filePath) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "쿠팡 소싱 신호등";
  const ws = wb.addWorksheet("수집함", { views: [{ state: "frozen", ySplit: 1 }] });
  const AD = { go: "광고 시 여유", warn: "광고 시 빠듯", stop: "광고 시 적자" };
  ws.columns = [
    ["검색어", 14], ["순위", 7], ["광고 제외 순위", 9], ["광고 칸", 7], ["상품명", 44], ["판매가", 10], ["리뷰", 8], ["배송", 10], ["쿠팡 PB", 7],
    ["28일 판매", 10], ["판매액", 13], ["28일 조회", 10], ["전환율", 8], ["광고 판정", 14], ["1개당 광고비", 12], ["지표 받은 날", 18], ["상품 URL", 30],
  ].map(([header, width]) => ({ header, width }));
  rows.forEach((r) => ws.addRow([
    r.query, r.rank ?? null, r.organic ?? null, r.adSlot ? "광고" : "", r.name, r.price ?? null, r.reviews ?? null, r.ship || (r.rocket ? "로켓" : ""), r.pb ? "PB" : "",
    r.sales ?? null, r.rev ?? null, r.views ?? null, r.cvr ?? null, r.ad ? AD[r.ad] : "", r.cpa != null ? Math.round(r.cpa) : null, r.ts ? new Date(r.ts) : null, r.url ? { text: "쿠팡", hyperlink: r.url } : "",
  ]));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF23345A" } }));
  ["F", "G", "J", "K", "L"].forEach((c) => (ws.getColumn(c).numFmt = "#,##0"));
  ws.getColumn("M").numFmt = "0.0%";
  ws.getColumn("O").numFmt = "#,##0";
  ws.getColumn("P").numFmt = "yyyy-mm-dd hh:mm";
  ws.autoFilter = { from: "A1", to: { row: 1, column: 17 } };
  const note = ws.getRow(rows.length + 3);
  note.getCell(1).value = `광고 판정: 1개당 광고비(클릭비용 ${s.cpc}원 ÷ (전환율 × 광고 전환 ${Math.round((s.conv || 0.4) * 100)}%)) vs 1개 마진(판매가 × ${Math.round(s.margin * 100)}%)${s.ads === false ? " · 광고 안 함 설정" : ""} · 판매량·조회수는 Wing 기준 최근 28일`;
  note.getCell(1).font = { italic: true, color: { argb: "FF71717A" } };
  await wb.xlsx.writeFile(filePath);
  return filePath;
}
