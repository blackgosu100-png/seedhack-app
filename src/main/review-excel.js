// 📝 리뷰 분석 → 엑셀. 시트: 요약 · 날짜별 · 리뷰 원문 · 조회 이력. 원문 시트는 필터·틀 고정(엑셀식으로 바로 거르기).
import ExcelJS from "exceljs";
import { normalizeReviews } from "../shared/review-core.js";

const HEAD = { font: { bold: true, color: { argb: "FF18181B" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F5" } } };
const HOT = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF2F2" } };
const pct = (v) => (v == null ? null : Math.round(v * 1000) / 1000);

function table(ws, cols, rows) {
  ws.columns = cols.map(([header, width]) => ({ header, width }));
  ws.getRow(1).eachCell((c) => Object.assign(c, HEAD));
  rows.forEach((r) => ws.addRow(r));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
}

// doc: 저장 파일 내용 { pid, name, ts, total, reviews, analysis } · runs: 조회 이력
export async function buildReviewXlsx(doc, runs, filePath) {
  const a = doc.analysis;
  const wb = new ExcelJS.Workbook();
  wb.creator = "씨드핵";
  const seg = (date) => (!a.burst ? "" : date < a.burst.from ? "작업 전" : date <= a.burst.to ? "의심 구간" : "이후");

  // 1. 요약
  const s = wb.addWorksheet("요약");
  s.columns = [{ width: 22 }, { width: 18 }, { width: 18 }, { width: 18 }];
  const line = (k, v) => { const r = s.addRow([k, v]); r.getCell(1).font = { bold: true, color: { argb: "FF71717A" } }; return r; };
  s.addRow([doc.name || doc.pid]).font = { bold: true, size: 14 };
  line("상품 번호", doc.pid);
  line("상품 주소", `https://www.coupang.com/vp/products/${doc.pid}`);
  line("조회 시각", new Date(doc.ts).toLocaleString("ko-KR"));
  line("받은 리뷰", `${a.got.toLocaleString("ko-KR")}개${a.total ? ` / 전체 ${Number(a.total).toLocaleString("ko-KR")}개` : ""}`);
  line("기간", `${a.firstDate} ~ ${a.lastDate}`);
  if (a.older) line("가장 오래된 리뷰", `${a.older.oldest} (1,500개 너머 일부 ${a.older.n}개에서)`);
  line("의심 구간", a.burst ? `${a.burst.from} ~ ${a.burst.to} · ${a.burst.n}개 (${Math.round((a.burst.n / a.got) * 100)}%)` : "없음");
  line("의심 신호", a.burst ? `${a.suspect} / ${a.signals.length - 1} (참고 지표)` : "-");
  line("최근 30일 하루", `${a.recent.perDay.toFixed(1)}개`);
  s.addRow([]);
  if (a.signals.length) { s.addRow(["의심 신호"]).font = { bold: true }; a.signals.forEach((g) => s.addRow([g.on ? "●" : "○", g.text]).getCell(2).font = { color: { argb: g.on ? "FFB91C1C" : "FFA1A1AA" } }); s.addRow([]); }
  a.notes.forEach((n) => s.addRow(["참고", n]));
  s.addRow([]);
  const cols = a.burst ? [["작업 전", a.seg.pre], ["의심 구간", a.seg.burst], ["이후", a.seg.post]] : [["전체", a.seg.all]];
  const hr = s.addRow(["구간 비교", ...cols.map(([h]) => h)]);
  hr.eachCell((c) => Object.assign(c, HEAD));
  [["리뷰 수", "n"], ["기간(일)", "days"], ["하루 평균", "perDay"], ["5점", "r5", 1], ["1~3점", "low", 1], ["내용 없음", "empty", 1], ["100자+ 긴 글", "long", 1], ["평균 글자 수", "avgLen"], ["사진", "photo", 1], ["체험단·제공", "exp", 1]].forEach(([k, f, isPct]) => {
    const r = s.addRow([k, ...cols.map(([, g]) => (g && g.n ? (isPct ? pct(g[f]) : g[f] == null ? null : f === "perDay" ? Math.round(g[f] * 100) / 100 : Math.round(g[f] * 10) / 10) : null))]);
    if (isPct) for (let i = 2; i <= cols.length + 1; i++) r.getCell(i).numFmt = "0%";
    if (a.burst) r.getCell(3).fill = HOT;
  });
  if (a.options?.length) {
    s.addRow([]);
    const oh = s.addRow(["옵션", "리뷰 수", "비율"]); oh.eachCell((c) => Object.assign(c, HEAD));
    a.options.forEach((o) => { const r = s.addRow([o.name, o.n, pct(o.share)]); r.getCell(3).numFmt = "0%"; });
  }

  // 2. 날짜별 (리뷰가 있는 날만이 아니라 첫 리뷰부터 매일)
  const rs = normalizeReviews((doc.reviews || []).filter((r) => r && !r.partial));
  const byDay = new Map();
  rs.forEach((r) => { const d = byDay.get(r.date) || { n: 0, r5: 0, low: 0 }; d.n++; if (r.rating === 5) d.r5++; if (r.rating <= 3) d.low++; byDay.set(r.date, d); });
  const days = [];
  for (let t = Date.parse(a.firstDate); t <= Date.parse(a.today); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
  const d = wb.addWorksheet("날짜별");
  table(d, [["날짜", 12], ["리뷰 수", 9], ["5점", 7], ["1~3점", 8], ["구간", 11]], days.map((day) => { const v = byDay.get(day) || { n: 0, r5: 0, low: 0 }; return [day, v.n, v.r5, v.low, seg(day)]; }));
  d.eachRow((r, i) => { if (i > 1 && r.getCell(5).value === "의심 구간") r.eachCell((c) => (c.fill = HOT)); });

  // 3. 리뷰 원문
  const part = normalizeReviews((doc.reviews || []).filter((r) => r && r.partial));
  const w = wb.addWorksheet("리뷰 원문");
  table(w, [["날짜", 12], ["별점", 6], ["구간", 10], ["옵션", 34], ["내용", 80], ["글자 수", 8], ["사진", 6], ["체험단·제공", 10], ["수집", 10]],
    [...rs.map((r) => [r.date, r.rating, seg(r.date), r.opt, r.text, r.text.length, r.photos, r.exp ? "예" : "", "최신순"]),
     ...part.map((r) => [r.date, r.rating, "", r.opt, r.text, r.text.length, r.photos, r.exp ? "예" : "", "일부(1,500 너머)"])]);
  w.getColumn(5).alignment = { wrapText: true, vertical: "top" };

  // 4. 조회 이력
  const h = wb.addWorksheet("조회 이력");
  table(h, [["조회 시각", 20], ["전체 리뷰", 10], ["받은 리뷰", 10], ["의심 구간", 24], ["의심 신호", 9]],
    (runs || []).map((x) => [new Date(x.ts).toLocaleString("ko-KR"), x.total, x.got, x.burst ? `${x.burst.from} ~ ${x.burst.to}` : "", x.burst ? x.suspect : ""]));

  await wb.xlsx.writeFile(filePath);
}
