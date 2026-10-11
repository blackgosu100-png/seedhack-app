// 👁 비전 검수 — Claude CLI 가 Read 도구로 사진(clean/*.png)을 하나씩 열어 보고 "쓸 수 있는 사진인지·무엇이 보이는지·캡션" 을 판정한다.
//   reviewPhotos({ items: [{ id, file(절대경로), kind, w, h }], product: { title_ko, keyword, attrs_ko[] }, log, model })
//   → { ok, items: [{ id, usable, score 1~5, has_text, has_logo, shows, caption_title, caption_desc, role }], costUsd, elapsedMs, calls, error? }
//   한 번에 최대 16장씩 나눠 호출(32장이면 2회). CLI 가 없거나 실패하면 { ok:false, items:[], error } — 파이프라인은 비전 없이 계속(plan-core 가 vision 없이 동작).
//   개발 실행 전용(Claude CLI 구독). 배포판 서버 중계는 아직 없다.
import { runStructured, cliAvailable } from "./cli.js";

export const VISION_BATCH = 16;
export const VISION_ROLES = ["hero", "feature", "detail", "scene", "size", "package", "skip"];
export const TEXT_POS = ["top", "bottom", "left", "right", "center"];
export const SUBJECTS = ["product", "product_in_scene", "person", "infographic", "other"];

export const VISION_SYSTEM = `당신은 쿠팡 상세페이지 제작팀의 사진 검수자입니다. 1688(중국 도매) 상품 이미지에서 중국어 글자를 지우고 사진 영역만 잘라낸 PNG 파일들을 받습니다.
반드시 Read 도구로 입력 목록의 사진 파일을 **하나씩 절대경로로 열어 본 뒤** 판정합니다. 열어 보지 않고 추측하지 않습니다. 파일을 열 수 없으면 usable:false, shows:"열 수 없음".

판정 기준:
- 상품 본체가 주인공인 사진만 씁니다. 입력 [상품]이 주인공이 아닌 사진(옷·수건·배경·사람·소품만 크게 보이는 것)은 usable:false 로 하거나 role:"scene" 에 score 2 이하로 둡니다. 옷감·질감·색감 묘사는 캡션에 쓰지 않습니다.
- usable: 상세페이지에 그대로 넣어도 어색하지 않은 사진이면 true. 다음은 false — 사람 다리·손만 잘린 사진, 제품 일부만 남아 무엇인지 모를 조각, 납작한 띠, 거의 빈 바탕, 아이콘·표·도표·텍스트뿐인 이미지, 흐릿하거나 깨진 이미지.
- has_text: 중국어·영어 마케팅 글자·워터마크가 보이면 true (제품에 인쇄된 작은 라벨은 제외). has_logo: 브랜드 로고·상호가 보이면 true.
- score 1~5: 제품이 크고 또렷하게, 배경이 깔끔하게 보일수록 높게. 같은 장면이 반복되면(앞 사진과 거의 같은 구도) 뒤 사진은 2 이하.
- role: hero(첫 화면용 — 제품 전체가 또렷, 글자 없음, 가장 좋은 1~2장), feature(특징·기능이 보이는 사진), detail(부품·재질 클로즈업), scene(사용 장면·설치 장면), size(치수가 그려진 그림), package(포장·구성품), skip(쓰지 않음).
- shows: 그 사진에 실제로 보이는 것 한 줄(한국어, 30자 이내). 보이지 않는 것은 쓰지 않습니다.
- subject: 사진의 주인공 — "product"(상품 본체만, 스튜디오·단색 배경), "product_in_scene"(상품이 실제 공간·소품과 함께), "person"(사람이 주인공), "infographic"(글자 상자·도표·아이콘 위주), "other".
- product_only: 배경을 지워 누끼(제품 단독 이미지)로 써도 되는 **상품 본체 단독** 사진이면 true. 사람·가구·세탁기·다른 소품·글자 상자가 함께 있으면 false(전경 분리가 그것들까지 따 오므로). subject 가 "product" 일 때만 true 가 될 수 있습니다.
- product_visible: 입력 [상품] 본체가 사진에 얼마나 보이는지 — "full"(전체가 잘림 없이), "partial"(일부만, 가장자리에서 잘림·다른 물건에 가려짐), "none"(거의 안 보임). 다른 가전·소품만 크게 보이면 none.
- product_bbox: 상품 본체가 차지하는 영역 {x,y,w,h}(이미지 기준 0~1, 왼쪽 위 0,0). 안 보이면 {x:0,y:0,w:0,h:0}.
- other_brand_prominent: 다른 회사 제품·브랜드 로고(가전·정수기 등)가 상품보다 눈에 띄면 true.
- any_logo_visible: 크기와 상관없이 브랜드 로고·상표 글자가 하나라도 보이면 true(스피커·가전·포장의 작은 로고 포함).
- callout_points: product_only 가 true 인 사진에서만, 배경을 지운 누끼(같은 크기) 기준 0~1 좌표(x 가로, y 세로)로 눈에 띄는 부품·특징 지점 3~5개와 그 이름(한국어 10자 이내, 예: "접이 관절", "미끄럼 방지 발"). 사진에 실제로 보이는 지점만. product_only 가 아니면 빈 배열.
- text_pos: has_text 가 true 일 때 글자가 사진의 어느 가장자리 20% 안에 있는지 — "top"|"bottom"|"left"|"right", 가운데에 있으면 "center"(그 사진은 쓰기 어려움), 글자가 없으면 null.
- caption_title(18자 이내)·caption_desc(40자 이내 한 문장): **그 사진에 실제로 보이는 것**을 근거로, 반드시 **상품의 기능·혜택** 관점의 한글(존댓말). 옷·배경 묘사("부드러운 옷감", "베이지 자켓") 금지. 금지: 최저가·1위·최고·100%·효능·타 쇼핑몰 이름·가격·배송/반품/보증 약속, "제품의 모습을 보여줍니다" 같은 무의미한 문장, 위험 안내. usable:false 면 캡션은 빈 문자열.
- 캡션 금지: 사람이 매달리는 테스트·체중·몸무게 언급("두 사람의 체중도 지탱"), "N kg 까지 견딘다" 같은 하중 수치(상품 정보에 있어도 캡션에는 쓰지 않음), 위험 안내, "모습을 보여줍니다" 같은 무의미 문장.
- 숫자·재질은 사진에 보이거나 상품 정보에 있는 것만. 모든 글은 한국어. 응답은 JSON 만.`;

const item = (props, required = Object.keys(props)) => ({ type: "object", additionalProperties: false, required, properties: props });
export const VISION_SCHEMA = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: {
    items: { type: "array", maxItems: VISION_BATCH, description: "입력 목록의 사진마다 하나씩, 같은 id", items: item({
      id: { type: "string", description: "입력 id 그대로" },
      usable: { type: "boolean" },
      score: { type: "integer", description: "1~5" },
      has_text: { type: "boolean" }, has_logo: { type: "boolean" },
      text_pos: { type: ["string", "null"], enum: ["top", "bottom", "left", "right", "center", null], description: "글자가 있는 가장자리(20% 안). 가운데면 center, 글자 없으면 null" },
      subject: { type: "string", enum: SUBJECTS, description: "사진의 주인공" },
      product_only: { type: "boolean", description: "배경을 지워 누끼로 써도 되는 상품 본체 단독 사진인가(사람·가구·소품·글자 상자가 함께면 false)" },
      product_visible: { type: "string", enum: ["full", "partial", "none"], description: "상품 본체가 보이는 정도" },
      product_bbox: item({ x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }),
      other_brand_prominent: { type: "boolean", description: "다른 회사 제품·로고가 상품보다 눈에 띄는가" },
      any_logo_visible: { type: "boolean", description: "작게라도 브랜드 로고·상표 글자가 보이는가" },
      callout_points: { type: "array", maxItems: 5, items: item({ x: { type: "number" }, y: { type: "number" }, label: { type: "string", description: "부품 이름 10자 이내" } }), description: "product_only 사진의 부품 지점(누끼 기준 0~1). 아니면 빈 배열" },
      shows: { type: "string", description: "사진에 보이는 것 한 줄, 30자 이내" },
      caption_title: { type: "string", description: "18자 이내" },
      caption_desc: { type: "string", description: "40자 이내 한 문장" },
      role: { type: "string", enum: VISION_ROLES },
    }) },
  },
};

export function renderVisionInput(items, product = {}) {
  const L = [];
  const name = product.title_ko || product.keyword || "(제목 없음)";
  L.push(`[상품] ${name}${product.keyword ? ` · 검색어 ${product.keyword}` : ""}`);
  L.push(`상품은 "${name}" 입니다. 상품 본체가 주인공이 아닌 사진(옷·배경·사람만 크게 보이는 것)은 usable:false 또는 role:"scene"+score 2 이하로 판정하고, 캡션은 상품의 기능·혜택만 씁니다.`);
  if (product.attrs_ko?.length) L.push(`[상품 정보] ${product.attrs_ko.slice(0, 12).join(" / ")}`);
  L.push("", `[사진 ${items.length}장 — Read 도구로 아래 절대경로를 하나씩 열어 본 뒤 id 마다 판정]`);
  items.forEach((it, i) => L.push(`${i + 1}. id=${it.id} · ${it.kind || "detail"} · ${it.w || "?"}x${it.h || "?"} · 경로: ${it.file}`));
  L.push("", "모든 사진을 열어 본 뒤 items 에 입력 순서대로, 빠짐없이 돌려주세요.");
  return L.join("\n");
}

const S = (v) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
const clip = (s, n) => { s = S(s); return s.length <= n ? s : s.slice(0, n); };
// 캡션에 쓰면 안 되는 문장(체중·매달리기 테스트, 하중 수치, 위험 안내, 무의미 문장) → 캡션을 비워 copy.captions 로 대체되게
export const BAD_CAPTION_RE = /체중|몸무게|매달|두\s*사람의\s*무게|\d+\s*(?:kg|㎏|킬로)|따라\s*하지|위험한|모습(을|이)\s*보여|모습입니다|로고가/;
// 모델 응답 한 항목을 형식에 맞게 정리
export function normalizeVisionItem(r, id) {
  const score = Math.min(5, Math.max(1, Math.round(Number(r?.score) || 3)));
  const role = VISION_ROLES.includes(r?.role) ? r.role : "detail";
  const usable = r?.usable !== false && role !== "skip";
  const text_pos = r?.has_text && TEXT_POS.includes(r?.text_pos) ? r.text_pos : null;
  const subject = SUBJECTS.includes(r?.subject) ? r.subject : "other";
  const product_only = r?.product_only === true && subject === "product" && usable;
  const vis = ["full", "partial", "none"].includes(r?.product_visible) ? r.product_visible : null;
  const bb = r?.product_bbox || {}; const c01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
  const product_bbox = vis && vis !== "none" ? { x: c01(bb.x), y: c01(bb.y), w: c01(bb.w), h: c01(bb.h) } : null;
  const callout_points = product_only ? (Array.isArray(r?.callout_points) ? r.callout_points : []).map((p) => ({ x: Math.min(1, Math.max(0, Number(p?.x) || 0)), y: Math.min(1, Math.max(0, Number(p?.y) || 0)), label: clip(p?.label, 12) })).filter((p) => p.label).slice(0, 5) : [];
  const badCap = BAD_CAPTION_RE.test(`${r?.caption_title || ""} ${r?.caption_desc || ""}`);
  return { id: S(id ?? r?.id), usable, score, has_text: !!r?.has_text, has_logo: !!r?.has_logo, text_pos, subject, product_only, callout_points, ...(vis ? { product_visible: vis, product_bbox, other_brand_prominent: !!r?.other_brand_prominent } : {}), ...(typeof r?.any_logo_visible === "boolean" ? { any_logo_visible: r.any_logo_visible } : {}), shows: clip(r?.shows, 40),
    caption_title: usable && !badCap ? clip(r?.caption_title, 24) : "", caption_desc: usable && !badCap ? clip(r?.caption_desc, 60) : "", role: usable ? role : "skip", ...(badCap ? { caption_dropped: true } : {}) };
}

export async function reviewPhotos({ items = [], product = {}, log = () => {}, model = process.env.SIGNAL_AI_MODEL || "sonnet", timeoutMs = 420000, batch = VISION_BATCH } = {}) {
  const t0 = Date.now();
  const list = (items || []).filter((it) => it && it.id && it.file);
  if (!list.length) return { ok: false, items: [], costUsd: 0, elapsedMs: 0, calls: 0, error: "검수할 사진이 없습니다" };
  if (!cliAvailable()) return { ok: false, items: [], costUsd: 0, elapsedMs: 0, calls: 0, error: "Claude CLI가 없습니다 (~/.local/bin/claude)" };
  const out = new Map(); let costUsd = 0, calls = 0, error = null;
  for (let i = 0; i < list.length; i += batch) {
    const part = list.slice(i, i + batch);
    log("dim", `  👁 사진 검수 ${i + 1}~${i + part.length}/${list.length} (Claude CLI·${model}·Read)`);
    const r = await runStructured({ system: VISION_SYSTEM, schema: VISION_SCHEMA, text: renderVisionInput(part, product), model, timeoutMs, allowedTools: ["Read"] });
    calls++;
    if (r?.error) { error = r.error; log("dim", `  👁 사진 검수 실패 · ${r.error}`); break; }
    costUsd += Number(r.costUsd) || 0;
    const byId = new Map((r.result?.items || []).map((x) => [S(x?.id), x]));
    for (const it of part) if (byId.has(it.id)) out.set(it.id, normalizeVisionItem(byId.get(it.id), it.id));
    const missing = part.filter((it) => !byId.has(it.id)).map((it) => it.id);
    if (missing.length) log("dim", `  👁 응답에 빠진 사진 ${missing.length}장(${missing.slice(0, 5).join(",")}) — 비전 없이 처리`);
  }
  const elapsedMs = Date.now() - t0;
  const result = [...out.values()];
  if (result.length) log("go", `■ 사진 검수 ${result.length}/${list.length}장 · 쓸 수 있음 ${result.filter((x) => x.usable).length} · ${(elapsedMs / 1000).toFixed(1)}초 · $${costUsd.toFixed(3)}`);
  return { ok: result.length > 0, items: result, costUsd, elapsedMs, calls, error };
}

// 체크포인트 지시선 좌표 — 장면(생성 이미지 포함) 한 장을 Read 로 보고 라벨(부품 이름)마다 0~1 좌표를 찍는다. 1회 호출.
//   locateCallouts({ file(절대경로), labels: ["슬라이드 레일", …], product: { title_ko } }) → { ok, points: [{ x, y, part }], costUsd, elapsedMs } | { ok:false, error }
//   장면 검수(same_product) 호출에 묶으려면 CALLOUT_SCHEMA_PART 를 그 스키마 항목에 합치면 된다.
export const CALLOUT_SCHEMA_PART = { callout_points: { type: "array", maxItems: 6, items: item({ x: { type: "number" }, y: { type: "number" }, part: { type: "string", description: "부품 이름(라벨과 같은 말)" } }), description: "제품 부품 지점(이미지 기준 0~1 좌표, x 가로·y 세로)" } };
const CALLOUT_SYSTEM = `당신은 상세페이지 디자이너입니다. Read 도구로 입력 사진을 열어 보고, 주어진 부품 라벨마다 사진 속 그 부품의 위치를 이미지 기준 0~1 좌표(x 가로, y 세로, 왼쪽 위가 0,0)로 찍습니다. 부품이 사진에 안 보이면 그 라벨은 빼고, 보이는 다른 부품 이름으로 대신하지 않습니다. part 에는 입력 라벨을 그대로 씁니다. 응답은 JSON 만.`;
export async function locateCallouts({ file, labels = [], product = {}, box = null, log = () => {}, model = process.env.SIGNAL_AI_MODEL || "sonnet", timeoutMs = 240000 } = {}) {
  const t0 = Date.now();
  if (!file || !labels.length) return { ok: false, error: "사진·라벨이 필요합니다", points: [] };
  if (!cliAvailable()) return { ok: false, error: "Claude CLI가 없습니다", points: [] };
  const text = [`[상품] ${product.title_ko || ""}`, `[사진] ${file}`, `[부품 라벨] ${labels.map((l, i) => `${i + 1}. ${l}`).join(" / ")}`, ...(box ? [`[제품 영역] x ${box.x.toFixed(2)}~${(box.x + box.w).toFixed(2)}, y ${box.y.toFixed(2)}~${(box.y + box.h).toFixed(2)} — 모든 점은 이 영역 안, 실제 그 부품 위에 찍을 것(빈 배경 금지)`] : []), "각 라벨의 위치를 찍어 주세요."].join("\n");
  log("dim", `  👁 지시선 좌표 요청 (Claude CLI·${model}·Read) · 라벨 ${labels.length}개`);
  const r = await runStructured({ system: CALLOUT_SYSTEM, schema: { type: "object", additionalProperties: false, required: ["callout_points"], properties: CALLOUT_SCHEMA_PART }, text, model, timeoutMs, allowedTools: ["Read"] });
  if (r?.error) return { ok: false, error: r.error, points: [], elapsedMs: Date.now() - t0 };
  const points = (r.result.callout_points || []).map((p) => ({ x: Math.min(1, Math.max(0, Number(p.x) || 0)), y: Math.min(1, Math.max(0, Number(p.y) || 0)), part: clip(p.part, 20) })).filter((p) => p.part);
  return { ok: true, points, costUsd: r.costUsd ?? null, elapsedMs: Date.now() - t0, model: r.model };
}

// 생성 장면 검수 보강 — 장면(scene/*.png)마다 상품이 보이는 정도·다른 브랜드 두드러짐을 본다(장면 검수 same_product 와 별도로, 또는 그 스키마에 SCENE_CHECK_PART 를 합쳐 1회로)
//   reviewScenes({ items:[{ id, file }], product }) → { ok, items:[{ id, product_visible, product_bbox, other_brand_prominent, note }], costUsd, elapsedMs }
export const SCENE_CHECK_PART = {
  product_visible: { type: "string", enum: ["full", "partial", "none"], description: "입력 상품 본체가 보이는 정도" },
  product_bbox: item({ x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }),
  other_brand_prominent: { type: "boolean", description: "다른 회사 가전·제품·로고(정수기·커피머신 브랜드 등)가 상품보다 눈에 띄는가" },
  any_logo_visible: { type: "boolean", description: "크기와 상관없이 브랜드 로고·상표 글자가 하나라도 보이는가" },
};
const SCENE_CHECK_SYSTEM = `당신은 상세페이지 사진 검수자입니다. Read 도구로 각 생성 장면 사진을 열어 보고, 입력 [상품]의 본체가 얼마나 보이는지(product_visible: full 전체·partial 일부·none 안 보임), 상품 영역(product_bbox 0~1), 다른 회사 가전·제품·로고가 상품보다 눈에 띄는지(other_brand_prominent), 작게라도 로고·상표 글자가 보이는지(any_logo_visible)를 판정합니다. 상품보다 정수기·커피머신 같은 다른 가전이 화면 중심이면 true. note 에 한 줄 이유. 응답은 JSON 만.`;
export async function reviewScenes({ items = [], product = {}, log = () => {}, model = "haiku", timeoutMs = 300000 } = {}) {
  const t0 = Date.now();
  const list = items.filter((x) => x && x.id && x.file);
  if (!list.length) return { ok: false, items: [], error: "장면이 없습니다" };
  if (!cliAvailable()) return { ok: false, items: [], error: "Claude CLI가 없습니다" };
  const schema = { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: item({ id: { type: "string" }, ...SCENE_CHECK_PART, note: { type: "string" } }) } } };
  const text = [`[상품] ${product.title_ko || ""}`, ...list.map((x, i) => `${i + 1}. id=${x.id} · 경로: ${x.file}`), "모든 사진을 열어 보고 id 마다 판정해 주세요."].join("\n");
  log("dim", `  👁 장면 ${list.length}장 상품 보임 검수 (Claude CLI·${model}·Read)`);
  const r = await runStructured({ system: SCENE_CHECK_SYSTEM, schema, text, model, timeoutMs, allowedTools: ["Read"] });
  if (r?.error) return { ok: false, items: [], error: r.error, elapsedMs: Date.now() - t0 };
  const c01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
  const out = (r.result.items || []).map((x) => ({ id: String(x.id), product_visible: ["full", "partial", "none"].includes(x.product_visible) ? x.product_visible : "partial", product_bbox: x.product_bbox ? { x: c01(x.product_bbox.x), y: c01(x.product_bbox.y), w: c01(x.product_bbox.w), h: c01(x.product_bbox.h) } : null, other_brand_prominent: !!x.other_brand_prominent, any_logo_visible: !!x.any_logo_visible, note: clip(x.note, 60) }));
  return { ok: true, items: out, costUsd: r.costUsd ?? null, elapsedMs: Date.now() - t0, model: r.model };
}
