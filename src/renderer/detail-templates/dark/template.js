// 다크 템플릿 — 검정/차콜 · 금색 포인트 · 프리미엄 (공통 로직은 ../common/render-core.js)
window.TEMPLATE = { id: "dark", num: (i) => "No." + (i + 1), labels: { gallery: "디테일 컷", spec: "제품 정보", size: "사이즈 안내", package: "구성품", notice: "배송 · 교환 · 주의사항", faq: "자주 묻는 질문" } };
window.renderPlan = (plan, baseUrl) => window.SeedhackRender.render(plan, baseUrl);
