// 씨드핵 상세페이지 라인 아이콘 세트(이모지 대신) — 24×24 stroke 아이콘, 글자색(currentColor) 을 따른다
// 카피(copy.json) 가 icon: "fold" 같은 키를 주면 그 아이콘, 없거나 모르는 키면 null(템플릿이 번호로 대체)
(function () {
  "use strict";
  const P = { // 이름 → path d (여러 개면 배열)
    fold: ["M4 6h16", "M4 12h10l6 6", "M4 18h8"],
    unfold: ["M4 6h16", "M4 12h16", "M4 18h16", "M20 12v6"],
    rotate: ["M20 12a8 8 0 1 1-2.3-5.7", "M20 4v4h-4"],
    wind: ["M3 8h10a3 3 0 1 0-3-3", "M3 12h15a3 3 0 1 1-3 3", "M3 16h8a2 2 0 1 1-2 2"],
    weight: ["M6 9h12l2 11H4z", "M9 9a3 3 0 0 1 6 0"],
    time: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
    clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
    space: ["M3 3h18v18H3z", "M8 12h8", "M12 8v8"],
    compact: ["M4 4h16v16H4z", "M9 9l-3-3", "M15 9l3-3", "M9 15l-3 3", "M15 15l3 3"],
    safety: ["M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z", "M9 12l2 2 4-4"],
    shield: ["M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"],
    wash: ["M5 11c0-3 3-4 7-4s7 1 7 4v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z", "M8 11c1 1 2 1 4 0s3-1 4 0", "M12 3v4"],
    drop: ["M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"],
    dry: ["M12 4v3", "M5 8l2 2", "M19 8l-2 2", "M4 15h16", "M7 15v5", "M17 15v5", "M12 11a3 3 0 0 0-3 3h6a3 3 0 0 0-3-3z"],
    install: ["M14 7l3 3", "M4 20l7-7", "M14 4l6 6-4 4-6-6z"],
    tool: ["M14 7l3 3", "M4 20l7-7", "M14 4l6 6-4 4-6-6z"],
    delivery: ["M3 7h11v9H3z", "M14 10h4l3 3v3h-7", "M7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z", "M17 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"],
    truck: ["M3 7h11v9H3z", "M14 10h4l3 3v3h-7", "M7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z", "M17 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"],
    box: ["M3 8l9-4 9 4v9l-9 4-9-4z", "M3 8l9 4 9-4", "M12 12v9"],
    package: ["M3 8l9-4 9 4v9l-9 4-9-4z", "M3 8l9 4 9-4", "M12 12v9"],
    check: ["M5 12l4 4 10-10"],
    cross: ["M6 6l12 12", "M18 6L6 18"],
    star: ["M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.3l1.1-6.2L3 9.7l6.2-.9z"],
    heart: ["M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"],
    ruler: ["M3 17L17 3l4 4L7 21z", "M8 12l2 2", "M11 9l2 2", "M14 6l2 2"],
    size: ["M3 17L17 3l4 4L7 21z", "M8 12l2 2", "M11 9l2 2", "M14 6l2 2"],
    sun: ["M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z", "M12 2v2", "M12 20v2", "M2 12h2", "M20 12h2", "M5 5l1.5 1.5", "M17.5 17.5L19 19", "M5 19l1.5-1.5", "M17.5 6.5L19 5"],
    moon: ["M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z"],
    leaf: ["M4 20c0-9 5-14 16-16-1 11-6 16-14 16", "M4 20l8-8"],
    home: ["M3 11l9-7 9 7", "M5 10v10h14V10", "M10 20v-6h4v6"],
    hand: ["M8 13V5a1.5 1.5 0 0 1 3 0v6", "M11 11V4a1.5 1.5 0 0 1 3 0v7", "M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-2 7-6 7s-6-2-7-5l-2-4a1.4 1.4 0 0 1 2.5-1L8 13"],
    lock: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"],
    bolt: ["M13 2L4 14h7l-1 8 9-12h-7z"],
    thermometer: ["M10 4a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z", "M12 10v6"],
    recycle: ["M7 19l-3-5 3-5", "M4 14h9", "M17 5l3 5-3 5", "M20 10h-9", "M12 19l2-3", "M12 5l2 3"],
    layers: ["M12 3l9 5-9 5-9-5z", "M3 13l9 5 9-5", "M3 17l9 5 9-5"],
    grid: ["M3 3h7v7H3z", "M14 3h7v7h-7z", "M3 14h7v7H3z", "M14 14h7v7h-7z"],
    tag: ["M3 12V3h9l9 9-9 9z", "M7.5 7.5h.01"],
    return: ["M9 14L4 9l5-5", "M4 9h11a5 5 0 0 1 0 10h-3"],
    chat: ["M4 5h16v11H9l-5 4z"],
    sparkle: ["M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z", "M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"],
    plus: ["M12 5v14", "M5 12h14"],
    minus: ["M5 12h14"],
    arrow: ["M5 12h14", "M13 6l6 6-6 6"],
    warning: ["M12 3l10 18H2z", "M12 10v4", "M12 17h.01"],
    info: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 11v5", "M12 8h.01"],
    question: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7", "M12 17h.01"],
    basket: ["M4 9h16l-1.5 11h-13z", "M8 9l4-6 4 6", "M9 13v4", "M15 13v4"],
    hanger: ["M12 6a2 2 0 1 1 2-2", "M12 6v3", "M12 9L3 16h18z"],
    stack: ["M4 7h16", "M4 12h16", "M4 17h16"],
    strong: ["M6 10v4", "M18 10v4", "M4 11v2", "M20 11v2", "M6 12h12", "M8 9h2v6H8z", "M14 9h2v6h-2z"],
    material: ["M4 4h16v16H4z", "M4 9h16", "M4 14h16", "M9 4v16", "M14 4v16"],
    inspect: ["M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M15 15l6 6", "M7 10l2 2 4-4"],
    as: ["M4 12a8 8 0 0 1 14-5l2-2v6h-6l2-2a5 5 0 0 0-9 3", "M20 12a8 8 0 0 1-14 5l-2 2v-6h6l-2 2a5 5 0 0 0 9-3"],
    money: ["M3 6h18v12H3z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M7 12h.01", "M17 12h.01"],
    family: ["M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M17 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z", "M3 20a6 6 0 0 1 12 0", "M15 20a4 4 0 0 1 6-3.5"],
    balance: ["M12 3v18", "M5 7h14", "M3 14l3-7 3 7a3 3 0 0 1-6 0z", "M15 14l3-7 3 7a3 3 0 0 1-6 0z"],
    silent: ["M4 9v6h4l5 4V5L8 9z", "M17 9l4 6", "M21 9l-4 6"],
    slide: ["M4 12h16", "M7 9l-3 3 3 3", "M17 9l3 3-3 3"],
    noassembly: ["M3 13h8v6H3z", "M13 13h8v6h-8z", "M8 7l2 2 4-5"],
    sizes: ["M4 11h7v9H4z", "M14 5h6v15h-6z"],
    steel: ["M12 3l9 5-9 5-9-5z", "M3 12l9 5 9-5", "M3 16l9 5 9-5", "M18 3l1-1", "M20 5l1.5-.5"],
    pad: ["M5 17h14", "M7 17v-3h10v3", "M9 14V6h6v8"],
    guard: ["M5 4v16", "M5 4c3 0 3 3 3 3v13", "M8 10h11v10H5"],
    eye: ["M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  };
  const ALIAS = { "접기": "fold", "펼치기": "unfold", "바람": "wind", "무게": "weight", "시간": "time", "공간": "space", "안전": "safety", "세척": "wash", "설치": "install", "배송": "delivery", "소재": "material", "검수": "inspect", "구성": "package", "교환": "as", "환불": "return", "건조": "dry", "튼튼": "strong", "가족": "family", "조용": "silent" };
  function iconSvg(name, cls) {
    const key = ALIAS[name] || String(name || "").toLowerCase().trim();
    const d = P[key];
    if (!d) return null;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true"); if (cls) svg.setAttribute("class", cls);
    for (const p of [].concat(d)) { const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", p); svg.append(path); }
    return svg;
  }
  window.SeedhackIcons = { has: (n) => !!P[ALIAS[n] || String(n || "").toLowerCase().trim()], svg: iconSvg, names: Object.keys(P) };
})();
