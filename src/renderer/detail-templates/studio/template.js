// 스튜디오 템플릿(v2) — 제품 사진 팔레트로 아트디렉션, 누끼 무대, 라인 아이콘(이모지 금지), 섹션 배경 톤 교대
window.TEMPLATE = { id: "studio", noEmoji: true, usePalette: true, num: (i) => String(i + 1).padStart(2, "0"),
  labels: { gallery: "디테일", spec: "제품 정보", size: "사이즈", package: "구성", notice: "배송 · 교환 · 주의", faq: "자주 묻는 질문",
    benefits: "이렇게 다릅니다", proof: "숫자로 보는 차이", compare: "일반 제품과 비교하면", steps: "사용은 이렇게", objections: "이런 점이 걱정되시나요?", trust: "믿고 고르셔도 됩니다" } };
window.renderPlan = (plan, baseUrl) => window.SeedhackRender.render(plan, baseUrl);
