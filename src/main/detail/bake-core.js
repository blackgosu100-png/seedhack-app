// 🖼 통째 한글화(bake) — 순수 부분: 이미지 AI 에 줄 지시문 만들기 + 결과 검수(글자 다시 읽은 것과 비교).
// 방식(2026-11-23 대표님 결정): 문구는 우리 카피(translateLayers: 글자 수 한도·숫자 지킴이·금지 문구) → 그리기는 이미지 AI(gemini-3-pro-image)
//   → 검수(남은 한자·숫자·문구·비율·사진 변형) → 떨어지면 한 번 더 → 그래도 안 되면 예전 방식(지우고 얹기).
const S = (v) => String(v ?? "").trim();
export const BAKE_MODEL = "gemini-3-pro-image";
export const hanCount = (t) => (String(t || "").match(/[一-鿿]/g) || []).length;
const norm = (t) => String(t || "").replace(/[\s·.,!?:;'"“”‘’()\[\]{}<>《》、。，！？：；\-–—_/\\|~*]/g, "").toLowerCase();
// 숫자 토큰(소수·범위 포함): "0.5-1%" → ["0.5","1"], "2.5mm" → ["2.5"]. 한 자리 숫자는 OCR 잡음이 많아 두 글자 이상 또는 단위가 붙은 것만 본다
export function numTokens(t) { return (String(t || "").match(/\d+(?:\.\d+)?/g) || []).filter((n) => n.length >= 2 || new RegExp(`${n}\\s*(%|kg|g|cm|mm|m|L|ml|W|V|단|개|인분|시간|분|초|인치|배|종|겹|층)`).test(String(t))); }
const bigrams = (s) => { const a = Array.from(s), o = new Set(); for (let i = 0; i < a.length - 1; i++) o.add(a[i] + a[i + 1]); if (a.length === 1) o.add(a[0]); return o; };
// 기대 문구가 읽은 글 안에 있는지(글자 쌍 겹침 비율) — OCR 은 띄어쓰기·한두 글자를 틀리므로 느슨하게
export function textHit(expect, seen) { const e = bigrams(norm(expect)); if (!e.size) return 1; const sset = bigrams(norm(seen)); let h = 0; for (const b of e) if (sset.has(b)) h++; return h / e.size; }

// 글꼴 프리셋(미리보기 더블클릭 즉시 편집 · AI 다시 그리기 공용)
export const FONT_PRESETS = [
  { id: "gothic", label: "기본 고딕", css: '"Pretendard Variable", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif', prompt: "깔끔한 고딕체" },
  { id: "bold", label: "굵은 타이틀", css: '"Pretendard Variable", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif', prompt: "힘 있고 두꺼운 제목 고딕체" },
  { id: "serif", label: "명조", css: '"AppleMyungjo", "Batang", "Noto Serif KR", Georgia, serif', prompt: "단정한 명조체(세리프)" },
  { id: "round", label: "둥근 고딕", css: '"NanumSquareRound", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif', prompt: "부드러운 둥근 고딕체" },
  { id: "mono", label: "숫자·스펙", css: 'ui-monospace, "SF Mono", "Consolas", "Pretendard Variable", monospace', prompt: "정갈한 숫자·스펙용 고딕체" },
];
const fontPromptOf = (id) => FONT_PRESETS.find((f) => f.id === id)?.prompt || "";

// layers: [{ zh, ko, drop, role, style? }] → 지시문. 바꿀 글·지울 글을 표로 준다(모델이 문구를 지어내지 않게)
export function bakePrompt(layers = [], { retry = null } = {}) {
  const keep = layers.filter((l) => S(l.zh) && !l.drop && S(l.ko)), drop = layers.filter((l) => S(l.zh) && (l.drop || !S(l.ko)));
  const styleHint = (l) => {
    const st = l.style || {}, hints = [];
    if (st.color) hints.push(`글자색 ${st.color}`);
    if (st.font && fontPromptOf(st.font)) hints.push(`글꼴 ${fontPromptOf(st.font)}`);
    if (st.weight >= 700) hints.push("굵게");
    else if (st.weight && st.weight <= 400) hints.push("보통 굵기");
    if (st.size) hints.push(`글자 크기 약 ${Math.round(st.size)}px 비율`);
    if (st.align === "left") hints.push("왼쪽 맞춤");
    else if (st.align === "center") hints.push("가운데 맞춤");
    else if (st.align === "right") hints.push("오른쪽 맞춤");
    return hints.length ? ` [사용자 지정 스타일: ${hints.join(", ")}]` : "";
  };
  const L = [
    "이 상품 상세 이미지의 중국어 글자를 한국어로 바꿔 다시 그려 주세요.",
    "",
    "지킬 것",
    "- 글자만 바꿉니다. 제품·사진·배경·도형·아이콘·구도·이미지 비율은 원본 그대로.",
    "- 글자 색은 원본 그 자리의 글자 색과 똑같이(빨간 강조는 빨강, 회색 글은 회색, 흰 글은 흰색 — 검정으로 바꾸지 않습니다). 단, [사용자 지정 스타일]이 적힌 줄은 그 색·글꼴·굵기·크기를 우선 따릅니다.",
    "- 같은 문단·같은 표·같은 줄의 항목들은 한 글자 크기로 가지런히. 글이 도형·칸·그림 밖으로 넘치지 않게, 넘칠 것 같으면 그 묶음 전체를 조금 줄입니다.",
    "- 「 」 안의 글자만 그립니다. 「 」 기호, '1째 줄:' 같은 안내 말, 괄호·대괄호 속 설명은 그리지 않습니다.",
    "- 아래 표의 한국어 문구를 **그대로** 씁니다(뜻을 바꾸거나 덧붙이지 않습니다). 숫자·단위·영문 모델명은 그대로.",
    "- 표에 없는 중국어가 보이면 짧고 자연스러운 한국 쇼핑몰 말로 옮깁니다. 영문·숫자만 있는 글은 건드리지 않습니다.",
    "- 원본에 없는 문구·로고·가격·배지를 새로 넣지 않습니다. 한글 맞춤법을 정확히. 중국어가 한 글자도 남지 않게.",
    "",
    "바꿀 글 (원문 → 한국어)",
    ...keep.flatMap((l) => { // 여러 줄 문구는 줄마다 따로 적는다(줄바꿈 기호를 쓰면 그 기호를 글자로 그린다 — 2026-11-23 실측: " / "·"⏎" 모두 그려짐)
      const ls = S(l.ko).split("\n").map(S).filter(Boolean), zh = S(l.zh).replace(/\n/g, " "), same = "글자 굵기·크기·색은 원본 그 자리 글과 같게(가는 글은 가늘게, 검은 글은 검게)", sh = styleHint(l);
      if (ls.length < 2) return [`- 「${zh}」 → 「${ls[0] || ""}」${l.block ? ` (${same})` : ""}${sh}`];
      return [`- 「${zh}」 → 아래 ${ls.length}줄로 나눠 씁니다${l.head ? " (첫째 줄만 굵은 소제목, 나머지는 원본 본문과 같은 굵기·크기·색)" : ` (${same})`}${(l.block || []).length > 1 ? " · 원문 묶음이 있던 자리에 가지런히 두고 남는 자리는 여백으로" : ""}${sh}`, ...ls.map((t, k) => `    ${k + 1}째 줄: 「${t}」`)];
    }),
  ];
  if (drop.length) L.push("", "지울 글 (글자를 없애고 그 자리는 주변 바탕색·무늬로 자연스럽게 메웁니다. 글이 든 알약·배지 도형도 함께 지웁니다)", ...drop.map((l) => `- 「${S(l.zh).replace(/\n/g, " ")}」`));
  if (retry) L.push("", `앞선 결과에서 고칠 점: ${retry}`);
  return L.join("\n");
}

// 검수. expected: 바꿀 글의 ko 목록 · seenText: 결과 그림을 다시 읽은 글 전체 · ratio0/ratio1: 원본·결과의 가로/세로 · drift: 글 밖 영역의 밝기 차이 평균(0~255, 없으면 null)
export function verifyBake({ layers = [], seenText = "", ratio0 = 1, ratio1 = 1, drift = null, limits = {} } = {}) {
  const lim = { han: 3, hanRate: 0.12, num: 0.85, text: 0.6, ratio: 0.05, drift: 18, ...limits }; // 실측(28장 2026-11-23): 비율 0.983~1.006 · 변형 0.7~11.3
  const keep = layers.filter((l) => S(l.zh) && !l.drop && S(l.ko));
  const zhTotal = layers.reduce((n, l) => n + hanCount(l.zh), 0);
  const han = hanCount(seenText);
  const nums = [...new Set(keep.flatMap((l) => numTokens(l.ko)))], seenNums = new Set(numTokens(seenText).concat(String(seenText).match(/\d+(?:\.\d+)?/g) || []));
  const numHit = nums.length ? nums.filter((n) => seenNums.has(n)).length / nums.length : 1;
  const big = keep.filter((l) => norm(l.ko).length >= 2);
  const hits = big.map((l) => textHit(l.ko, seenText)), textRate = hits.length ? hits.filter((h) => h >= 0.5).length / hits.length : 1;
  const fails = [];
  if (han > lim.han && han > zhTotal * lim.hanRate) fails.push({ k: "han", why: `중국어 ${han}자가 남았습니다. 모두 한국어로 바꾸세요.` });
  if (numHit < lim.num) fails.push({ k: "num", why: `숫자가 빠졌거나 바뀌었습니다(${nums.filter((n) => !seenNums.has(n)).slice(0, 6).join(", ")}). 표의 숫자를 정확히 쓰세요.` });
  if (textRate < lim.text) fails.push({ k: "text", why: "표의 한국어 문구와 다른 글이 많습니다. 표의 문구를 그대로 쓰세요." });
  if (Math.abs(ratio1 / ratio0 - 1) > lim.ratio) fails.push({ k: "ratio", why: "이미지 비율이 원본과 다릅니다. 원본 비율 그대로 그리세요." });
  if (drift != null && drift > lim.drift) fails.push({ k: "drift", why: "제품·사진·배경이 원본과 달라졌습니다. 글자 외에는 원본 그대로 두세요." });
  return { ok: !fails.length, fails, han, numHit: +numHit.toFixed(2), textRate: +textRate.toFixed(2), drift: drift == null ? null : +drift.toFixed(1), ratio: +(ratio1 / ratio0).toFixed(3) };
}

// ---------- ✍ 장 단위 편집(2026-11-23): 줄마다 옮긴 문구를 그림 한 장 단위로 다시 짠다 ----------
//  줄 단위 문구는 문단이 끊기고 길다(대표님 비교: GPT 는 문단을 "제목 + 3줄"로 덜어 냈다). 통째로 그리는 방식에서는 자리 수가 줄어도 되므로 묶어서 다시 쓴다.
//  사실은 못 바꾸게 한다: 숫자·모델명은 그대로, 새 숫자·금지 문구·한자 금지, 원래보다 길어지면 버림 → 버린 묶음은 줄 단위 문구 그대로.
export const EDIT_SYSTEM = `당신은 쿠팡 상세페이지 편집 카피라이터입니다. 중국 상세 이미지를 한국 구매자가 3초 안에 읽을 수 있게 **한 장 단위로 문구를 편집**합니다.
이미지마다 글 레이어 목록(번호 · 역할 · 위치 y,x · 글자 높이 · 원문 · 지금 한국어)을 받습니다. "지금 한국어"는 줄마다 따로 옮긴 것이라 문단이 끊기고 깁니다. 레이어를 묶어(blocks) 다시 씁니다.

묶는 법
- 문단(위아래로 붙어 있고 글자 높이가 비슷한 본문 2줄 이상): 한 묶음으로. 내용이 길면(지금 한국어 합계 40자 이상) 그리고 3줄 이상이면 **첫 줄 = 요지를 담은 짧은 제목(10자 이내), 이어서 본문(줄마다 18자 이내)**, head=true. 짧으면 본문만 1~2줄, head=false. 원래 양의 60% 안으로 덜어 냅니다(군말·반복·자랑 빼기, 핵심 한 가지만).
- 큰 제목(role title): 이 장이 말하려는 이점이나 "무엇인지"가 한눈에 보이게 다시 짓습니다. 한 줄 14자 이내, 2줄까지. 같은 낱말 반복 금지. 슬래시(/)로 늘어놓지 않고 가운뎃점(·)이나 "~도"로.
- 부제(role sub): 누가·어디서·무엇에 쓰는지 한 줄 18자 이내. 세로줄(|)·슬래시 대신 가운뎃점.
- 한 줄에 이어진 짧은 나열(기능 이름 여러 개): 가운뎃점으로 이은 한 줄.
- 사진 속 라벨·아이콘 글·표 칸·치수 글: 묶지 않습니다. 어색한 직역일 때만 한 레이어짜리 묶음으로 고쳐 씁니다(원문 글자 수의 1.3배 이내, 명사형).
- **멀쩡한 줄은 건드리지 않습니다.** 고치는 것은 두 가지뿐입니다: ① 여러 줄로 끊긴 문단 ② 흠이 있는 한 줄(슬래시·세로줄 나열, 같은 낱말 반복, 자리에 비해 너무 긴 문장, 뜻이 안 통하는 직역). 뜻이 통하고 길이가 맞는 줄은 표현이 마음에 안 들어도 blocks 에 넣지 않습니다. "지움" 표시 레이어는 넣지 않습니다.

지킬 것
- 숫자·단위·영문 모델명(M1, 304 등)은 하나도 빼거나 바꾸지 않습니다. 원문에 없는 숫자·사실을 더하지 않습니다.
- 원문에 없는 내용(색·재질·구성품·용도·대상)을 보태지 않고, 원문에 있는 제품 종류·재질 낱말을 빼지 않습니다. 말투(질문·대화체)와 뜻을 바꾸지 않습니다.
- 과장·단정 금지: 완벽, 최고, 1위, 필수, 100%, 무조건. 효능·인증·보증·가격·배송 약속 금지.
- 직역투·낯선 외래어를 쓰지 않습니다. 한국 쇼핑몰 구매자가 평소 검색하고 말하는 낱말로 씁니다(특정 상품의 낱말을 외워 쓰지 말고, 이 상품의 [상품] 정보와 원문 뜻에서 고릅니다).
- 슬래시(/)·세로줄(|)로 말을 잇지 않습니다(문단 안에서도). 줄을 나누거나 가운뎃점·쉼표를 씁니다.
- **줄 수는 묶은 레이어 수를 넘지 않습니다**(원본에서 그 글이 차지하던 자리만큼만 쓸 수 있습니다). 제목 줄을 넣으면 본문을 그만큼 줄입니다. 레이어 2개 묶음에 3줄을 쓰면 그림을 덮습니다.
- 문장은 완결되게. "~할 수 있습니다"는 본문 마지막 줄에만 한 번.
- ko 의 줄바꿈은 \n. 중국어 글자를 남기지 않습니다.
응답은 JSON 만.`;
export const EDIT_SCHEMA = { type: "object", additionalProperties: false, required: ["images"], properties: { images: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "blocks"], properties: { id: { type: "string" }, blocks: { type: "array", items: { type: "object", additionalProperties: false, required: ["idxs", "ko", "head"], properties: { idxs: { type: "array", items: { type: "integer" } }, ko: { type: "string" }, head: { type: "boolean" } } } } } } } } };
export function renderEditInput(images = [], brief = null) {
  const L = [];
  if (brief) L.push(`[상품] ${S(brief.product_name_ko)} · ${S(brief.product_type)} · 핵심 ${S(brief.key_appeal).slice(0, 160)}`, "");
  for (const im of images) {
    L.push(`[${im.id}] ${im.w || "?"}x${im.h || "?"}`);
    (im.layers || []).forEach((l, i) => L.push(`  ${i}. ${l.role || "body"} · y${Math.round(l.y || 0)} x${Math.round(l.x || 0)} · 높이 ${Math.round(l.style?.fontSizePx || l.textBox?.h || l.h || 0)} · ${S(l.zh).replace(/\n/g, " ")} → ${l.drop || !S(l.ko) ? "(지움)" : `"${S(l.ko).replace(/\n/g, " ⏎ ")}"`}`));
  }
  L.push("", "이미지마다 blocks 를 JSON 으로. 고칠 것이 없는 이미지는 blocks 를 빈 배열로.");
  return L.join("\n");
}
const digits = (t) => String(t || "").match(/\d+(?:\.\d+)?/g) || [];
const vlen = (t) => Array.from(String(t || "").replace(/\s/g, "")).length;
// 고칠 이유가 있는 자리만 편집을 받는다(멀쩡한 줄을 바꾸면 새 실수가 생긴다 — 5개 상품 실측에서 없던 내용 보태기·뜻 바꾸기가 여기서 나왔다)
//  여러 줄: 위아래로 붙은 비슷한 크기의 줄(문단)일 때만. 한 줄: 나열 기호(/ |) · 같은 낱말 반복 · 원문보다 많이 김(×1.6) 중 하나.
export function editNeeded(mem = []) {
  if (mem.length > 1) return mem.every((l, i) => { if (!i) return true; const p = mem[i - 1], hp = p.textBox?.h || p.h, hl = l.textBox?.h || l.h; if (!(hp > 0 && hl > 0) || p.y == null || l.y == null) return true; return Math.max(hp, hl) / Math.min(hp, hl) <= 1.5 && l.y - (p.y + (p.h || hp)) <= Math.max(hp, hl) * 1.5 && l.y >= p.y; });
  const l = mem[0] || {}, ko = S(l.ko);
  if (/[\/|｜]/.test(ko.replace(/\d+\s*\/\s*\d+/g, ""))) return true;
  const w = ko.split(/[\s·,\/|]+/).filter((x) => x.length >= 2); if (new Set(w).size < w.length) return true;
  const z = vlen(String(l.zh || "").replace(/[\x00-\x7f]/g, "")); return z >= 4 && vlen(ko) > z * 1.6;
}
// layers(줄 단위) + blocks(편집 결과) → 그리기용 레이어. 규칙을 어긴 묶음은 버리고 줄 단위 그대로 둔다.
export function applyEdit(layers = [], blocks = [], { banned = () => [] } = {}) {
  const taken = new Set(), merged = new Map(), rejected = []; let used = 0;
  for (const b of Array.isArray(blocks) ? blocks : []) {
    const idxs = [...new Set((b?.idxs || []).filter((i) => Number.isInteger(i) && layers[i]))].sort((a, c) => a - c); let ko = String(b?.ko || "").split("\n").map(S).filter(Boolean).join("\n");
    if (!idxs.length || !ko) continue;
    ko = ko.split("\n").map((ln) => ln.replace(/(?<![\dA-Za-z])\s*[\/|｜]\s*(?![\dA-Za-z])/g, ln.includes("·") ? ", " : " · ")).join("\n");
    const mem = idxs.map((i) => layers[i]), tag = `#${idxs.join(",")}`;
    const no = (why) => rejected.push(`${tag} ${why}`);
    if (idxs.some((i) => taken.has(i))) { no("겹침"); continue; }
    if (mem.some((l) => l.drop || !S(l.ko))) { no("지울 글 포함"); continue; }
    if (hanCount(ko)) { no("한자 남음"); continue; }
    if (!editNeeded(mem)) { no("고칠 이유 없음"); continue; }
    const had = new Set(mem.flatMap((l) => digits(l.ko))), src = new Set(mem.flatMap((l) => digits(l.ko).concat(digits(l.zh)))), now = digits(ko);
    if ([...had].some((n) => !now.includes(n))) { no(`숫자 빠짐(${[...had].filter((n) => !now.includes(n)).join(",")})`); continue; }
    if (now.some((n) => !src.has(n))) { no(`없던 숫자(${now.filter((n) => !src.has(n)).join(",")})`); continue; }
    const before = mem.reduce((n, l) => n + vlen(l.ko), 0);
    if (vlen(ko) > before * 1.15 + 3) { no(`더 길어짐(${before}→${vlen(ko)}자)`); continue; }
    const room = mem.reduce((n, l) => n + S(l.zh).split("\n").filter(Boolean).length, 0); // 원본에 그 글이 차지하던 줄 수 = 쓸 수 있는 자리
    if (ko.split("\n").length > room) { no(`줄 수 넘침(${room}→${ko.split("\n").length}줄)`); continue; }
    const bad = banned(ko); if (bad && bad.length) { no(`금지 문구(${[].concat(bad).slice(0, 2).join(",")})`); continue; }
    idxs.forEach((i) => taken.add(i)); used++;
    const kl = ko.split("\n");
    if (!b.head && idxs.length > 1 && kl.length === idxs.length) { idxs.forEach((i, k) => merged.set(i, { ...layers[i], ko: kl[k], drop: false, block: [i], ko_lines: [layers[i].ko] })); continue; }
    merged.set(idxs[0], { ...mem[0], zh: mem.map((l) => S(l.zh)).join("\n"), ko, drop: false, block: idxs, head: !!b.head && ko.includes("\n"), ko_lines: mem.map((l) => l.ko) });
  }
  const out = []; layers.forEach((l, i) => { if (merged.has(i)) out.push(merged.get(i)); else if (!taken.has(i)) out.push(l); });
  return { layers: out, used, rejected };
}

// ---------- 👁 구글 비전 카피(2026-11-24): 원본 그림을 직접 보고 한국 브랜드 상세페이지 톤으로 문구표 생성 ----------
//  줄 단위 번역·장 단위 편집(그림 안 봄)을 대신한다. 범용 구조·문체 규칙만 두고 상품별 낱말 예시는 넣지 않는다.
export const VISION_COPY_SYSTEM = `당신은 한국 대형 이커머스 상위 브랜드의 상세페이지 카피라이터입니다.
첨부한 중국 쇼핑몰 상세페이지 이미지를 직접 보고, 이미지 안의 중국어 문구를 한국 브랜드 상세페이지에 어울리는 **담백하고 정돈된 카피**로 다시 씁니다.

[핵심 문체 규칙]
1. 설명조·구어체·홈쇼핑 멘트를 쓰지 않습니다.
   - 제목·부제·라벨에 서술형·권유형 어미("~하세요", "~해보세요", "~진짜죠", "~좋습니다", "~됩니다", "~해야 함")를 쓰지 않습니다.
   - 느낌표(!), 물결(~), 말줄임, 의성어·의태어, 과장 수식어(완벽, 최고, 1위, 100%, 무조건 등)를 쓰지 않습니다.
2. 딱딱한 한자어·보고서/매뉴얼식 명사 나열을 피합니다.
   - "~을 이용한 OO XX" 같은 문어체·기술보고서 말투 대신, 한국 쇼핑몰 구매자가 평소 읽고 검색하는 **쉽고 자연스러운 일상어**로 씁니다.
   - 직역투·낯선 외래어 대신 한국에서 실제 통용되는 쉬운 표현을 고릅니다.
3. 역할별 길이와 호흡:
   - 큰 제목(title): 핵심 이점·특징 한 가지만 담아 **명사형** 또는 **부사형("~하게", "~있게", "~없이", "~까지")** 으로 짧게 끊습니다(한 줄 12자 안팎, 필요 시 2줄).
   - 부제(sub): 대상·용도·핵심 스펙을 간결하게 적습니다(한 줄 18자 이내, 나열은 가운뎃점 "·" 사용, 슬래시·세로줄 금지).
   - 사진 위 라벨·비교 항목(label): 짧고 쉬운 표현으로 통일합니다(2~5단어).
   - 표 칸(table): 원문 항목·수치를 정확히 살린 짧은 명사형으로 적습니다. 같은 뜻의 단어를 중복 나열하지 않습니다.
   - 긴 안내·팁 박스(body): 2문장 이상 긴 설명이 있는 박스만 예외적으로 **첫 줄 짧은 소제목(명사구, head=true) + 담백한 존댓말("~합니다 / ~할 수 있습니다") 2~3줄**로 군말 없이 압축합니다.
4. 원문 자리 존중: 중국어 특유의 감탄·반복·자랑 군말은 과감히 덜어내고, 글이 원본 자리를 넘겨 사진이나 도형을 덮지 않게 짧게 맞춥니다.
5. 사실 유지: 숫자·단위·영문 모델명·규격은 원문 그대로 정확히 유지합니다. 원문에 없는 수치·기능·효능·인증·보증은 지어내지 않습니다(중국 무게 단위 斤만 1斤=0.5kg 으로 환산 허용).
6. 제외 규칙:
   - 판매자 홍보, 사은품·리뷰 이벤트, 가격·할인·배송·환불 약속, 구매자 후기, 다른 상품 추천, 판매자 공지 문구는 drop=true 로 두고 ko 를 비웁니다.
   - 이미지 전체가 사은품·리뷰 이벤트, 가격 설명, 판매 정책, 판매자 공지, 후기 모음, 다른 상품 목록이면 promo=true 로 표시하고 promo_reason 에 사유를 적습니다.
7. 한자는 한 글자도 남기지 않습니다. ko 의 줄바꿈은 \\n 으로 적습니다.
8. 항목마다 원문 뜻을 그대로 옮긴 직역(literal)도 함께 적어, 사용자가 "원문 → 직역 → 의역(ko)" 과정을 확인할 수 있게 합니다.
응답은 JSON 만.`;

export const VISION_COPY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["promo", "promo_reason", "items"],
  properties: {
    promo: { type: "boolean" },
    promo_reason: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["zh", "literal", "ko", "role", "head", "drop"],
        properties: {
          zh: { type: "string" },
          literal: { type: "string" },
          ko: { type: "string" },
          role: { type: "string", enum: ["title", "sub", "body", "label", "table"] },
          head: { type: "boolean" },
          drop: { type: "boolean" },
        },
      },
    },
  },
};

export function renderVisionCopyInput({ brief = null } = {}) {
  const L = [];
  if (brief) {
    const bits = [S(brief.product_name_ko), S(brief.product_type), S(brief.key_appeal).slice(0, 140)].filter(Boolean);
    if (bits.length) L.push(`[상품 정보] ${bits.join(" · ")}`, "");
  }
  L.push("첨부한 상세페이지 이미지의 중국어 문구를 한국 브랜드 상세페이지 카피로 바꿔 JSON 으로 답해 주세요.");
  return L.join("\n");
}

// 중국 斤 단위 환산 숫자 허용(예: 600斤 → 300)
function allowedNumbersFrom(texts = []) {
  const set = new Set();
  for (const t of texts) {
    const s = String(t || "");
    for (const n of digits(s)) set.add(n);
    for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*斤/g)) {
      const half = Math.round(Number(m[1]) * 0.5 * 10) / 10;
      if (Number.isFinite(half)) set.add(String(half));
    }
    if (/百斤/.test(s)) set.add("50");
    if (/千斤/.test(s)) set.add("500");
  }
  return set;
}

// 비전 카피 결과 정화·검증: 한자·금지어·지어낸 숫자·과한 문장부호를 거른다 → { ok, promo, promo_reason, layers, rejected }
export function sanitizeVisionCopy(res = null, { ocrLayers = [], banned = () => [] } = {}) {
  if (!res || typeof res !== "object") return { ok: false, promo: false, promo_reason: "", layers: [], rejected: ["응답 없음"] };
  const promo = !!res.promo;
  const promo_reason = S(res.promo_reason).slice(0, 120);
  const rawItems = Array.isArray(res.items) ? res.items : [];
  if (promo) return { ok: true, promo: true, promo_reason: promo_reason || "홍보·정책·안내 이미지", layers: [], rejected: [] };
  const poolNums = allowedNumbersFrom([
    ...rawItems.map((x) => x?.zh),
    ...(ocrLayers || []).flatMap((l) => [l?.zh, l?.ko]),
  ]);
  const layers = [], rejected = [];
  for (const it of rawItems) {
    const zh = String(it?.zh || "").split("\n").map(S).filter(Boolean).join("\n");
    if (!zh) continue;
    const literal = String(it?.literal || "").split("\n").map(S).filter(Boolean).join("\n");
    const role = ["title", "sub", "body", "label", "table"].includes(it?.role) ? it.role : "body";
    if (it?.drop || !S(it?.ko)) {
      layers.push({ zh, literal, ko: "", drop: true, role, head: false });
      continue;
    }
    let ko = String(it.ko || "").split("\n").map(S).filter(Boolean).join("\n");
    // 나열 기호(/ |)를 가운뎃점으로 정리(숫자/숫자 비율은 유지)
    ko = ko.split("\n").map((ln) => ln.replace(/(?<![\dA-Za-z])\s*[\/|｜]\s*(?![\dA-Za-z])/g, ln.includes("·") ? ", " : " · ")).join("\n");
    // 제목·부제·라벨·표 끝의 느낌표/물결 제거(담백한 톤 유지)
    if (role !== "body") ko = ko.split("\n").map((ln) => ln.replace(/[!~～]+$/g, "").trim()).filter(Boolean).join("\n");
    else ko = ko.replace(/!+/g, "");
    if (!ko) { layers.push({ zh, literal, ko: "", drop: true, role, head: false }); continue; }
    if (hanCount(ko)) { rejected.push(`${zh.slice(0, 10)}: 한자 남음`); continue; }
    const bad = banned(ko);
    if (bad && bad.length) { rejected.push(`${zh.slice(0, 10)}: 금지 문구(${[].concat(bad).slice(0, 2).join(",")})`); continue; }
    const itemNums = allowedNumbersFrom([zh]);
    const invented = numTokens(ko).filter((n) => !itemNums.has(n) && !poolNums.has(n));
    if (invented.length) { rejected.push(`${zh.slice(0, 10)}: 없던 숫자(${invented.join(",")})`); continue; }
    layers.push({ zh, literal, ko, ko_ai: ko, drop: false, role, head: !!it.head && ko.includes("\n") });
  }
  const hasUsable = layers.some((l) => !l.drop && S(l.ko)) || (layers.length > 0 && rawItems.every((x) => x?.drop || !S(x?.ko)));
  return { ok: hasUsable, promo: false, promo_reason: "", layers, rejected };
}

// 통째로 그린 그림의 OCR 상자(seenBoxes) 또는 원본 OCR 상자(origBoxes)에서 각 레이어의 위치(box: {x,y,w,h})를 찾아 붙인다.
//  미리보기 더블클릭 즉시 편집 시 정확한 위치에 편집창을 띄우고, 그 자리만 빠르게 지워 새 글자를 얹기 위함.
export function matchBakeBoxes(layers = [], { seenBoxes = [], origBoxes = [], w0 = 0, h0 = 0, w1 = 0, h1 = 0 } = {}) {
  const valid = (b) => b && Number.isFinite(b.x) && Number.isFinite(b.y) && b.w > 0 && b.h > 0 && S(b.text);
  const seen = (seenBoxes || []).filter(valid);
  const sx = w0 > 0 && w1 > 0 ? w1 / w0 : 1, sy = h0 > 0 && h1 > 0 ? h1 / h0 : 1;
  const orig = (origBoxes || []).filter(valid).map((b) => ({ ...b, x: Math.round(b.x * sx), y: Math.round(b.y * sy), w: Math.round(b.w * sx), h: Math.round(b.h * sy) }));
  const union = (arr) => {
    const x0 = Math.min(...arr.map((b) => b.x)), y0 = Math.min(...arr.map((b) => b.y));
    const x1 = Math.max(...arr.map((b) => b.x + b.w)), y1 = Math.max(...arr.map((b) => b.y + b.h));
    return { x: Math.round(x0), y: Math.round(y0), w: Math.max(1, Math.round(x1 - x0)), h: Math.max(1, Math.round(y1 - y0)) };
  };
  const matchIn = (text, pool, used) => {
    const lines = String(text || "").split("\n").map(S).filter(Boolean);
    if (!lines.length || !pool.length) return null;
    const picked = [];
    for (const ln of lines) {
      const k = norm(ln);
      if (!k) continue;
      let best = null, bestScore = 0;
      for (const b of pool) {
        if (used.has(b)) continue;
        const bt = norm(b.text);
        if (!bt) continue;
        const sc = bt === k ? 1 : (bt.includes(k) || k.includes(bt)) ? Math.min(k.length, bt.length) / Math.max(k.length, bt.length) * 0.95 : Math.max(textHit(ln, b.text), textHit(b.text, ln) * 0.9);
        if (sc > bestScore) { bestScore = sc; best = b; }
      }
      if (best && bestScore >= 0.42) { picked.push(best); used.add(best); }
    }
    if (picked.length) return union(picked);
    // 한 줄에 여러 OCR 상자가 쪼개져 들어간 경우(예: "대형 투입구" + "업소용")
    const full = norm(lines.join(""));
    const subs = pool.filter((b) => !used.has(b) && norm(b.text).length >= 2 && full.includes(norm(b.text)));
    if (subs.length) {
      subs.forEach((b) => used.add(b));
      return union(subs);
    }
    return null;
  };
  const usedSeen = new Set(), usedOrig = new Set();
  return (layers || []).map((l) => {
    if (!l || l.drop) return l;
    if (l.box && l.box.w > 0 && l.box.h > 0) return l;
    const box = matchIn(l.ko, seen, usedSeen) || matchIn(l.zh, orig, usedOrig);
    return box ? { ...l, box } : l;
  });
}
