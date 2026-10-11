// 장면 컷 기획(순수 로직) — 제품 정보로 "한국 생활 장면" 이미지 생성 프롬프트 6~8컷을 만든다.
// 레퍼런스(docs/detail/REFERENCE-myzzoo-plantshelf.md): 사내 디자이너는 중국 제품 사진을 나노바나나/ChatGPT 로
//   hero(밝은 스튜디오·거실) → 기능별 point(그 기능을 "보여주는" 장면) → usage(베란다·창가 실사용) → detail(소재 클로즈업) → storage(접어서 보관) 로 다시 찍었다.
// 출력 shots: [{ id, purpose: "hero"|"point"|"usage"|"detail"|"storage", title_ko, prompt_ko, prompt_en, feature? }]

// 모든 컷에 붙는 공통 규칙(제품 왜곡·글자 방지가 가장 중요)
export const RULE_KO = "입력 사진 속 제품의 형태·색·구조·비율·부품 수를 절대 바꾸지 말 것(입력 사진과 동일한 제품). 글자·로고·워터마크·가격표 없음. 테두리·액자·여백 없이 화면 끝까지 꽉 찬 사진. 포장·병·가전의 라벨에도 글자·숫자·브랜드 없음. 다른 브랜드 가전·제품(정수기·커피머신·전자레인지 등 브랜드가 보이는 기기) 금지. 로고·브랜드명·글자 어디에도 없음. 입력 제품이 화면의 주인공 — 전체가 잘리지 않고 보이며 가장 큰 면적을 차지, 소품은 작고 브랜드 없이 보조로만. 한국 아파트 인테리어, 사실적인 사진(광고 촬영 톤), 소품은 제품 용도에 맞게 최소한으로.";
export const RULE_EN = "Keep the product exactly as in the input photo — do not change its shape, color, structure, proportions or number of parts. No text, no letters, no logos, no watermarks, no price tags. No border, no frame, no white margin — full-bleed photo edge to edge. Any packaging, jars, tea bags or appliances must have blank labels with no readable words, numbers or brand names. No other branded appliances or products (no water purifiers, coffee machines, microwaves or any device with a visible brand). No logos, no brand names, no text anywhere. The input product must be the clear main subject, fully visible and uncropped, occupying the largest area of the frame; any props must be small, unbranded and secondary. Korean apartment interior, photorealistic commercial product photography, natural soft daylight with realistic shadows, props only where they fit the product's use, minimal and tidy.";

// 카테고리 → 주 사용 장소(한국 아파트 기준)
const PLACES = [
  { re: /화분|식물|가드닝|원예|플랜트|plant|다육|화초|선반.*꽃|꽃/i, key: "plant", ko: "햇살 드는 아파트 베란다 창가", en: "a sunny Korean apartment veranda by the window", prop_ko: "다육이·작은 화분", prop_en: "small potted succulents and green plants" },
  { re: /빨래|건조대|옷걸이|행거|세탁|laundry|hanger/i, key: "laundry", ko: "밝은 아파트 베란다 세탁 공간", en: "a bright Korean apartment veranda laundry corner", prop_ko: "수건·셔츠", prop_en: "folded towels and a few shirts" },
  { re: /주방|키친|싱크|양념|그릇|냄비|조리|kitchen/i, key: "kitchen", ko: "화이트 톤 아파트 주방 조리대", en: "a clean white Korean apartment kitchen countertop", prop_ko: "도마·양념통", prop_en: "a wooden cutting board and a few seasoning jars" },
  { re: /욕실|화장실|샤워|bath|타월/i, key: "bath", ko: "밝은 타일 욕실", en: "a bright tiled Korean apartment bathroom", prop_ko: "수건·디스펜서", prop_en: "white towels and a soap dispenser" },
  { re: /책상|사무|데스크|모니터|노트북|desk/i, key: "desk", ko: "정돈된 원룸 책상", en: "a tidy desk in a Korean studio apartment", prop_ko: "노트·머그컵", prop_en: "a paper notebook and a mug" },
  { re: /수납|정리함|바구니|박스|옷장|드레스룸|storage/i, key: "storage", ko: "깔끔한 드레스룸·거실 수납장 옆", en: "a neat Korean apartment dressing room", prop_ko: "개어 둔 옷", prop_en: "neatly folded clothes" },
  { re: /캠핑|아웃도어|camp/i, key: "camp", ko: "잔디 캠핑장", en: "a grassy campsite", prop_ko: "캠핑 의자·랜턴", prop_en: "a camping chair and a lantern" },
  { re: /반려|강아지|고양이|pet/i, key: "pet", ko: "햇살 드는 거실", en: "a sunny Korean apartment living room", prop_ko: "강아지 또는 고양이", prop_en: "a calm small dog or cat" },
];
const DEFAULT_PLACE = { key: "living", ko: "밝은 아파트 거실", en: "a bright Korean apartment living room", prop_ko: "쿠션·작은 화분", prop_en: "a cushion and a small plant" };

// 기능 키워드 → 그 기능을 "보여주는" 장면(레퍼런스: 물방울·손으로 펴기·물 주기·무거운 물건·접어서 기대기)
const FEATURES = [
  { re: /접이|접어|폴딩|접히|folding|fold/i, key: "fold", title: "접어서 보관",
    ko: "손으로 제품을 접는 순간(접히는 구조가 보이게)", en: "a pair of hands folding the product, the folding joints clearly visible" },
  { re: /방수|물\s?빠짐|물받이|녹\s?방지|녹슬|부식|waterproof|rust/i, key: "water", title: "물에 강한 소재",
    ko: "제품 표면에 물방울이 맺힌 클로즈업, 호스로 물을 주는 손", en: "close-up of water droplets beading on the product surface, a hand watering with a hose nearby" },
  { re: /하중|내하중|튼튼|견고|kg|무게|단단|흔들림|stable|load/i, key: "load", title: "튼튼한 구조",
    ko: "무거운 물건(큰 화분·책 더미 등)을 가득 올린 모습", en: "the product fully loaded with heavy items, standing firm and level" },
  { re: /높이\s?조절|길이\s?조절|늘어|확장|펴|슬라이드|adjust|extend/i, key: "adjust", title: "길이·높이 조절",
    ko: "손으로 제품을 펴거나 늘리는 동작", en: "hands extending and adjusting the product, showing the adjustable part" },
  { re: /조립|공구\s?없|원터치|간편|설치|assembl|tool/i, key: "easy", title: "간편한 설치",
    ko: "공구 없이 손으로 끼워 조립하는 장면", en: "hands assembling the product without tools in a few seconds" },
  { re: /통풍|환기|공기|배수|구멍|ventil/i, key: "air", title: "통풍·배수",
    ko: "틈 사이로 빛과 바람이 통하는 모습(위에서 내려다본 각도)", en: "light passing through the gaps of the product, seen from a high angle, airy feel" },
  { re: /계단|단|층|tier|다단/i, key: "tier", title: "단마다 넉넉하게",
    ko: "단마다 크기가 다른 물건을 정리해 올린 모습", en: "each tier neatly filled with items of different heights" },
  { re: /미끄럼|논슬립|고무|바닥\s?보호|non.?slip/i, key: "grip", title: "바닥 보호",
    ko: "다리 끝 미끄럼 방지 패드가 마루 위에 닿은 클로즈업", en: "close-up of the non-slip feet resting on a wooden floor" },
  { re: /소재|재질|스틸|철제|알루미늄|원목|금속|도장|분체|steel|metal|wood/i, key: "material", title: "견고한 소재",
    ko: "소재의 결과 마감이 보이는 매크로 클로즈업", en: "macro close-up of the material texture and finish" },
];

// 텍스트 모으기
const textOf = (product) => {
  const p = product || {};
  const attrs = (p.attrs_ko || p.attrs || []).map((a) => (typeof a === "string" ? a : `${a.k_ko || a.k || ""} ${a.v_ko || a.v || ""}`));
  return [p.title_ko, p.category, ...(p.features || []), ...attrs].filter(Boolean).join(" ");
};
export function pickPlace(product) {
  const t = textOf(product);
  return PLACES.find((p) => p.re.test(t)) || DEFAULT_PLACE;
}
export function pickFeatures(product, max = 4) {
  const t = textOf(product);
  const out = [];
  for (const f of FEATURES) if (f.re.test(t) && !out.some((x) => x.key === f.key)) out.push(f);
  return out.slice(0, max);
}

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const shot = (id, purpose, title_ko, scene_ko, scene_en, extra = {}) => ({
  id, purpose, title_ko,
  prompt_ko: `${scene_ko}. ${RULE_KO}`,
  prompt_en: `${cap(scene_en)}. ${RULE_EN}`,
  ...extra,
});

// styleGuide(제품별 디자인 시스템, brief.js v3) → 모든 컷 공통 문장 + 제품 사용 금지 규칙
export const FORBIDDEN_DEFAULT_KO = "제품 사진이 없는 장면에 제품을 새로 그려 넣지 말 것. 입력 사진과 다른 모양·개수의 제품을 만들지 말 것.";
export const FORBIDDEN_DEFAULT_EN = "Do not invent the product where it is not in the input photo; never create a product with a different shape or part count than the input.";
export function styleRule(styleGuide = null) {
  const g = styleGuide || {};
  const parts = [g.lighting && `조명: ${g.lighting}`, g.materialMood && `소재 분위기: ${g.materialMood}`, g.backgroundTone && `배경 톤: ${g.backgroundTone}`, ...(g.consistencyRules || []).slice(0, 6)].filter(Boolean);
  const ko = `${parts.length ? `디자인 톤(모든 컷 공통): ${parts.join(" / ")}. ` : ""}${g.forbiddenProductUsage || FORBIDDEN_DEFAULT_KO}`;
  const en = `${parts.length ? `Visual style for every shot (keep consistent): ${parts.join("; ")}. ` : ""}${FORBIDDEN_DEFAULT_EN}${g.forbiddenProductUsage ? ` Also: ${g.forbiddenProductUsage}` : ""}`;
  return { ko, en };
}

// product: { title_ko, title_en?, category, attrs_ko:[{k_ko,v_ko}|string], features:["접이식","방수",...] }, brief: { tone?, place?, avoid? } (선택), styleGuide(선택)
export function planShots({ product = {}, brief = {}, styleGuide = null } = {}) {
  // 영문 프롬프트엔 한글 상품명을 넣지 않는다(모델이 글자로 그려 넣는 일이 있다) — title_en 이 있을 때만
  const name = product.title_en ? `the ${String(product.title_en).slice(0, 60)} from the input photo` : "the product from the input photo";
  const nameKo = product.title_ko ? `제품(${String(product.title_ko).slice(0, 40)})` : "제품";
  const place = brief.place ? { ...DEFAULT_PLACE, ko: brief.place, en: brief.place_en || brief.place } : pickPlace(product);
  const feats = pickFeatures(product, 4);
  const shots = [];
  // 1. hero — 밝은 회색 스튜디오 또는 거실, 자연광 그림자
  shots.push(shot("s01", "hero", "대표 컷",
    `${nameKo}을 밝은 회색 스튜디오 바닥(또는 ${place.ko})에 정면 3/4 각도로 크게 놓은 대표 사진, 창으로 들어온 자연광 그림자, 여백 넉넉히`,
    `Hero shot of ${name} placed large in the frame on a light gray seamless studio floor with soft window-light shadows (or in ${place.en}), three-quarter front angle, generous negative space`));
  // 2~5. 기능별 point 컷 — 그 기능을 보여 주는 장면
  feats.filter((f) => f.key !== "fold").forEach((f, i) => {
    shots.push(shot(`s${String(shots.length + 1).padStart(2, "0")}`, "point", f.title,
      `${place.ko}에서 ${nameKo}: ${f.ko}`, `Showing ${name} in ${place.en}: ${f.en.replace(/the product surface/g, "its surface").replace(/the product/g, "it")}`, { feature: f.key }));
  });
  // 기능이 적으면 일반 point 컷을 채운다(최소 2컷)
  const fillers = [
    ["손이 닿는 쓰임", `${place.ko}에서 사람이 ${nameKo}을 자연스럽게 사용하는 손 클로즈업`, `close-up of a person's hands naturally using ${name} in ${place.en}`],
    ["딱 맞는 크기", `${place.ko}의 벽·창 옆 빈 공간에 ${nameKo}이 딱 맞게 들어간 모습`, `${name} fitting perfectly into an empty corner next to the wall in ${place.en}`],
  ];
  for (let k = 0; shots.filter((s) => s.purpose === "point").length < 2 && k < fillers.length; k++) {
    const [t, ko, en] = fillers[k];
    shots.push(shot(`s${String(shots.length + 1).padStart(2, "0")}`, "point", t, ko, en));
  }
  // usage — 실사용(소품 가득)
  shots.push(shot(`s${String(shots.length + 1).padStart(2, "0")}`, "usage", "실제 사용 모습",
    `${place.ko}에 ${nameKo}을 두고 ${place.prop_ko}을(를) 가득 올려 실제로 쓰는 모습, 생활감 있지만 깔끔하게`,
    `${name} in real daily use in ${place.en}, filled with ${place.prop_en}, lived-in but tidy, wide shot`));
  // detail — 소재 클로즈업
  shots.push(shot(`s${String(shots.length + 1).padStart(2, "0")}`, "detail", "디테일",
    `${nameKo}의 이음새·소재 마감을 보여 주는 매크로 클로즈업, 얕은 심도`,
    `Macro close-up of the joints and material finish of ${name}, shallow depth of field`));
  // storage — 접이식이면 접어서 벽에 기대 둔 모습
  if (feats.some((f) => f.key === "fold")) {
    shots.push(shot(`s${String(shots.length + 1).padStart(2, "0")}`, "storage", "접어서 보관",
      `${nameKo}을 납작하게 접어 ${place.ko} 벽에 기대 세워 둔 모습`, `${name} folded flat and leaned against the wall in ${place.en}, showing how slim it becomes`, { feature: "fold" }));
  }
  // 6컷 미만이면 각도 다른 usage 컷 추가, 8컷 넘으면 point 를 줄인다
  if (shots.length < 6) shots.push(shot(`s${String(shots.length + 1).padStart(2, "0")}`, "usage", "위에서 본 모습",
    `${place.ko}에서 ${nameKo}을 위에서 내려다본 각도, 바닥에 햇빛 그림자`, `High-angle top-down view of ${name} in ${place.en} with sunlight shadows on the floor`));
  while (shots.length > 8) { const i = shots.map((s) => s.purpose).lastIndexOf("point"); shots.splice(i, 1); }
  const sr = styleRule(styleGuide); // 디자인 톤·제품 사용 금지(모든 컷 공통) — "피할 것"은 맨 끝에 오도록 그 앞에
  for (const s of shots) { s.prompt_ko += ` ${sr.ko}`; s.prompt_en += ` ${sr.en}`; }
  if (brief.avoid) for (const s of shots) { s.prompt_ko += ` 피할 것: ${brief.avoid}.`; s.prompt_en += ` Avoid: ${brief.avoid_en || brief.avoid}.`; }
  shots.forEach((s, i) => { s.id = `s${String(i + 1).padStart(2, "0")}`; });
  return shots;
}

// ---- v5: 섹션별 장면 레시피(Moast 2단계 벤치마크 — 섹션마다 목적에 맞는 장면 1장, 글자는 HTML 로 얹으므로 글자 자리를 비워 둔다) ----
// sections: [{ id, type, copy:{ title, sub }, textZone:"top"|"bottom"|"left"|"none", needs }]  — textZone 은 hero 만 기본 top, 나머지는 none(글자는 사진 밖)
// 반환 shots: [{ id, sectionId, type, purpose, aspect, n, textZone, title_ko, prompt_ko, prompt_en }]  (versatility 는 장소별 4컷)
// 글자 자리(빈 여백)는 hero 만 — 나머지 섹션의 글자는 사진 밖(템플릿의 띠·카드)에 둔다(Moast 결과 확인, 지휘자 판정: 빈 상판이 반인 ba 는 사용 불가).
export const SECTION_RECIPES = {
  hero: { aspect: "2:3", n: 2, textZone: "top", purpose: "hero" },
  before_after: { aspect: "4:3", n: 1, textZone: "none", purpose: "point" },
  checkpoint: { aspect: "4:5", n: 1, textZone: "none", purpose: "hero" },
  feature: { aspect: "4:3", n: 1, textZone: "none", purpose: "point" },
  options: { aspect: "4:3", n: 1, textZone: "none", purpose: "detail" },
  detail: { aspect: "1:1", n: 1, textZone: "none", purpose: "detail" },
  versatility: { aspect: "1:1", n: 1, textZone: "none", purpose: "usage" },
};
// 글자 자리가 없는 컷: 피사체가 화면을 꽉 채우게
const FILL_EN = "Compose tightly: the product and its scene fill the frame — the product itself takes up at least 60% of the image — with no large empty wall, floor or countertop areas.";
const FILL_KO = "제품·장면이 화면을 꽉 채우게(제품이 화면의 60% 이상), 넓은 빈 벽·바닥·상판 없이.";
// 글자 자리(빈 여백) 문장 — 크기는 레시피별
const ZONE_EN = {
  top: (p) => `Keep the top ${p}% of the frame completely empty: a plain, softly lit bright wall with nothing on it (reserved for headline text added later); the product sits in the lower part of the frame`,
  bottom: (p) => `The photo fills the entire frame; the lower ${p}% shows only the clean, continuing countertop or floor surface in the same light (part of the photo, not a white area, nothing placed there), reserved for text added later`,
  left: (p) => `Keep the left ${p}% of the frame empty (plain wall), product on the right side`,
  none: () => "",
};
const ZONE_KO = { top: (p) => `화면 위 ${p}% 는 아무것도 없는 밝은 벽(나중에 글자가 들어갈 자리), 제품은 아래쪽`, bottom: (p) => `화면 아래 ${p}% 는 비워 둔 평평한 바닥/상판(글자 자리)`, left: (p) => `화면 왼쪽 ${p}% 는 빈 벽, 제품은 오른쪽`, none: () => "" };
const ZONE_PCT = { hero: 35, before_after: 25, checkpoint: 20, feature: 20, options: 15, detail: 15, versatility: 15 };

// 카테고리별 활용 장소 4곳(versatility) — 제품 텍스트에 맞는 장소부터, 모자라면 일반 장소로 채움
const VERSA = {
  kitchen: [["홈카페 조리대", "a cozy home-cafe kitchen counter with a coffee machine"], ["사무실 탕비실", "an office pantry counter"], ["책상 위", "a tidy work desk next to a monitor"], ["홈바 카운터", "a home bar counter with warm evening light"]],
  desk: [["책상 위", "a tidy work desk next to a monitor"], ["거실 사이드", "a living room side table area"], ["침실 협탁", "a bedroom nightstand area"], ["주방 조리대", "a kitchen countertop"]],
  plant: [["베란다 창가", "a sunny apartment veranda by the window"], ["거실 창가", "a living room window corner"], ["현관 옆", "an apartment entryway corner"], ["작은 마당", "a small garden patio"]],
  bath: [["욕실 세면대", "a bathroom vanity counter"], ["세탁실", "a laundry room shelf"], ["주방 싱크대", "a kitchen sink area"], ["현관", "an entryway shelf"]],
  default: [["거실", "a bright living room"], ["주방", "a kitchen countertop"], ["침실", "a calm bedroom corner"], ["작업 책상", "a tidy work desk"]],
};
export function versatilityPlaces(product) {
  const t = textOf(product);
  const key = PLACES.find((p) => p.re.test(t))?.key;
  return (VERSA[key] || VERSA.default).slice(0, 4);
}


// 가전이 꼭 필요한 장면은 브랜드 없는 일반 기계를 작게, 일부만(지휘자 판정: 입력 사진의 coway 정수기를 따라 그려 hero 를 못 씀)
export const GENERIC_APPLIANCE_EN = "a plain unbranded generic white coffee machine, partially out of frame, smaller than the product";
export const GENERIC_APPLIANCE_KO = "브랜드 없는 평범한 흰 커피머신(일부만 보이고 제품보다 작게)";
// 장소 라벨(한글) → 그 장소임이 한눈에 보이는 배경·소품(versatility 컷마다 뚜렷이 다르게 — 지휘자 판정: 4컷이 다 같은 주방이었다)
const PLACE_LIB = [
  [/홈카페|카페/, `a cozy home-cafe corner: ${GENERIC_APPLIANCE_EN}, ceramic cups, a small bag of coffee beans and a small plant on a light wood counter`, `${GENERIC_APPLIANCE_KO}·도자기 컵·원두 봉투가 있는 홈카페 코너`],
  [/탕비실|오피스|사무실/, "an office pantry: a stack of paper cups, plain coffee bean canisters and a tray of mugs on a laminate counter, office partitions softly blurred behind (no water dispenser, no microwave)", "종이컵·민무늬 원두통·머그 쟁반이 있는 사무실 탕비실(정수기·전자레인지 없음)"],
  [/데스크|책상|작업실|공부/, "a work desk: a computer monitor, a keyboard, an open notebook with a pen and a desk lamp, desk chair edge visible", "모니터·키보드·노트·스탠드가 있는 책상"],
  [/바\s?카운터|홈바|바$|술/, "a home bar counter in warm evening light: a cocktail shaker, rocks glasses, a few bottles with blank labels and a lemon", "셰이커·온더락 잔·병(라벨 없음)이 있는 저녁 홈바 카운터"],
  [/욕실|화장실|세면/, "a bathroom vanity: a sink, folded white towels, pump bottles with blank labels, tiled wall", "세면대·수건·라벨 없는 펌프병이 있는 욕실"],
  [/세탁|다용도/, "a laundry room: a washing machine, a laundry basket with folded towels, plain detergent bottles", "세탁기·빨래 바구니가 있는 세탁실"],
  [/침실|협탁|안방/, "a bedroom: a nightstand area next to a bed with linen bedding, a small lamp, a book and a glass of water", "침대 옆 협탁·스탠드·책이 있는 침실"],
  [/거실/, "a living room: next to a sofa with cushions, a rug, a remote control and magazines", "소파·쿠션·러그가 있는 거실"],
  [/주방|키친|조리/, "a kitchen countertop: plain spice jars, a cutting board and a fruit bowl, kitchen cabinets behind", "민무늬 양념병·도마·과일 그릇이 있는 주방 조리대"],
  [/베란다|발코니/, "a sunny apartment veranda with potted plants and a window", "화분이 있는 햇살 드는 베란다"],
  [/현관|신발/, "an apartment entryway: a shoe cabinet, sneakers on the floor, a key tray", "신발장·운동화가 있는 현관"],
  [/드레스룸|옷장/, "a dressing room: hanging clothes, folded sweaters, a full-length mirror", "옷·니트·전신 거울이 있는 드레스룸"],
  [/아이방|아이|키즈/, "a child's room: colorful toys, picture books, a small desk", "장난감·그림책이 있는 아이방"],
  [/원룸/, "a compact studio apartment corner with a small table and a bed in the background", "작은 테이블·침대가 보이는 원룸"],
  [/캠핑/, "a campsite: a folding table, a lantern and a tent in the background", "접이식 테이블·랜턴이 있는 캠핑장"],
  [/차량|자동차/, "inside a car trunk with a few bags", "차 트렁크"],
  [/매장|가게/, "a small shop counter with a card reader and display items", "작은 매장 카운터"],
];
export function placeScene(label) {
  const t = String(label || "").trim();
  const hit = PLACE_LIB.find(([re]) => re.test(t));
  return hit ? { en: hit[1], ko: hit[2] } : { en: `a ${t || "home"} setting with props that clearly identify this place`, ko: `${t} 장소임이 분명한 배경·소품` };
}
// 섹션에서 장소 목록: shot.places → sec.places → needs "활용 장소 4곳: a / b / c / d" → 카테고리 기본
export function sectionPlaces(sec, product) {
  const list = sec?.shot?.places || sec?.places;
  if (Array.isArray(list) && list.length) return list.slice(0, 4).map(String);
  const m = String(sec?.shot?.needs || sec?.needs || "").match(/장소[^:：]*[:：]\s*(.+)$/);
  if (m) { const p = m[1].split(/\s*[\/·,、]\s*/).map((x) => x.trim()).filter(Boolean); if (p.length) return p.slice(0, 4); }
  return versatilityPlaces(product).map(([ko]) => ko);
}
// 디테일 부품(한글) → 영문 부품명. 섹션 shot.parts → sec.parts → 제품 글에서 찾은 부품 → 기본(손잡이·도장면)
const PART_LIB = [
  [/손잡이|핸들|handle/i, "the handle"], [/레일|가드|난간|rail/i, "the guard rail"], [/패드|미끄럼|고무|매트|pad/i, "the non-slip pad on the bottom"],
  [/도장|표면|마감|코팅|coat/i, "the powder-coated surface finish"], [/모서리|엣지|라운드|edge/i, "the rounded edge"], [/슬라이드|서랍|drawer/i, "the drawer slide mechanism"],
  [/이음새|조인트|연결|joint/i, "the joint"], [/나사|볼트|screw/i, "the screws"], [/다리|leg/i, "the leg"], [/경첩|hinge/i, "the hinge"],
];
export function sectionParts(sec, product, max = 2) {
  const list = sec?.shot?.parts || sec?.parts;
  const src = Array.isArray(list) && list.length ? list.map(String) : null;
  if (src) return src.slice(0, 3).map((ko) => ({ ko, en: (PART_LIB.find(([re]) => re.test(ko)) || [null, `the ${ko}`])[1] }));
  const t = [textOf(product), sec?.shot?.needs, sec?.needs].filter(Boolean).join(" ");
  const found = PART_LIB.filter(([re]) => re.test(t)).map(([re, en]) => ({ ko: String(re).match(/\/([^|\\/]+)/)[1], en }));
  const out = [...found];
  for (const d of [{ ko: "손잡이", en: "the handle" }, { ko: "도장", en: "the powder-coated surface finish" }, { ko: "모서리", en: "the rounded edge" }]) if (out.length < max && !out.some((x) => x.en === d.en)) out.push(d); // 모자라면 기본 부품으로 채움
  return out.slice(0, max);
}

// 섹션 하나 → 장면 문장(영문·한글). 제품은 "the exact product from the input photo".
function sectionScene(type, { P, place, feat, needs, copy }) {
  const idea = needs || copy?.title ? ` Scene idea (Korean note for meaning only — never write it as text): ${[needs, copy?.title, copy?.sub].filter(Boolean).join(" / ")}` : "";
  switch (type) {
    case "hero": return {
      en: `Editorial hero photo, camera close to the product: ${P} is the clear main subject, shown LARGE — it spans about 70–80% of the frame width (nothing else is wider than a third of the product) and sits in the lower part of a vertical frame — in ${place.en}, with only 2–3 small fitting props (${place.prop_en}; no laptop, monitor, phone or appliance), soft natural window light with gentle realistic shadows, slightly high three-quarter view, the whole product fully visible and not cropped.${idea}`,
      ko: `히어로 사진: 세로 화면 아래 55~65% 에 ${"제품"}을 크게, ${place.ko}, 소품 2~3개(${place.prop_ko}), 창으로 들어온 자연광과 부드러운 그림자, 눈높이 3/4 각도, 제품 전체가 잘리지 않게.` };
    case "before_after": return {
      en: `Horizontal 4:3 photo of one countertop, camera at counter level, same lighting across the frame, no divider: the LEFT half shows a messy countertop with scattered small items (coffee capsules, tea bags, small jars) and the product is NOT there; the RIGHT half shows ${P} shown LARGE — it fills at least 80% of the right half's width (about 70% of the frame height), camera close — with those same items neatly organized in and on it. Both states take exactly one half each.${idea}`,
      ko: `같은 상판, 카메라는 상판 높이, 구분선 없는 한 장: 왼쪽은 캡슐·티백·작은 병이 흩어진 상태(제품 없음), 오른쪽은 제품을 크게(화면 높이 70%) 두고 같은 물건을 정리한 상태.` };
    case "checkpoint": return {
      en: `Clean product-only photo of ${P} at a three-quarter angle, centered and large (spanning about 65–75% of the frame width), with a modest even margin around it (room for thin callout lines added later), on a plain light floor against a plain light wall, soft studio daylight, no props.${idea}`,
      ko: `제품 단독 3/4 각도, 가운데에 크게, 둘레에 고른 여백 조금(지시선 자리), 단순한 밝은 바닥·벽, 소품 없음.` };
    case "feature": return {
      en: `${feat ? feat.en.replace(/the product/g, "the product") + ", " : ""}a close-up or in-use moment that clearly demonstrates this feature of ${P} (for example a hand pulling a drawer open, or an appliance placed on top), in ${place.en}, natural light.${idea}`,
      ko: `그 기능을 보여주는 클로즈업 또는 사용 순간(서랍을 당기는 손, 위에 가전을 올린 모습 등), ${place.ko}.` };
    case "options": return {
      en: `Two size variants of ${P} placed side by side in the same scene (${place.en}), a smaller one and a larger one, identical design and color, same lighting, clear size difference, both fully visible.${idea}`,
      ko: `규격 2종(작은 것·큰 것)을 같은 장면에 나란히, 디자인·색 동일, 둘 다 전체가 보이게.` };
    case "detail": return {
      en: `Extreme close-up macro of the material and parts of ${P} (surface finish, edges, handle, joints) — the product part fills the frame, shallow depth of field, soft side light.${idea}`,
      ko: `소재·부품(표면 마감·모서리·손잡이·이음새) 극클로즈업, 얕은 심도.` };
    default: return { en: `${P} in ${place.en}.${idea}`, ko: `${place.ko}의 제품.` };
  }
}

export function planSectionShots({ sections = [], product = {}, brief = {}, styleGuide = null } = {}) {
  const P = product.title_en ? `the exact ${String(product.title_en).slice(0, 60)} from the input photo` : "the exact product from the input photo";
  const place = brief.place ? { ...DEFAULT_PLACE, ko: brief.place, en: brief.place_en || brief.place } : pickPlace(product);
  const sr = styleRule(styleGuide);
  // 입력 사진은 "제품 참고용" — 배경·소품까지 그대로 베끼면(1차 판정: vs-1·f1 이 입력 사진과 거의 같음) 섹션마다 같은 그림이 된다
  const REF_EN = "Use the input photos only as a reference for the product itself; build a completely new background, camera angle and props for this scene — do not reproduce the input photo's background, appliances or props. Keep the product's number of units, drawers and tiers exactly as in the product-only input photo.";
  const REF_KO = "입력 사진은 제품 모양 참고용 — 배경·가전·소품을 그대로 베끼지 말고 이 장면에 맞게 새로. 제품의 단 수·서랍 수는 제품 단독 입력 사진과 같게.";
  const RULE_NOFRAME_EN = `${REF_EN} ${RULE_EN} ${sr.en}`;
  const RULE_NOFRAME_KO = `${REF_KO} ${RULE_KO} ${sr.ko}`;
  const shots = [];
  const make = (sec, type, sceneEn, sceneKo, extra = {}) => {
    const rec = SECTION_RECIPES[type] || SECTION_RECIPES.feature;
    // 글자 자리는 hero 만(섹션이 textZone 을 줘도 hero 가 아니면 무시 — 글자는 사진 밖 띠·카드에)
    const want = sec.shot?.textZone || sec.textZone;
    const zone = type === "hero" && want && want !== "none" && ZONE_EN[want] ? want : rec.textZone;
    const pct = ZONE_PCT[type] || 20;
    const zEn = zone === "none" ? FILL_EN : ZONE_EN[zone](pct), zKo = zone === "none" ? FILL_KO : ZONE_KO[zone](pct);
    shots.push({
      id: extra.id || `${sec.id}`, sectionId: sec.id, type, purpose: rec.purpose, aspect: extra.aspect || rec.aspect, n: rec.n, textZone: zone,
      fit: zone === "none" && type !== "checkpoint", // checkpoint 는 지시선 여백이 의도(흰 제품·밝은 배경이라 빈 영역 판정도 불안정) — 글자 자리 없는 나머지 컷은 생성 뒤 빈 가장자리 30% 초과면 잘라 맞춤(내용 30% 미만이면 1회 재생성)
      title_ko: extra.title_ko || sec.copy?.title || type,
      prompt_en: `${cap(sceneEn)}${zEn ? ` ${zEn}.` : ""} ${RULE_NOFRAME_EN}`.replace(/\s+/g, " ").trim(),
      prompt_ko: `${sceneKo}${zKo ? ` ${zKo}.` : ""} ${RULE_NOFRAME_KO}`.replace(/\s+/g, " ").trim(),
    });
  };
  for (const sec of sections || []) {
    const type = SECTION_RECIPES[sec.type] ? sec.type : "feature";
    if (type === "versatility") { // 장소마다 따로, 배경·소품을 그 장소답게 뚜렷이 다르게
      sectionPlaces(sec, product).forEach((label, i) => {
        const pl = placeScene(label);
        make(sec, type,
          `${P} in real daily use, set in ${pl.en}. The background, furniture and props must make it instantly clear that this is this specific place — not a generic kitchen. A few items that belong to this place are placed on and in the product, natural light, three-quarter view, the whole product visible`,
          `${label}: ${pl.ko}. 이 장소임이 한눈에 보이게(일반 주방처럼 보이지 않게), 그 장소 물건 몇 개를 제품에 올리고 넣은 모습, 자연광, 제품 전체가 보이게`, { id: `${sec.id}-${i + 1}`, title_ko: label });
      });
      continue;
    }
    if (type === "detail") { // 부품마다 극클로즈업 1컷
      sectionParts(sec, product).forEach((pt, i) => make(sec, type,
        `Extreme close-up macro of ${pt.en} of ${P} — this part fills the frame, only a small portion of the product is visible, shallow depth of field, soft side light showing the material texture`,
        `${pt.ko} 극클로즈업 매크로 — 그 부품이 화면을 꽉 채우고 제품 전체는 보이지 않게, 얕은 심도, 소재 질감이 보이는 측광`, { id: `${sec.id}-${i + 1}`, title_ko: pt.ko }));
      continue;
    }
    const feat = type === "feature" ? pickFeatures({ features: [sec.copy?.title, sec.copy?.sub, sec.needs].filter(Boolean) }, 1)[0] : null;
    const sc = sectionScene(type, { P, place, feat, needs: sec.needs, copy: sec.copy });
    make(sec, type, sc.en, sc.ko);
  }
  return shots;
}
