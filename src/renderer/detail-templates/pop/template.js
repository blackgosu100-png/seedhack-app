// 팝 템플릿 — 밝은 컬러 블록 · 큰 숫자 · 활기 (공통 로직은 ../common/render-core.js)
window.TEMPLATE = { id: "pop", num: (i) => String(i + 1), heroImageFirst: false,
  labels: { gallery: "이렇게 생겼어요", spec: "한눈에 보는 제품 정보", size: "사이즈 확인하세요", package: "박스를 열면", notice: "꼭 읽어 주세요", faq: "궁금한 점" } };
window.renderPlan = (plan, baseUrl) => window.SeedhackRender.render(plan, baseUrl);
