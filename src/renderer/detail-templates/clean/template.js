// 클린 템플릿 — 화이트 바탕 · 초록 포인트 · 둥근 카드 (공통 로직은 ../common/render-core.js)
window.TEMPLATE = { id: "clean", num: (i) => String(i + 1).padStart(2, "0") };
window.renderPlan = (plan, baseUrl) => window.SeedhackRender.render(plan, baseUrl);
