// 🧲 내 템플릿 보관함(2단계) — 레퍼런스 분석 결과(reference.json)를 "내 템플릿"으로 저장·고르기·공유한다 (docs/detail/BENCHMARK-TEMPLATE-PLAN.md 3장)
//   template.json = reference.json 에서 ocr_lines·measured(측정 원자료)·섹션 원문(title) 을 뺀 것 + 이름·분류·출처·overrides(세부 조정)·version
//   보관함: <root>/<id>/template.json (+ guard.json = 표절 가드용 OCR 줄, 내보내기에서 제외 · ref/ = 레퍼런스 이미지 사본)
//   공유: .seedtpl.json 한 파일로 내보내기/가져오기(카톡·강의 자료). 같은 쿠팡 주소·같은 폴더는 sourceKey 로 다시 분석하지 않는다.
// 전자(electron)·AI 호출 없음 — node --test 대상(test/detail/templates.test.js). 파일 보관함은 root 를 받아 어디서든(임시 폴더) 쓸 수 있다.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { TOKEN_ENUM, normalizeTokens, getPath, setPath } from "./reference-core.js";

const S = (v) => (v == null ? "" : String(v)).trim();
const HEX = /^#[0-9a-f]{6}$/i;
const hexOk = (x) => (HEX.test(S(x)) ? S(x).toLowerCase() : null);
export const TEMPLATE_VERSION = 1;
export const EXPORT_EXT = ".seedtpl.json";
export const ID_RE = /^tpl_[0-9]{8}_[a-z0-9]{4,8}$/;

// ── 1. 손잡이(토큰) 세부 조정 ──
// 사용자가 "세부 조정"에서 바꿀 수 있는 손잡이 — 칩(enum)·색(hex)·숫자. 화면·검증이 같은 표를 본다.
export const OVERRIDE_KEYS = {
  align: { label: "글 정렬", kind: "enum", values: TOKEN_ENUM.align, ko: { center: "가운데", left: "왼쪽" } },
  spacing: { label: "여백", kind: "enum", values: TOKEN_ENUM.spacing, ko: { tight: "촘촘", normal: "보통", airy: "넉넉" } },
  kicker: { label: "키커(POINT n)", kind: "enum", values: TOKEN_ENUM.kicker, ko: { none: "없음", "pill-dark": "어두운 알약", "pill-brand": "브랜드 알약", text: "글자만" } },
  bands: { label: "어두운 띠", kind: "enum", values: TOKEN_ENUM.bands, ko: { none: "없음", alternate: "밝음↔어두움 교대" } },
  problem: { label: "문제 제기", kind: "enum", values: TOKEN_ENUM.problem, ko: { "dark-bubble": "어두운 말풍선", plain: "글만", panel: "판" } },
  photo: { label: "사진 모양", kind: "enum", values: TOKEN_ENUM.photo, ko: { full: "꽉 찬", rounded: "둥근", card: "카드" } },
  emph: { label: "강조", kind: "enum", values: TOKEN_ENUM.emph, ko: { "line-color": "둘째 줄 색", weight: "굵게", underline: "밑줄", none: "없음" } },
  icons: { label: "아이콘", kind: "enum", values: TOKEN_ENUM.icons, ko: { "brand-fill": "브랜드 색 채움", light: "연한", "text-line": "글자 한 줄", none: "없음" } },
  panel: { label: "정보 판", kind: "enum", values: TOKEN_ENUM.panel, ko: { lines: "줄", gray: "회색 판", cards: "카드" } },
  hero: { label: "첫 화면 글", kind: "enum", values: TOKEN_ENUM.hero, ko: { "on-photo": "사진 위", above: "사진 위쪽(밖)" } },
  notice: { label: "안내 판", kind: "enum", values: TOKEN_ENUM.notice, ko: { dark: "어두운", same: "바탕과 같게" } },
  title_size: { label: "제목 크기", kind: "number", min: 34, max: 56 },
  title_weight: { label: "제목 굵기", kind: "number", min: 500, max: 900, step: 100 },
  radius: { label: "모서리", kind: "number", min: 0, max: 36 },
  "colors.brand": { label: "강조 색", kind: "color" },
  "colors.bg": { label: "바탕 색", kind: "color" },
  "colors.dark": { label: "어두운 띠 색", kind: "color" },
  "colors.ink": { label: "글자 색", kind: "color" },
};
// 한 칸 값 검증 → 정규화된 값, 못 쓰는 값이면 undefined
export function normalizeOverride(key, value) {
  const d = OVERRIDE_KEYS[key]; if (!d) return undefined;
  if (d.kind === "enum") return d.values.includes(value) ? value : undefined;
  if (d.kind === "color") return value === null || value === "" ? null : hexOk(value) || undefined; // null = 색 없음(brand 끄기)
  const n = Number(value); if (!Number.isFinite(n)) return undefined;
  const v = Math.max(d.min, Math.min(d.max, d.step ? Math.round(n / d.step) * d.step : Math.round(n)));
  return v;
}
// overrides 전체 정리(모르는 키·못 쓰는 값은 버림)
export function cleanOverrides(overrides = {}) {
  const out = {};
  for (const [k, v] of Object.entries(overrides || {})) { const n = normalizeOverride(k, v); if (n !== undefined) out[k] = n; }
  return out;
}
// tokens + overrides → 새 tokens(원본은 건드리지 않음). 브랜드 색을 끄면(null) 브랜드 색을 쓰는 손잡이는 무채색 대안으로(normalizeTokens 와 같은 규칙)
export function applyOverrides(tokens = {}, overrides = {}) {
  const out = JSON.parse(JSON.stringify(tokens || {}));
  out.colors = out.colors || {};
  for (const [k, v] of Object.entries(cleanOverrides(overrides))) setPath(out, k, v);
  if (!out.colors.brand) { if (out.kicker === "pill-brand") out.kicker = "pill-dark"; if (out.icons === "brand-fill") out.icons = "light"; if (out.emph === "line-color" || out.emph === "underline") out.emph = "weight"; }
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, "photo") && out.photo && !Object.prototype.hasOwnProperty.call(overrides, "radius")) out.radius = out.photo === "full" ? 0 : out.photo === "card" ? 24 : 14;
  return out;
}
// 손잡이 칩 목록(화면용): 현재 값 = overrides 가 있으면 그 값, 없으면 템플릿 값
export function overrideChips(template = {}) {
  const tk = applyOverrides(template.tokens || {}, template.overrides || {});
  return Object.entries(OVERRIDE_KEYS).map(([key, d]) => ({ key, label: d.label, kind: d.kind, values: d.values || null, ko: d.ko || null, min: d.min, max: d.max, step: d.step || 1, value: getPath(tk, key) ?? null, changed: Object.prototype.hasOwnProperty.call(template.overrides || {}, key) }));
}

// ── 2. reference.json → template.json ──
const today = () => new Date().toISOString().slice(0, 10);
export const newId = (d = new Date()) => `tpl_${d.toISOString().slice(0, 10).replace(/-/g, "")}_${crypto.randomBytes(3).toString("hex")}`;
// 기본 이름 = 카테고리 + 상품명 앞 10자 (둘 다 없으면 날짜)
export function defaultName({ category = "", name = "", date = today() } = {}) {
  const cat = S(category).split(/\s*[>›]\s*/).filter(Boolean).pop() || ""; // "주방>수납" → "수납"
  const nm = S(name).replace(/\s+/g, " ").slice(0, 10).trim();
  return [cat, nm].filter(Boolean).join(" ") || `템플릿 ${date}`;
}
// 섹션: 원문(title·텍스트)은 남기지 않는다. 각도·역할·키커·모양 + 요지(gist, 20자) 만
const compactSection = (s, i) => {
  const gist = S(s.gist || s.angle).slice(0, 20);
  const o = { order: Number(s.order) || i + 1, our_type: S(s.our_type || s.type || "other"), role: S(s.role).slice(0, 30), angle: S(s.angle).slice(0, 60), layout: S(s.layout).slice(0, 30), kicker: S(s.kicker).slice(0, 20), gist };
  if (s.bg) o.bg = S(s.bg); // 측정된 바탕 종류(dark/light/photo/brand) — 좌표(y·tx·tw)는 뺀다
  return o;
};
// reference.json 전체 → 템플릿. tokens 가 없으면 { error }
export function fromReference(ref = {}, { id = newId(), name = "", category = "", madeBy = "본인", source = null, createdAt = Date.now() } = {}) {
  if (!ref || !ref.tokens || typeof ref.tokens !== "object") return { error: "레퍼런스에 손잡이(tokens)가 없습니다" };
  const src = source || {};
  const tpl = {
    id, version: TEMPLATE_VERSION, name: S(name).slice(0, 40) || defaultName({ category, name: src.productName || "" }), category: S(category).slice(0, 40), madeBy: S(madeBy).slice(0, 20) || "본인",
    source: { kind: S(src.kind || (src.url ? "coupang" : ref.source?.dir ? "folder" : "unknown")), url: S(src.url).slice(0, 300), productName: S(src.productName).slice(0, 80), capturedAt: S(src.capturedAt) || today(), key: S(src.key), files: Array.isArray(ref.source?.files) ? ref.source.files.length : 0 },
    tokens: JSON.parse(JSON.stringify(ref.tokens)),
    style: ref.style || null, styleFixed: ref.styleFixed || null,
    sections: (ref.sections || []).map(compactSection),
    copy: ref.copy && typeof ref.copy === "object" ? JSON.parse(JSON.stringify(ref.copy)) : {},
    avoid: [...new Set((ref.avoid || []).map(S).filter(Boolean))].slice(0, 16),
    overrides: {}, createdAt, updatedAt: createdAt,
    cost: ref.cost ? { usd: ref.cost.usd ?? null, ms: ref.cost.ms ?? null, model: ref.cost.model || null } : null,
  };
  return tpl;
}
// 가드용 OCR 줄(ocr_lines) — 템플릿 본문과 따로(guard.json). 내보내기에서 제외
export const guardFromReference = (ref = {}) => ({ ocr_lines: Array.isArray(ref.ocr_lines) ? ref.ocr_lines.map(S).filter(Boolean).slice(0, 400) : [] });
// 템플릿 → 파이프라인이 reference 로 쓰는 모양(index.js jobReference·plan-core·copy·render 가 보는 키 그대로) — overrides 적용, 가드 줄은 guard 에서
export function toReference(tpl = {}, { guard = null, keepExtra = false } = {}) {
  return {
    version: TEMPLATE_VERSION, fromTemplate: tpl.id, templateName: tpl.name, createdAt: Date.now(),
    source: { kind: tpl.source?.kind || "template", url: tpl.source?.url || "", files: [], dir: "" },
    tokens: applyOverrides(tpl.tokens || {}, tpl.overrides || {}), style: tpl.style || null, styleFixed: tpl.styleFixed || null,
    sections: (tpl.sections || []).map((s) => ({ ...s })), copy: tpl.copy || {}, avoid: tpl.avoid || [],
    ocr_lines: guard?.ocr_lines || [], measured: null, keepExtra: !!keepExtra, cost: null, error: null,
  };
}
// 기본 테마(index.js THEMES)도 같은 표 모양으로 — 보관함 목록에 섞어 보여 준다(tokens 없음 = card 엔진 테마)
export const themeAsTemplate = (t) => ({ id: t.id, kind: "theme", name: t.name, desc: t.desc || "", colors: t.colors || [], builtin: true });
// 템플릿 → 목록 카드(미니 미리보기 색 = [바탕, 판, 강조|어두운 띠])
export function summarize(tpl = {}) {
  const tk = applyOverrides(tpl.tokens || {}, tpl.overrides || {}), c = tk.colors || {};
  const n = (tpl.sections || []).length;
  return { id: tpl.id, kind: "mine", name: tpl.name, category: tpl.category || "", madeBy: tpl.madeBy || "", createdAt: tpl.createdAt || null, updatedAt: tpl.updatedAt || null,
    desc: [tpl.category, n ? `섹션 ${n}개` : "", tk.align === "left" ? "왼쪽 정렬" : "가운데 정렬", tk.bands === "alternate" ? "띠 교대" : "", tpl.source?.kind === "coupang" ? "쿠팡" : tpl.source?.kind === "import" ? "받은 템플릿" : ""].filter(Boolean).join(" · "),
    colors: [c.bg || "#ffffff", c.panel || "#f2f2f2", c.brand || c.dark || "#1c1f26"], sections: n, overrides: Object.keys(tpl.overrides || {}).length, source: { kind: tpl.source?.kind || "", url: tpl.source?.url || "" }, builtin: false };
}

// ── 3. 출처 열쇠(캐시): 같은 쿠팡 주소·같은 폴더는 다시 분석하지 않는다 ──
export function sourceKey({ url = "", dir = "", files = null } = {}) {
  const u = S(url);
  if (u) {
    const m = /coupang\.com\/vp\/products\/(\d+)/.exec(u); if (m) return `coupang:${m[1]}`;
    return `url:${crypto.createHash("sha1").update(u.replace(/[?#].*$/, "")).digest("hex").slice(0, 16)}`;
  }
  const list = Array.isArray(files) ? [...files].sort((a, b) => path.basename(a).localeCompare(path.basename(b))) : dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort().map((f) => path.join(dir, f)) : [];
  if (!list.length) return "";
  const h = crypto.createHash("sha1");
  for (const f of list) { let st = null; try { st = fs.statSync(f); } catch {} h.update(`${path.basename(f)}:${st?.size || 0}\n`); }
  return `folder:${h.digest("hex").slice(0, 16)}`;
}

// ── 4. 내보내기/가져오기(.seedtpl.json) ──
const EXPORT_DROP = ["cost"]; // 내보내기에서 빼는 칸(비용·로컬 정보). guard.json 은 파일 자체가 다르니 자연히 빠짐
export function toExport(tpl = {}) {
  const o = JSON.parse(JSON.stringify(tpl));
  for (const k of EXPORT_DROP) delete o[k];
  if (o.source) o.source = { kind: o.source.kind, url: o.source.url, productName: o.source.productName, capturedAt: o.source.capturedAt }; // key·files(로컬 캐시 열쇠) 는 빼고 URL 은 남긴다(출처 표시)
  return { seedtpl: TEMPLATE_VERSION, exportedAt: today(), template: o };
}
// 가져온 파일 → 템플릿(모양 검증·토큰 정규화·새 id). 못 읽으면 { error }
export function fromImport(obj = {}, { id = newId(), madeBy = "받음" } = {}) {
  const t = obj && obj.template && typeof obj.template === "object" ? obj.template : obj;
  if (!t || typeof t !== "object" || !t.tokens || typeof t.tokens !== "object") return { error: "템플릿 파일이 아닙니다(.seedtpl.json — tokens 가 없음)" };
  const tokens = sanitizeTokens(t.tokens);
  const tpl = {
    id, version: TEMPLATE_VERSION, name: S(t.name).slice(0, 40) || `받은 템플릿 ${today()}`, category: S(t.category).slice(0, 40), madeBy: S(t.madeBy && t.madeBy !== "본인" ? t.madeBy : madeBy).slice(0, 20),
    source: { kind: "import", url: S(t.source?.url).slice(0, 300), productName: S(t.source?.productName).slice(0, 80), capturedAt: S(t.source?.capturedAt) || today(), key: "", files: 0, importedFrom: S(t.id) },
    tokens, style: t.style && typeof t.style === "object" ? t.style : null, styleFixed: t.styleFixed && typeof t.styleFixed === "object" ? t.styleFixed : null,
    sections: Array.isArray(t.sections) ? t.sections.slice(0, 40).map(compactSection) : [],
    copy: t.copy && typeof t.copy === "object" ? t.copy : {}, avoid: Array.isArray(t.avoid) ? t.avoid.map(S).filter(Boolean).slice(0, 16) : [],
    overrides: cleanOverrides(t.overrides || {}), createdAt: Date.now(), updatedAt: Date.now(), cost: null,
  };
  return tpl;
}
// 토큰 모양 검증: enum 밖 값·엉뚱한 색은 기본값으로(normalizeTokens 의 규칙을 다시 태움)
export function sanitizeTokens(tokens = {}) {
  const t = tokens || {}, c = t.colors || {};
  const measured = { bg: c.bg, ink: c.ink, ink2: c.ink2, brand: c.brand, brandShare: c.brand ? 1 : 0, dark: c.dark, dark2: c.dark2, panel: c.panel, line: c.line, kicker: c.kicker, titlePx: t.title_size, align: t.align === "left" ? { left: 10, center: 1 } : t.align === "center" ? { left: 1, center: 10 } : null, darkRatio: t.bands === "alternate" ? 0.2 : 0 };
  const out = normalizeTokens(measured, { ...t, brand_usage: c.brand ? "bands" : "none" });
  if (TOKEN_ENUM.spacing.includes(t.spacing)) out.spacing = t.spacing;
  if (TOKEN_ENUM.bands.includes(t.bands)) out.bands = t.bands;
  if (Number.isFinite(Number(t.radius))) out.radius = Math.max(0, Math.min(36, Math.round(Number(t.radius))));
  return out;
}

// ── 5. 보관함(파일) ──
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1)); };
export function createStore(root) {
  fs.mkdirSync(root, { recursive: true });
  const dirOf = (id) => path.join(root, String(id));
  const fileOf = (id) => path.join(dirOf(id), "template.json");
  const valid = (id) => ID_RE.test(String(id || ""));
  const api = {
    root, dirOf,
    list() {
      if (!fs.existsSync(root)) return [];
      return fs.readdirSync(root).filter(valid).map((id) => readJson(fileOf(id))).filter((t) => t && t.tokens).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    },
    summaries() { return api.list().map(summarize); },
    get(id) { return valid(id) ? readJson(fileOf(id)) : null; },
    guard(id) { return valid(id) ? readJson(path.join(dirOf(id), "guard.json"), { ocr_lines: [] }) : { ocr_lines: [] }; },
    has(id) { return valid(id) && fs.existsSync(fileOf(id)); },
    save(tpl, guard = null) {
      if (!tpl?.id || !valid(tpl.id) || !tpl.tokens) return { error: "저장할 템플릿이 올바르지 않습니다" };
      const t = { ...tpl, updatedAt: Date.now() };
      writeJson(fileOf(t.id), t);
      if (guard) writeJson(path.join(dirOf(t.id), "guard.json"), guard);
      return t;
    },
    // reference.json(객체) + 출처 → 저장(가드 줄 포함). 같은 출처(key)가 이미 있으면 그 템플릿을 돌려준다(다시 분석 안 함)
    saveFromReference(ref, meta = {}) {
      const key = S(meta.source?.key); const dup = key ? api.findBySource(key) : null;
      if (dup && !meta.force) return { ...dup, existing: true };
      const tpl = fromReference(ref, meta); if (tpl.error) return tpl;
      return api.save(tpl, guardFromReference(ref));
    },
    findBySource(key) { return key ? api.list().find((t) => t.source?.key === key) || null : null; },
    rename(id, name) { const t = api.get(id); if (!t) return { error: "템플릿이 없습니다" }; const nm = S(name).slice(0, 40); if (!nm) return { error: "이름이 비었습니다" }; return api.save({ ...t, name: nm }); },
    setOverrides(id, overrides, { merge = true } = {}) { const t = api.get(id); if (!t) return { error: "템플릿이 없습니다" }; return api.save({ ...t, overrides: cleanOverrides(merge ? { ...(t.overrides || {}), ...(overrides || {}) } : overrides || {}) }); },
    update(id, patch = {}) { const t = api.get(id); if (!t) return { error: "템플릿이 없습니다" }; const o = { ...t }; if (typeof patch.name === "string" && S(patch.name)) o.name = S(patch.name).slice(0, 40); if (typeof patch.category === "string") o.category = S(patch.category).slice(0, 40); if (patch.overrides && typeof patch.overrides === "object") o.overrides = cleanOverrides(patch.overrides); return api.save(o); },
    remove(id) { if (!valid(id) || !fs.existsSync(dirOf(id))) return { error: "템플릿이 없습니다" }; fs.rmSync(dirOf(id), { recursive: true, force: true }); return { ok: true }; },
    // 파이프라인용 reference 객체(overrides 적용 + 가드 줄)
    reference(id, { keepExtra = false } = {}) { const t = api.get(id); return t ? toReference(t, { guard: api.guard(id), keepExtra }) : null; },
    exportTo(id, file) { const t = api.get(id); if (!t) return { error: "템플릿이 없습니다" }; const f = /\.json$/i.test(file) ? file : file + EXPORT_EXT; writeJson(f, toExport(t)); return { ok: true, file: f }; },
    importFrom(file, { madeBy = "받음" } = {}) {
      const obj = readJson(file); if (!obj) return { error: "파일을 읽지 못했습니다" };
      const tpl = fromImport(obj, { madeBy }); if (tpl.error) return tpl;
      const same = api.list().find((t) => t.source?.importedFrom && t.source.importedFrom === tpl.source.importedFrom && t.name === tpl.name); // 같은 파일을 두 번 가져오면 덮어쓴다
      if (same) { tpl.id = same.id; tpl.createdAt = same.createdAt; }
      return api.save(tpl);
    },
  };
  return api;
}
