// 1688 상품 페이지의 상세 설명·속성표 글자에서 크기·무게·박스 수량을 읽는다 (순수 로직, Node로 테스트 가능)
// 리스트업의 🚚 물류 칸(크기 mm 가로×세로×높이, 무게 g)에 넣어 로켓그로스 입출고비를 자동 계산하게 한다.
// 상세 글에 "一层 55*15*10CM 二层 55.5*15*10cm"처럼 변형별 값이 섞여 있으면, 고른 옵션명과 겹치는 변형(一层/二层, 大/小 …)을 고른다.

const DIM_RE = /(\d+(?:\.\d+)?)\s*[*×xX＊]\s*(\d+(?:\.\d+)?)\s*[*×xX＊]\s*(\d+(?:\.\d+)?)\s*(mm|MM|cm|CM|厘米|毫米|m\b|M\b)?/g;
const WT_RE = /(\d+(?:\.\d+)?)\s*(kg|KG|Kg|公斤|千克|g|G|克|斤)/g;

const toMm = (v, unit) => { const u = String(unit || "cm").toLowerCase(); return u === "mm" || unit === "毫米" ? v : u === "m" ? v * 1000 : v * 10; }; // 단위 없으면 cm로 본다(1688 관행)
const toG = (v, unit) => { const u = String(unit || "").toLowerCase(); if (u === "kg" || unit === "公斤" || unit === "千克") return v * 1000; if (unit === "斤") return v * 500; return v; };

// "一层120*74.5*35CM 二层70*36*175cm" → [{tag:"一层", mm:[1200,745,350]}, {tag:"二层", mm:[700,360,1750]}]
function dimsWithTags(seg) {
  const out = [];
  let last = 0;
  for (const m of seg.matchAll(DIM_RE)) {
    const before = seg.slice(last, m.index).replace(/[:：\s]+$/, "");
    const tag = (before.match(/([^\s:：,，/、()（）]{1,8})$/) || [])[1] || "";
    out.push({ tag, mm: [m[1], m[2], m[3]].map((x) => Math.round(toMm(Number(x), m[4]))), raw: m[0].trim() });
    last = m.index + m[0].length;
  }
  return out;
}
function weightsWithTags(seg) {
  const out = [];
  let last = 0;
  for (const m of seg.matchAll(WT_RE)) {
    const before = seg.slice(last, m.index).replace(/[:：\s]+$/, "");
    const tag = (before.match(/([^\s:：,，/、()（）\d.]{1,8})$/) || [])[1] || "";
    out.push({ tag, g: Math.round(toG(Number(m[1]), m[2])), raw: m[0].trim() });
    last = m.index + m[0].length;
  }
  return out;
}

// 라벨 뒤의 한 줄(다음 라벨 전까지)
const LABELS = ["包装尺寸", "产品尺寸", "商品尺寸", "尺寸", "单个重量", "产品重量", "商品重量", "单品重量", "净重", "重量", "整箱规格", "外箱尺寸", "整箱毛重", "毛重", "装箱数量", "箱装数量", "每箱"];
function segment(text, label) {
  const i = text.indexOf(label);
  if (i < 0) return "";
  let end = text.length;
  for (const l of LABELS) { if (l === label) continue; const j = text.indexOf(l, i + label.length); if (j > 0 && j < end) end = j; }
  const nl = text.indexOf("\n", i); if (nl > 0 && nl < end) end = nl;
  return text.slice(i + label.length, end);
}

// 옵션명과 겹치는 변형 고르기 (一层/二层, 大号/小号, 색 등). 없으면 첫 번째.
function pickByOption(list, optionLabel) {
  if (!list.length) return null;
  const opt = String(optionLabel || "");
  if (opt) {
    const hit = list.find((x) => x.tag && opt.includes(x.tag)) || list.find((x) => x.tag && [...x.tag].some((ch) => /[一二三四大中小]/.test(ch) && opt.includes(ch + (x.tag.includes("层") ? "层" : ""))));
    if (hit) return { ...hit, matched: true };
  }
  return { ...list[0], matched: list.length === 1 };
}

// text: 상세 설명 글자, attrText: 속성표 글자("重量(g) 1385 箱装数量 16 …"), optionLabel: 고른 옵션명
export function parseSpecs({ text = "", attrText = "", optionLabel = "" } = {}) {
  const t = String(text).replace(/\r/g, "").replace(/[ \t]+/g, " ");
  const a = String(attrText).replace(/\s+/g, " ");
  const out = { pkgMm: null, productMm: null, g: null, cartonQty: null, source: [], ambiguous: false };

  // 1) 포장 크기(로켓그로스 입출고는 포장 기준) → 없으면 제품 크기
  for (const [label, key] of [["包装尺寸", "pkgMm"], ["产品尺寸", "productMm"], ["商品尺寸", "productMm"]]) {
    const list = dimsWithTags(segment(t, label));
    if (list.length && !out[key]) { const p = pickByOption(list, optionLabel); out[key] = p.mm; out.source.push(`${label} ${p.raw}${p.tag ? ` (${p.tag})` : ""}`); if (!p.matched && list.length > 1) out.ambiguous = true; }
  }
  if (!out.pkgMm && !out.productMm) { // 라벨 없이 "尺寸"만 있거나 속성표에 있는 경우
    const list = dimsWithTags(segment(t, "尺寸") || segment(a, "尺寸"));
    if (list.length) { const p = pickByOption(list, optionLabel); out.productMm = p.mm; out.source.push(`尺寸 ${p.raw}`); if (!p.matched && list.length > 1) out.ambiguous = true; }
  }
  // 2) 무게: 개당 무게 우선, 整箱毛重(박스 총중량)은 제외
  for (const label of ["单个重量", "产品重量", "商品重量", "单品重量", "净重", "重量"]) {
    const seg = segment(t, label);
    const list = weightsWithTags(seg);
    if (list.length) { const p = pickByOption(list, optionLabel); out.g = p.g; out.source.push(`${label} ${p.raw}${p.tag ? ` (${p.tag})` : ""}`); if (!p.matched && list.length > 1) out.ambiguous = true; break; }
  }
  if (out.g == null) { // 속성표 "重量(g) 1385" / "重量 1.2kg"
    const m = a.match(/重量\s*\(?\s*(g|kg|克|公斤)?\s*\)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(g|kg|克|公斤)?/i);
    if (m) { const unit = m[3] || m[1] || "g"; out.g = Math.round(toG(Number(m[2]), unit)); out.source.push(`속성 重量 ${m[2]}${unit}`); }
  }
  // 3) 박스당 수량
  for (const label of ["装箱数量", "箱装数量", "每箱"]) {
    const seg = segment(t, label) || segment(a, label);
    const list = [...seg.matchAll(/([^\s:：,，/]{0,6}?)\s*(\d{1,4})\s*(?:个|套|件|只|pcs|PCS)?\s*\/?\s*箱?/g)].map((m) => ({ tag: m[1] || "", n: Number(m[2]) })).filter((x) => x.n > 0 && x.n < 10000);
    if (list.length) { const p = pickByOption(list, optionLabel); out.cartonQty = p.n; out.source.push(`${label} ${p.n}/箱${p.tag ? ` (${p.tag})` : ""}`); break; }
  }
  const mm = out.pkgMm || out.productMm;
  out.dims = mm ? mm.join("x") : "";          // 리스트업 "크기 mm" 칸 형식
  out.dimsFrom = out.pkgMm ? "포장" : out.productMm ? "제품" : "";
  out.found = !!(mm || out.g != null || out.cartonQty != null);
  return out;
}
