// 📋 소싱 리스트업 — 대표님 양식 그대로의 표. 노란 칸 입력 → 원가·수수료·마진·월 손익·ROI 즉시 계산.
// 엑셀 저장 시 계산 칸은 수식으로 들어간다(src/main/listup-excel.js와 같은 식).
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.signal;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const n = (v) => (v === "" || v == null || !Number.isFinite(+v) ? null : +v);
  const won = (v) => (v == null || !Number.isFinite(v) ? "" : Math.round(v).toLocaleString("ko-KR"));
  const IMG = "https://thumbnail6.coupangcdn.com/thumbnails/remote/230x230ex/image/";
  const imgUrl = (p) => (!p ? "" : /^https?:/.test(p) ? p : IMG + String(p).replace(/^\//, ""));
  const pct = (v) => (v == null || !Number.isFinite(v) ? "" : (v * 100).toFixed(1) + "%");
  const AD = { go: "GO · 광고해도 남음", warn: "HOLD · 광고 시 빠듯", stop: "DROP · 광고 시 적자", off: "광고 안 함" };

  let rows = [], cfg = { fx: 300, fee: 0.1188, adRate: 0.1 }, saveT = null;
  const stratBusy = new Set(); // 🧠 판매전략 AI 요청 중인 행
  let autoSt = { cur: null, q: [], left: 0, paused: false }; // 1688 자동 조사 줄 상태(main이 알려 줌)
  const picked = new Set(); // ☑ 체크한 행(id) — 선택 이동·삭제
  let undo = null, undoT = null; // ↶ 마지막 삭제 되돌리기 {items:[{row, i}]}
  let full = false; // 기본은 "간단 보기"(핵심 칸만), 전체 보기 = 대표님 양식 27열
  try { full = localStorage.getItem("luFull") === "1"; } catch {}

  // 🚚 크기·무게·카테고리 → 로켓그로스 입출고비+배송비 자동(직접 고친 값은 유지, 칸을 비우면 다시 자동)
  function applyRg(r) {
    const RG = window.RG;
    if (!RG) return;
    const e = RG.estimate({ category: r.cat || "", dims: r.dims, weight: r.wt, price: n(r.price) });
    r.rg = e;
    if (e.sumCm != null) r.size = String(e.sumCm); // 양식의 "세변의합"(cm)
    if (r.logiAuto !== false && e.total != null) r.logi = String(e.total);
  }
  // 계산 — 엑셀 수식과 같은 식
  function calc(r) {
    const yuan = n(r.yuan), price = n(r.price), logi = n(r.logi) ?? 0, monthly = n(r.monthly);
    const cost = yuan != null ? yuan * cfg.fx : null;
    const fee = price != null ? price * cfg.fee : null;
    const margin = price != null && cost != null ? price - cost - logi - fee : null;
    const rate = margin != null && price ? margin / price : null;
    const costM = cost != null && monthly != null ? cost * monthly : null;
    const revM = price != null && monthly != null ? price * monthly : null;
    const marginM = margin != null && monthly != null ? margin * monthly : null;
    const adM = revM != null ? revM * cfg.adRate : null;
    const net = marginM != null ? marginM - (adM ?? 0) : null;
    const roi = net != null && costM ? net / costM : null;
    // 1688에서 이 가격 이하로 사 와야 목표 마진이 남는다(판매가만 있으면 계산)
    const allow = price != null ? (price * (1 - cfg.fee - target()) - logi) / cfg.fx : null;
    // 광고 판정을 "내 실제 마진율"로 다시 계산: 최대 ROAS(판매가×벤치마킹 전환율÷클릭비용) vs 본전 ROAS(1÷마진율)
    // 광고 판정: 광고로 1개 팔 때 드는 광고비(전환당 비용) vs 실제 1개 마진(위안을 넣었으면 실제, 아니면 판매가×목표 마진)
    const cvr = n(r.bCvr), AM = window.AdModel;
    const cpa = AM.cpa(cvr);
    const unitM = margin != null ? margin : price != null ? price * target() : null;
    let ad = r.ad || null, maxRoas = r.maxRoas ?? null;
    if (cvr != null && price) maxRoas = (price * cvr * AM.conv) / AM.cpc;
    if (cfg.adRate <= 0) ad = cvr != null ? "off" : null; // 광고 안 함
    else if (cpa != null && unitM != null) ad = AM.judge(cpa, unitM);
    // 경쟁사(벤치마킹 상품)가 한 달에 남기는 돈(추정) — 같은 원가·물류비·수수료·광고비 10%로, 경쟁사 판매가 × 경쟁사 월판매량
    const bp = n(r.benchPrice) ?? price, bm = n(r.benchMonthly);
    const bUnit = bp != null && cost != null ? bp - cost - logi - bp * cfg.fee : null;
    const bNet = bUnit != null && bm != null ? bUnit * bm - bp * bm * cfg.adRate : null;
    const bRoi = bNet != null && cost ? bNet / (cost * bm) : null;
    return { cost, fee, margin, rate, costM, revM, marginM, adM, net, roi, allow, ad, maxRoas, cpa, unitM, bp, bm, bUnit, bNet, bRoi };
  }
  function verdict(r, c) {
    if (n(r.price) == null) return ["", "판매가를 넣으세요"];
    if (c.rate == null) return ["", c.allow > 0 ? `¥${c.allow.toFixed(1)} 이하로 사 오면 OK` : "이 판매가로는 남지 않아요"];
    if (c.margin < 0) return ["bad", `🔴 1개 팔 때마다 ${won(-c.margin)}원 손해`];
    const t = target();
    // 광고를 하면: 1개 마진에서 광고비(전환당 비용)를 빼고 남는지까지 본다
    if (cfg.adRate > 0 && c.cpa != null) {
      const left = c.margin - c.cpa;
      if (left < 0) return ["bad", `🔴 1개 ${won(c.margin)}원 남지만 광고비 ${won(c.cpa)}원 → 광고하면 ${won(-left)}원 손해`];
      if (c.ad === "warn") return ["mid", `🟡 1개 ${won(c.margin)}원 · 광고비 빼면 ${won(left)}원`];
      return ["good", `🟢 1개 ${won(c.margin)}원 · 광고비 빼도 ${won(left)}원`];
    }
    if (c.rate >= t) return ["good", `🟢 1개 ${won(c.margin)}원 남음 (${pct(c.rate)})`];
    if (c.rate >= 0.2) return ["mid", `🟡 1개 ${won(c.margin)}원 · ${cfg.adRate > 0 ? "광고하면 빠듯" : "기준 20%는 넘음"}`];
    return ["bad", `🔴 1개 ${won(c.margin)}원 · 마진 ${pct(c.rate)} (20% 미만)`];
  }

  const target = () => (cfg.adRate > 0 ? 0.3 : 0.2); // 광고를 쓰면 마진 30%, 안 쓰면 20%

  // 열 정의: [필드, 머리글, 종류(in=입력 · txt=긴 입력 · num=숫자 입력 · c=계산 · ro=읽기 · link · sub=서브키워드 선택), 너비]
  const ad = () => `광고비 ${Math.round(cfg.adRate * 100)}%`;
  const TEMPLATE = [
    ["img", "사진", "img", 58],
    ["keyword", "대표키워드", "in", 110], ["kwVol", "월검색량", "num", 80], ["subKw", "서브키워드", "sub", 180], ["subVol", "월검색량", "num", 80],
    ["reason", "소싱이유", "txt", 200], ["strategy", "판매전략", "txt", 200],
    ["maxPrice", "1페이지최고가", "num", 96], ["minPrice", "1페이지최저가", "num", 96], ["myPrice", "내판매가", "num", 88],
    ["name", "상품명", "txt", 220], ["benchUrl", "벤치마킹URL", "link", 96], ["cnUrl", "중국URL", "url", 150],
    ["yuan", "위안", "num", 70], ["cost", "원가", "c", 80], ["size", "세변의합", "num", 74], ["logi", "입출고비/배송비", "num", 100],
    ["price", "판매가", "num", 88], ["fee", "쿠팡수수료", "c", 86], ["margin", "마진", "c", 86], ["rate", "마진율", "c", 72],
    ["monthly", "월판매량", "num", 80], ["costM", "원가", "c", 100], ["revM", "매출", "c", 110], ["marginM", "마진", "c", 100],
    ["adM", ad, "c", 96], ["net", "순이익", "c", 104], ["roi", "투자대비수익율(ROI)", "c", 110],
    ["bSales", "28일 판매", "ro", 80], ["bViews", "28일 조회", "ro", 80], ["bCvr", "전환율", "ro", 66], ["ad", "광고 판정", "c", 120], ["cpa", "1개당 광고비", "c", 92],
  ];
  const TEMPLATE_GROUPS = [["", 1], ["키워드", 4], ["기획", 2], ["1페이지 가격", 3], ["상품", 3], ["개당 원가·마진", 8], ["월 손익 (가정)", 7], ["벤치마킹 상품 실지표 (프로그램)", 5]];
  const byF = Object.fromEntries(TEMPLATE.map((c) => [c[0], c]));
  // 간단 보기: 위안을 넣고 바로 결론이 보이도록 핵심 칸만, 결론 칸을 앞쪽에
  const SIMPLE = [
    ["img", "사진", "img", 58],
    ["name", "상품명", "txt", 180],
    ["cnUrl", "1688 찾기 · 중국URL", "url", 150], ["yuan", "위안", "num", 66], ["price", "판매가", "num", 84],
    ["cat", "카테고리", "cat", 112], ["dims", "크기 mm (가로×세로×높이)", "in", 150], ["wt", "무게 g", "num", 70], ["rgSize", "사이즈", "c", 84],
    ["vd", "한 줄 판정", "c", 220], ["allow", "최대 위안", "c", 78], ["bNet", "경쟁사 월 순이익", "c", 112], ["strat", "🧠 판매전략", "strat", 190],
    byF.rate, byF.margin, byF.cost, byF.fee, ["logi", "입출고비+배송비", "num", 104],
    ["monthly", "내 예상 월판매", "num", 92], byF.net, byF.roi,
    ["ad", "광고 판정 (가정)", "c", 120],
    ["keyword", "대표키워드", "in", 96], byF.benchUrl,
  ];
  const SIMPLE_GROUPS = [["상품", 2], ["입력 — 🔍1688로 위안 찾기", 3], ["🚚 물류 — 크기를 넣으면 입출고비 자동", 4], ["결론", 4], ["개당 원가·마진", 6], ["월 손익 (가정)", 3], ["광고", 1], ["참고", 2]];
  const EXT = new Set(["bSales", "bViews", "bCvr", "ad", "cpa"]);
  let COLS = full ? TEMPLATE : SIMPLE, GROUPS = full ? TEMPLATE_GROUPS : SIMPLE_GROUPS;
  const PCT = new Set(["rate", "roi"]);
  const TIPS = {
    yuan: "1688 가격(위안). 원가 = 위안 × 원가 계수", allow: "목표 마진(광고 할 때 30% / 안 할 때 20%)이 남는 최대 1688 가격",
    cost: "위안 × 원가 계수(기본 300 — 운송·관세 포함 암산값)", size: "가로+세로+높이(cm) — 물류비 판단 참고",
    logi: "로켓그로스 입출고비+배송비 (기본 2,200원, 상품 크기에 따라 직접 수정)", fee: "판매가 × 쿠팡 수수료율",
    rate: "마진 ÷ 판매가", monthly: "내가 한 달에 팔 것으로 예상하는 개수 (벤치마킹 1등 판매량은 참고만)",
    bNet: "경쟁사(벤치마킹 상품)가 한 달에 남기는 돈 추정 = (경쟁사 판매가 − 원가 − 물류비 − 수수료) × 경쟁사 월판매량 − 광고비. 같은 원가로 본 참고값",
    net: "월 마진 − 광고비 (가정)", roi: "월 순이익 ÷ 월 원가 (넣은 돈 대비 남는 돈)",
    ad: "내 마진율과 벤치마킹 전환율·클릭비용 가정으로 계산한 광고 여지 — 실제 광고 성과와 다를 수 있습니다",
    cpa: "광고로 1개 팔 때 드는 광고비 = 클릭비용 ÷ (전환율 × 광고 전환 비율)", vd: "개당 남는 돈 기준 한 줄 결론",
  };

  function head() {
    $("luHead").innerHTML =
      `<tr class="grp"><th class="no mg" rowspan="2"><label class="pk" data-tip="☑ 전체 선택 / 해제"><input type="checkbox" id="luAll" aria-label="전체 선택" ${rows.length && rows.every((r) => picked.has(r.id)) ? "checked" : ""}></label>No.</th>${GROUPS.map(([g, span], i) => `<th colspan="${span}" class="${i === GROUPS.length - 1 ? "ext" : ""}">${g}</th>`).join("")}<th rowspan="2" class="del"></th></tr>` +
      `<tr>${COLS.map(([f, h, k, w]) => `<th style="min-width:${w}px;width:${w}px" class="${k === "c" ? "calc" : ""} ${EXT.has(f) ? "ext" : ""}" title="${esc(TIPS[f] || "")}">${typeof h === "function" ? h() : h}</th>`).join("")}</tr>`;
  }

  function cellHtml(r, ri, [f, , k], c) {
    const v = r[f];
    if (k === "c" && f === "rgSize") {
      const e = r.rg || {};
      const t = e.sizeClass ? e.sizeClass : e.error === "크기 없음" || !e.error ? "" : e.error;
      const tip = e.total != null
        ? `${e.sizeClass} · 세 변의 합 ${e.sumCm}cm · ${e.rateLabel} 적용 — 입출고비 ${won(e.inout)} + 배송비 ${won(e.ship)} = ${won(e.total)} (VAT 별도·단품 1개)${e.noWeight ? " · 무게 미입력: 세 변의 합만으로 판정" : ""}${e.estimated ? " · 이 카테고리 요금표가 아직 없어 스킨케어 요금표로 추정" : ""}`
        : e.error === "요금표 준비 전" ? "로켓그로스 요금표가 아직 비어 있습니다 — 입출고비는 직접 입력" : esc(e.error || "");
      const mark = e.total != null && (e.estimated || e.noWeight) ? " *" : "";
      return `<td class="calc rgs ${e.total != null ? (e.estimated ? "mid" : "good") : e.error && e.error !== "크기 없음" ? "bad" : ""}" data-c="rgSize" title="${esc(tip)}">${esc(t)}${mark}</td>`;
    }
    if (k === "strat") {
      const st = r.aiStrat, busy = stratBusy.has(r.id);
      return `<td class="strat">${busy ? `<span class="sbusy">AI가 전략 짜는 중…</span>` : st ? `<button type="button" class="sview ${st.go ? "go" : "no"}" data-sv="${ri}" title="${esc(st.summary)}">${st.go ? "진입" : "보류"} · ${esc(st.summary.slice(0, 26))}…</button>` : ""}<button type="button" class="sbtn" data-st="${ri}" ${busy ? "disabled" : ""} title="${n(r.yuan) == null ? "위안(1688 원가)을 먼저 넣으면 더 정확합니다" : "이 행의 숫자로 AI가 판매전략을 짭니다 (1분 안팎)"}">${st ? "↻" : "🧠 전략 짜기"}</button></td>`;
    }
    if (k === "c" && f === "vd") { const [cls, t] = verdict(r, c); return `<td class="calc vd ${cls}" data-c="vd">${t}</td>`; }
    if (k === "c" && f === "ad") return `<td class="calc adj ${c.ad || ""}" data-c="ad" title="${c.ad && c.ad !== "off" ? `1개당 광고비 약 ${won(c.cpa)}원 · 1개 마진 ${won(c.unitM)}원${c.margin == null ? "(판매가×목표 마진 가정)" : ""} · ${window.AdModel.note()}` : ""}">${c.ad ? AD[c.ad] : ""}</td>`;
    if (k === "c" && f === "cpa") return `<td class="calc num ${c.cpa != null && c.unitM != null && c.cpa > c.unitM ? "bad" : ""}" data-c="cpa">${won(c.cpa)}</td>`;
    if (k === "c" && f === "bNet") return `<td class="calc num ${c.bNet != null && c.bNet < 0 ? "bad" : c.bRoi >= 1 ? "good" : ""}" data-c="bNet" title="${c.bNet == null ? "위안을 넣으면(🔍1688 자동 조사) 경쟁사가 한 달에 남기는 돈을 추정합니다" : esc(`경쟁사 판매가 ${won(c.bp)}원 × 월 ${won(c.bm)}개 · 개당 ${won(c.bUnit)}원 남김 − 광고비 ${Math.round(cfg.adRate * 100)}% · ROI ${pct(c.bRoi)}\n같은 원가·물류비로 계산한 추정치 — 참고용`)}">${c.bNet == null ? "" : won(c.bNet)}</td>`;
    if (k === "c" && f === "allow") return `<td class="calc num ${c.allow != null && c.allow <= 0 ? "bad" : ""}" data-c="allow">${c.allow == null ? "" : c.allow <= 0 ? "불가" : "¥" + c.allow.toFixed(1)}</td>`;
    if (k === "c") {
      const x = c[f];
      let cls = "calc num";
      if (f === "rate" && x != null) cls += x >= target() ? " good" : x >= 0.2 ? " mid" : " bad";
      if ((f === "margin" || f === "net") && x != null && x < 0) cls += " bad";
      if (f === "roi" && x != null) cls += x >= 1 ? " good" : x < 0 ? " bad" : "";
      return `<td class="${cls}" data-c="${f}">${PCT.has(f) ? pct(x) : won(x)}</td>`;
    }
    if (k === "ro") {
      const t = f === "bCvr" ? pct(n(v)) : f === "ad" ? (AD[v] || "") : won(n(v));
      return `<td class="ro ${f === "ad" ? `adj ${v || ""}` : "num"}">${t}</td>`;
    }
    if (k === "img") return `<td class="thumb">${v ? `<img loading="lazy" src="${esc(imgUrl(v))}" alt="">` : ""}</td>`;
    if (k === "link") return `<td class="ro">${v ? `<a href="${esc(v)}" target="_blank" title="${esc(v)}">쿠팡 ↗</a>` : ""}</td>`;
    if (k === "cat") {
      const cats = window.RG?.config?.categories || [];
      return `<td class="in"><select data-r="${ri}" data-f="${f}"><option value="">선택…</option>${cats.map((c) => `<option ${c === v ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></td>`;
    }
    if (k === "sub") {
      const opts = (r.subs || []).map((s) => `<option value="${esc(s.kw)}" ${s.kw === v ? "selected" : ""}>${esc(s.kw)} (${won(s.m1)})${s.brand ? " · 브랜드" : ""}</option>`).join("");
      return `<td class="in"><select data-r="${ri}" data-f="${f}"><option value="">${opts ? "선택…" : "-"}</option>${opts}${v && !(r.subs || []).some((s) => s.kw === v) ? `<option selected>${esc(v)}</option>` : ""}</select></td>`;
    }
    const isNum = k === "num";
    // 🎯 1688 자동 조사 표시: 조사 중/대기 · 끝나면 확인됨(초록)/추정(노랑)
    const at = f !== "yuan" ? "" : autoSt.cur?.rowId === r.id ? `<span class="atag run" title="1688 자동 조사 중">조사 중</span>`
      : autoSt.q.includes(r.id) ? `<span class="atag run" title="1688 자동 조사 대기">대기</span>`
      : r.cnAuto ? `<span class="atag ${r.cnAuto.sure && !r.cnAuto.warn ? "" : "est"}" title="${esc(["1688 자동 조사", r.cnAuto.how, r.cnAuto.option ? "옵션: " + r.cnAuto.option : "", r.cnAuto.warn ? "⚠ " + r.cnAuto.warn : "", r.cnAuto.sure ? "" : "추정값 — 🔍1688로 옵션을 확인하세요"].filter(Boolean).join("\n"))}">${r.cnAuto.sure ? "자동" : "추정"}${r.cnAuto.warn ? "⚠" : ""}</span>` : "";
    const extra = k === "url" ? `${v ? `<a class="go" href="${esc(v)}" target="_blank" title="열기">↗</a>` : ""}<button type="button" class="cnbtn" data-cn="${ri}" title="이 상품 사진으로 1688 이미지 검색 → 상품 페이지에서 '리스트업에 넣기'를 누르면 위안·중국URL이 채워집니다">🔍1688</button>` : "";
    const ph = k === "url" ? "1688 주소" : f === "monthly" && r.benchMonthly ? `1등 ${won(r.benchMonthly)}` : f === "yuan" ? "¥" : f === "dims" ? "200x150x80" : f === "wt" ? "g" : "";
    const autoCls = f === "logi" && r.logiAuto !== false && r.rg?.total != null ? "auto" : "";
    return `<td class="in ${isNum ? "num" : ""} ${k === "txt" ? "long" : ""}"><input class="${autoCls}" data-r="${ri}" data-f="${f}" ${isNum ? 'inputmode="decimal"' : ""} value="${esc(isNum && v != null && v !== "" ? (+v).toLocaleString("ko-KR") : v ?? "")}" placeholder="${ph}" title="${esc(f === "monthly" && r.benchMonthly ? `벤치마킹 1등 상품 월 판매 약 ${won(r.benchMonthly)}개 — 신규 진입은 보통 이보다 훨씬 적습니다` : v ?? "")}">${extra}${at}</td>`;
  }
  function rowHtml(r, ri) {
    const c = calc(r);
    const on = picked.has(r.id);
    return `<tr data-r="${ri}" class="${on ? "sel" : ""}"><td class="no mg"><label class="pk"><input type="checkbox" data-pick="${ri}" aria-label="${ri + 1}번 선택" ${on ? "checked" : ""}></label><span class="grip" draggable="true" data-grip="${ri}" data-tip="⠿ 끌어서 순서 바꾸기" aria-label="끌어서 순서 바꾸기">⠿</span><b>${ri + 1}</b></td>${COLS.map((col) => cellHtml(r, ri, col, c)).join("")}<td class="del"><button type="button" data-del="${ri}" data-tip="✕ 이 상품 빼기 (되돌리기 가능)" aria-label="이 상품 빼기">✕</button></td></tr>`;
  }
  function totals() {
    const sum = (f) => rows.reduce((a, r) => a + (calc(r)[f] ?? 0), 0);
    const net = sum("net"), costM = sum("costM");
    const withM = rows.filter((r) => n(r.monthly) != null).length;
    $("luInfo").textContent = !rows.length ? "" : !withM
      ? `${rows.length}개 상품 · 내 예상 월판매를 넣으면 월 손익(가정)이 나옵니다`
      : `${rows.length}개 중 ${withM}개 기준 (가정) · 월 매출 ${won(sum("revM"))}원 · 월 순이익 ${won(net)}원 · 월 원가 ${won(costM)}원${costM ? ` · 원가 100만원당 ${won((net / costM) * 1e6)}원 남음` : ""}`;
  }
  function render() {
    rows.forEach((r) => { if (r.id == null) r.id = Date.now() + Math.random(); });
    rows.forEach(applyRg);
    head();
    $("luBody").innerHTML = rows.map(rowHtml).join("");
    $("luEmpty").hidden = rows.length > 0;
    $("luTable").hidden = rows.length === 0;
    $("lcount").textContent = rows.length;
    $("luView").textContent = full ? "간단 보기" : "전체 27열 보기";
    $("cFx").value = cfg.fx; $("cFee").value = String(cfg.fee); $("cAd").value = Math.round(cfg.adRate * 100);
    totals();
    selBar();
  }
  // ☑ 선택 막대 — 체크한 행이 있을 때만: 맨 위로 · 위로 · 아래로 · 맨 아래로 · 빼기 / ↶ 되돌리기는 삭제 직후 10초
  function selBar() {
    [...picked].forEach((id) => { if (!rows.some((r) => r.id === id)) picked.delete(id); });
    const k = picked.size, bar = $("luSel");
    bar.hidden = !k && !undo;
    $("luSelN").textContent = k ? `${k}개 선택` : "";
    bar.querySelectorAll("[data-mv],[data-act='del'],[data-act='none']").forEach((b) => { b.hidden = !k; });
    const u = $("luUndo");
    u.hidden = !undo;
    if (undo) u.textContent = `↶ 되돌리기 (${undo.items.length}개 뺌)`;
  }
  // 순서 이동: ids 묶음을 to 위치(남은 행 기준 인덱스) 앞에 끼워 넣는다
  function moveTo(ids, to) {
    const set = new Set(ids), moving = rows.filter((r) => set.has(r.id)), rest = rows.filter((r) => !set.has(r.id));
    to = Math.max(0, Math.min(rest.length, to));
    rows = [...rest.slice(0, to), ...moving, ...rest.slice(to)];
    render(); save();
    window.PanelHooks?.onListupChange();
    moving.forEach((r) => $("luBody").querySelector(`tr[data-r="${rows.indexOf(r)}"]`)?.classList.add("moved"));
  }
  function step(ids, d) { // 한 칸씩: 묶음의 맨 앞(위로)/맨 뒤(아래로) 기준
    const idx = rows.map((r, i) => (ids.includes(r.id) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return;
    const first = idx[0], last = idx[idx.length - 1], cnt = idx.length;
    moveTo(ids, d < 0 ? first - 1 : last - cnt + 2);
  }
  function remove(ids) {
    const set = new Set(ids);
    const items = rows.map((row, i) => ({ row, i })).filter((x) => set.has(x.row.id));
    if (!items.length) return;
    rows = rows.filter((r) => !set.has(r.id));
    ids.forEach((id) => picked.delete(id));
    undo = { items };
    clearTimeout(undoT); undoT = setTimeout(() => { undo = null; selBar(); }, 10000);
    render(); save();
    window.PanelHooks?.onListupChange();
    window.PanelHooks?.log("sys", `■ 리스트업에서 ${items.length}개 뺌 · ↶ 되돌리기 10초`);
  }
  function refreshCalc(ri) {
    const tr = $("luBody").querySelector(`tr[data-r="${ri}"]`);
    if (!tr) return;
    const c = calc(rows[ri]);
    COLS.forEach((col) => {
      if (col[2] !== "c") return;
      const td = tr.querySelector(`td[data-c="${col[0]}"]`);
      const tmp = document.createElement("tbody");
      tmp.innerHTML = `<tr>${cellHtml(rows[ri], ri, col, c)}</tr>`;
      const nt = tmp.querySelector("td");
      td.className = nt.className; td.textContent = nt.textContent; td.title = nt.title; // 설명(경쟁사 순이익 근거 등)도 같이 갱신
    });
    totals();
  }
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => api.invoke("listup:save", rows), 400); };

  // 입력
  $("luBody").addEventListener("input", (e) => {
    const el = e.target.closest("[data-f]");
    if (!el) return;
    const ri = +el.dataset.r, f = el.dataset.f, r = rows[ri];
    const col = COLS.find((c) => c[0] === f);
    const val = col[2] === "num" ? (el.value.replace(/[,\s원¥]/g, "") === "" ? "" : el.value.replace(/[,\s원¥]/g, "")) : el.value;
    if (f === "myPrice" && (r.price === "" || r.price == null || String(r.price) === String(r.myPrice))) {
      r.price = val; // 내판매가를 바꾸면 판매가도 따라간다(판매가를 따로 고쳤으면 그대로 둠)
      const p = $("luBody").querySelector(`input[data-r="${ri}"][data-f="price"]`);
      if (p) p.value = val === "" ? "" : (+val).toLocaleString("ko-KR");
    }
    if (f === "strategy") r.strategyAuto = false; // 직접 쓴 판매전략은 AI가 덮지 않는다
    if (f === "price" && (r.myPrice === "" || r.myPrice == null || String(r.myPrice) === String(r.price))) r.myPrice = val; // 양식의 "내판매가"도 같이
    if (f === "logi") r.logiAuto = val === "" ? true : false;
    if (f === "subKw") {
      r.subVol = (r.subs || []).find((s) => s.kw === val)?.m1 ?? r.subVol;
      const sv = $("luBody").querySelector(`input[data-r="${ri}"][data-f="subVol"]`);
      if (sv) sv.value = r.subVol != null && r.subVol !== "" ? (+r.subVol).toLocaleString("ko-KR") : "";
    }
    r[f] = val;
    if (["cat", "dims", "wt", "price", "logi"].includes(f)) {
      applyRg(r);
      if (f !== "logi") { // 자동으로 바뀐 칸(입출고비·사이즈) 화면 반영
        const li = $("luBody").querySelector(`input[data-r="${ri}"][data-f="logi"]`);
        if (li && document.activeElement !== li) li.value = r.logi === "" || r.logi == null ? "" : (+r.logi).toLocaleString("ko-KR");
        li?.classList.toggle("auto", r.logiAuto !== false && r.rg?.total != null);
      }
    }
    refreshCalc(ri);
    save();
  });
  // 엑셀에서 여러 칸을 복사해 붙여넣으면 아래 행으로 차례로 채운다(같은 열)
  $("luBody").addEventListener("paste", (e) => {
    const el = e.target.closest("input[data-f]");
    const text = e.clipboardData?.getData("text") || "";
    if (!el || !/\n/.test(text.trim())) return;
    e.preventDefault();
    const vals = text.replace(/\r/g, "").split("\n").filter((v, i, a) => v !== "" || i < a.length - 1).map((v) => v.split("\t")[0].trim());
    const f = el.dataset.f, start = +el.dataset.r;
    const isNum = COLS.find((c) => c[0] === f)?.[2] === "num";
    vals.forEach((v, i) => { const r = rows[start + i]; if (r) r[f] = isNum ? v.replace(/[,\s원¥]/g, "") : v; });
    render(); save();
    window.PanelHooks?.log("go", `■ 리스트업 붙여넣기 · ${Math.min(vals.length, rows.length - start)}칸`);
  });
  // 숫자 칸은 포커스가 빠질 때 천단위 콤마
  $("luBody").addEventListener("focusout", (e) => {
    const el = e.target;
    if (el.tagName !== "INPUT" || !el.closest("td.num")) return;
    const v = rows[+el.dataset.r]?.[el.dataset.f];
    el.value = v === "" || v == null || !Number.isFinite(+v) ? (v ?? "") : (+v).toLocaleString("ko-KR");
  });
  // Enter = 아래 칸, Shift+Enter = 위 칸 (엑셀과 같게). Tab은 브라우저 기본(옆 칸).
  $("luBody").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    const el = e.target.closest("[data-f]");
    if (!el) return;
    e.preventDefault();
    const next = $("luBody").querySelector(`[data-r="${+el.dataset.r + (e.shiftKey ? -1 : 1)}"][data-f="${el.dataset.f}"]`);
    if (next) { next.focus(); next.select?.(); }
  });
  // 🔍1688: 이 행의 상품 사진으로 1688 이미지 검색
  $("luBody").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-cn]");
    if (!b) return;
    const r = rows[+b.dataset.cn];
    if (!r.id) r.id = Date.now() + Math.random();
    api.invoke("cn:search", { rowId: r.id, name: r.name || r.keyword || "", keyword: r.keyword || "", img: r.img || "", allow: calc(r).allow, price: r.price }); // 허용 소싱가 → 1688 추천 점수의 가격 기준
  });
  // 쿠팡 화면 사진 위 🔍1688 → 리스트업에 담고(이미 있으면 그 행) 바로 1688 이미지 검색
  api.on("listup:add1688", async (p) => {
    let r = rows.find((x) => String(x.pid) === String(p.pid));
    if (!r) {
      const cvr = p.sales != null && p.views ? p.sales / p.views : null;
      const q = String(p.query || "");
      const db = q && !q.startsWith("📂") ? await api.invoke("kw:db", q).catch(() => null) : null;
      const sub = (db?.subs || []).find((s) => !s.brand);
      window.Listup.add({
        keyword: q, kwVol: db?.main?.m1 ?? null, subKw: sub?.kw || "", subVol: sub?.m1 ?? null,
        subs: (db?.subs || []).slice(0, 15).map((s) => ({ kw: s.kw, m1: s.m1, brand: s.brand })),
        name: p.name, pid: p.pid, img: p.img, benchUrl: `https://www.coupang.com/vp/products/${p.pid}${p.vid ? `?vendorItemId=${p.vid}` : ""}`,
        bSales: p.sales, bViews: p.views, bCvr: cvr, monthly: "", benchMonthly: p.sales != null ? Math.round((p.sales * 30) / 28) : null, benchPrice: p.price,
      });
      r = rows[rows.length - 1];
      window.PanelHooks?.log("go", `☆ 리스트업에 담음 · ${esc(String(p.name).slice(0, 26))} → 1688 이미지 검색`);
      window.PanelHooks?.onListupChange();
    }
    api.invoke("cn:search", { rowId: r.id, name: r.name || "", keyword: r.keyword || "", img: r.img || p.img || "", allow: calc(r).allow, price: r.price });
  });
  // 🎯 1688 자동 조사 줄 상태 · 끝 알림
  api.on("auto:state", (st) => {
    autoSt = { cur: st.cur, q: st.queue || [], left: st.left, paused: st.paused };
    const el = $("luAuto");
    const on = !!(st.cur || st.left);
    el.hidden = !on;
    if (on) {
      el.innerHTML = st.paused ? `⏸ 1688 자동 조사 일시정지 · 남은 ${st.left}개 <button type="button" data-a="resume">▶ 다시 시작</button><button type="button" data-a="stop">■ 비우기</button>`
        : `🔎 1688 자동 조사 중${st.cur ? ` · ${esc(String(st.cur.name).slice(0, 18))}` : " · 잠깐 쉬는 중"}${st.left ? ` · 대기 ${st.left}개` : ""} <button type="button" data-a="stop">■ 멈춤</button>`;
    }
    render();
  });
  // 🧠 판매전략 AI — 이 행의 사실(쿠팡·Wing 실측, 1688 원가)과 계산값만 보낸다. 가격 제안의 남는 돈은 앱이 다시 계산해서 보여 준다
  const unitAt = (r, p, extra = 0) => { const c = calc(r); if (c.cost == null || !(p > 0)) return null; return p - c.cost - (n(r.logi) ?? 0) - p * cfg.fee - p * cfg.adRate - extra; };
  function stratInput(r) {
    const c = calc(r);
    return { name: r.name || "", keyword: r.keyword || "", kwVol: r.kwVol ?? null, benchPrice: n(r.benchPrice), bSales: n(r.bSales), bViews: n(r.bViews), bCvr: n(r.bCvr),
      bReviews: n(r.bReviews), bRating: n(r.bRating), bShip: r.bShip || "", band: r.band || null, minPrice: n(r.minPrice), maxPrice: n(r.maxPrice),
      yuan: n(r.yuan), cnAuto: r.cnAuto || null, fx: cfg.fx, cost: c.cost, logi: n(r.logi) ?? 0, dims: r.dims || "", fee: cfg.fee, adRate: cfg.adRate,
      bUnitAd: unitAt(r, n(r.benchPrice)), bNet: c.bNet, bRoi: c.bRoi, recPrice: n(r.recPrice) ?? n(r.price), recUnit: unitAt(r, n(r.recPrice) ?? n(r.price)), reason: r.reason || "" };
  }
  async function runStrat(r) {
    if (stratBusy.has(r.id)) return;
    stratBusy.add(r.id); render();
    const res = await api.invoke("ai:strategy", stratInput(r)).catch((e) => ({ error: e?.message || String(e) }));
    stratBusy.delete(r.id);
    if (res?.ok) {
      const st = res.result;
      r.aiStrat = { ...st, ts: Date.now(), model: res.model };
      // 엑셀 "판매전략" 칸에 들어갈 글(직접 쓴 내용이 있으면 덮지 않음)
      if (!r.strategy || r.strategyAuto) { r.strategy = [st.summary, ...st.tactics.map((t) => `[${t.kind}] ${t.action}`), `초도 ${st.first_order_qty}개`].join(" / "); r.strategyAuto = true; }
      save(); render(); showStrat(r);
    } else { render(); window.PanelHooks?.log("stop", `✕ 판매전략 AI 실패 · ${esc(res?.error || "")}`); alert(`판매전략 AI 실패: ${res?.error || ""}`); }
  }
  function showStrat(r) {
    const st = r.aiStrat; if (!st) return;
    let m = $("stratModal");
    if (!m) { m = document.createElement("div"); m.id = "stratModal"; document.body.appendChild(m); m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-x]")) m.hidden = true; }); }
    const c = calc(r), inv = c.cost != null ? st.first_order_qty * c.cost : null;
    const sp = st.tactics.find((t) => t.price_won)?.price_won || n(r.price); // 가격 제안이 있으면 사은품 등 비용도 그 가격 기준으로
    const lis = st.tactics.map((t) => {
      const u = t.price_won ? unitAt(r, t.price_won, t.cost_won || 0) : t.cost_won ? unitAt(r, sp, t.cost_won) : null;
      const calcTxt = u == null ? "" : `<em class="${u > 0 ? "ok" : "bad"}">앱 계산: ${t.price_won ? `${won(t.price_won)}원에 팔면` : `${won(sp)}원에 팔고 비용 ${won(t.cost_won)}원 빼면`} 개당 ${won(u)}원</em>`;
      return `<li><b>${esc(t.kind)}</b><div><p>${esc(t.action)}</p><small>근거: ${esc(t.why)}</small><small>효과: ${esc(t.effect)}</small>${calcTxt}</div></li>`;
    }).join("");
    m.innerHTML = `<div class="sm-box"><div class="sm-hd"><b>🧠 판매전략</b><span>${esc(String(r.name || "").slice(0, 40))}</span><button type="button" data-x>✕</button></div>
      <p class="sm-sum ${st.go ? "go" : "no"}"><b>${st.go ? "진입해 볼 만함" : "보류 권장"}</b> ${esc(st.summary)}</p>
      <ol class="sm-tac">${lis}</ol>
      <p class="sm-qty">초도 <b>${st.first_order_qty}개</b>${inv != null ? ` · 원가 투자 약 ${won(inv)}원 (1688 원가만, 물류 별도)` : ""}</p>
      ${st.check_first?.length ? `<div class="sm-list"><b>먼저 확인할 것</b><ul>${st.check_first.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      ${st.risks?.length ? `<div class="sm-list risk"><b>위험</b><ul>${st.risks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      <p class="sm-foot">AI 제안은 앱이 모은 숫자만 근거로 합니다 · 금액은 앱이 다시 계산 · ${esc(st.model || "")} · ${new Date(st.ts).toLocaleString("ko-KR")}</p></div>`;
    m.hidden = false;
  }
  $("luBody").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-st]"), v = e.target.closest("button[data-sv]");
    if (b) runStrat(rows[+b.dataset.st]);
    else if (v) showStrat(rows[+v.dataset.sv]);
  });
  $("luAuto").addEventListener("click", (e) => { const b = e.target.closest("button[data-a]"); if (b) api.invoke("cn:queueAct", b.dataset.a); });
  api.on("auto:done", (d) => {
    if (!d.ok) return;
    const body = `${String(d.name).slice(0, 30)} → ¥${d.yuan}${d.sure ? "" : " (추정)"}${d.allow ? ` · 허용 ¥${(+d.allow).toFixed(1)} ${d.verdict === "ok" ? "이하 ✔" : "초과 ✕"}` : ""}${d.warn ? ` · ⚠ ${d.warn}` : ""}`;
    try { new Notification("1688 원가 찾음", { body, silent: false }); } catch {}
  });
  // 1688 상품 페이지에서 "리스트업에 넣기" → 그 행에 위안·중국URL 채우기
  api.on("listup:fill", ({ rowId, cnUrl, yuan, specs, auto }) => {
    const r = rows.find((x) => x.id === rowId);
    if (!r) return;
    if (auto && r.yuan !== "" && r.yuan != null && !r.cnAuto) return; // 직접 넣은 위안은 자동 조사가 덮지 않는다
    r.cnUrl = cnUrl;
    if (yuan != null) r.yuan = String(yuan);
    r.cnAuto = auto || null; // 사람이 1688 상품 페이지에서 넣으면 자동 표시를 지운다
    setTimeout(() => window.PanelHooks?.onListupChange(), 0); // 검색 카드의 "경쟁사 월 순이익"도 같이 갱신
    // 1688 상세에서 읽은 크기(mm)·무게(g): 비어 있을 때만 채운다(직접 넣은 값은 유지) → 입출고비 자동 계산
    if (specs) { if (specs.dims && !r.dims) r.dims = specs.dims; if (specs.wt && !r.wt) r.wt = specs.wt; if (specs.cartonQty && !r.cartonQty) r.cartonQty = specs.cartonQty; }
    render(); save();
    const i = rows.indexOf(r);
    const tr = $("luBody").querySelector(`tr[data-r="${i}"]`);
    if (tr) { tr.classList.add("filled"); tr.scrollIntoView({ block: "nearest" }); setTimeout(() => tr.classList.remove("filled"), 2500); }
  });
  // ✕ 빼기 — 바로 빠지고 10초 동안 ↶ 되돌리기
  $("luBody").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-del]");
    if (b) remove([rows[+b.dataset.del].id]);
  });
  // ☑ 선택
  $("luBody").addEventListener("change", (e) => {
    const c = e.target.closest("input[data-pick]");
    if (!c) return;
    const r = rows[+c.dataset.pick];
    if (c.checked) picked.add(r.id); else picked.delete(r.id);
    c.closest("tr").classList.toggle("sel", c.checked);
    const all = $("luAll"); if (all) all.checked = rows.every((x) => picked.has(x.id));
    selBar();
  });
  $("luHead").addEventListener("change", (e) => {
    if (e.target.id !== "luAll") return;
    rows.forEach((r) => (e.target.checked ? picked.add(r.id) : picked.delete(r.id)));
    render();
  });
  $("luSel").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const ids = rows.filter((r) => picked.has(r.id)).map((r) => r.id);
    if (b.id === "luUndo") {
      if (!undo) return;
      undo.items.forEach(({ row, i }) => rows.splice(Math.min(i, rows.length), 0, row)); // 원래 자리로(앞 번호부터)
      undo = null; clearTimeout(undoT);
      render(); save();
      window.PanelHooks?.onListupChange();
      return;
    }
    const mv = b.dataset.mv;
    if (mv === "top") moveTo(ids, 0);
    else if (mv === "bottom") moveTo(ids, rows.length);
    else if (mv === "up") step(ids, -1);
    else if (mv === "down") step(ids, 1);
    else if (b.dataset.act === "del") remove(ids);
    else if (b.dataset.act === "none") { picked.clear(); render(); }
  });
  // ⠿ 끌어서 순서 바꾸기 — 체크한 행을 잡으면 체크한 행 전체가 함께 움직인다
  let drag = null;
  const clearMark = () => $("luBody").querySelectorAll(".drop-a,.drop-b").forEach((t) => t.classList.remove("drop-a", "drop-b"));
  $("luBody").addEventListener("dragstart", (e) => {
    const g = e.target.closest?.("[data-grip]");
    if (!g) return;
    const r = rows[+g.dataset.grip];
    drag = picked.has(r.id) ? rows.filter((x) => picked.has(x.id)).map((x) => x.id) : [r.id];
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(r.id));
    const tr = g.closest("tr"); e.dataTransfer.setDragImage(tr, 20, 17);
    requestAnimationFrame(() => drag?.forEach((id) => $("luBody").querySelector(`tr[data-r="${rows.findIndex((x) => x.id === id)}"]`)?.classList.add("dragging")));
    window.SeedTip?.hide();
  });
  $("luBody").addEventListener("dragover", (e) => {
    if (!drag) return;
    const tr = e.target.closest("tr[data-r]");
    if (!tr) return;
    e.preventDefault();
    const rc = tr.getBoundingClientRect(), below = e.clientY > rc.top + rc.height / 2;
    clearMark(); tr.classList.add(below ? "drop-b" : "drop-a");
  });
  $("luBody").addEventListener("drop", (e) => {
    if (!drag) return;
    e.preventDefault();
    const tr = e.target.closest("tr[data-r]");
    const ids = drag; drag = null; clearMark();
    if (!tr) return render();
    const target = rows[+tr.dataset.r], below = tr.classList.contains("drop-b") || e.clientY > tr.getBoundingClientRect().top + tr.offsetHeight / 2;
    if (ids.includes(target.id)) return render();
    const rest = rows.filter((r) => !ids.includes(r.id));
    moveTo(ids, rest.indexOf(target) + (below ? 1 : 0));
  });
  $("luBody").addEventListener("dragend", () => { if (drag) { drag = null; clearMark(); render(); } });

  // 계수 설정
  const setCfg = async (patch) => { cfg = await api.invoke("calc:set", patch); render(); };
  $("luView").addEventListener("click", () => {
    full = !full;
    try { localStorage.setItem("luFull", full ? "1" : "0"); } catch {}
    COLS = full ? TEMPLATE : SIMPLE; GROUPS = full ? TEMPLATE_GROUPS : SIMPLE_GROUPS;
    render();
  });
  $("cFx").addEventListener("change", (e) => n(e.target.value) > 0 && setCfg({ fx: +e.target.value }));
  $("cFee").addEventListener("change", (e) => setCfg({ fee: +e.target.value }));
  $("cAd").addEventListener("change", (e) => n(e.target.value) != null && setCfg({ adRate: Math.max(0, +e.target.value) / 100 }));
  $("luXlsx").addEventListener("click", async () => {
    if (!rows.length) return;
    clearTimeout(saveT);
    await api.invoke("listup:save", rows);
    $("luXlsx").disabled = true;
    // 🎤 발표 모드: 엑셀 저장 해커 화면 — 저장 위치를 고르는 동안 뜨고, 저장되면 실제 행을 훑는다
    const SIGV = { good: "go", mid: "warn", bad: "stop" };
    const sx = window.AiScan?.sheet(rows.map((x) => { const c = calc(x), [cls, txt] = verdict(x, c); return { name: x.name || x.keyword, img: x.img, keyword: x.keyword, yuan: n(x.yuan), price: n(x.price), margin: c.margin, rate: c.rate, sig: SIGV[cls] || "", note: String(txt || "").replace(/^[🟢🟡🔴]\s*/u, "") }; }));
    const r = await api.invoke("listup:export", rows.map((x) => { const c = calc(x); return { ...x, ad: c.ad, maxRoas: c.maxRoas, cpa: c.cpa }; })).catch((e) => ({ error: e?.message || String(e) }));
    if (sx) { if (r?.path) sx.saved(r.path); else if (r?.cancelled) sx.cancel(); else sx.fail(r?.error || "저장하지 못했습니다"); }
    $("luXlsx").disabled = false;
    if (r?.path) window.PanelHooks?.log("go", `■ 리스트업 엑셀 저장: ${esc(r.path)}`);
  });
  $("luAdd").addEventListener("click", () => {
    rows.push({ id: Date.now(), keyword: "", subs: [], logi: 2200 });
    render(); save();
    $("luBody").querySelector(`input[data-r="${rows.length - 1}"][data-f="keyword"]`)?.focus();
  });

  window.Listup = {
    has: (pid) => pid != null && rows.some((r) => String(r.pid) === String(pid)),
    // 검색 카드용: 이 상품을 리스트업에 담아 원가(위안)를 알면 경쟁사 월 순이익 추정
    bench(pid) { const r = rows.find((x) => String(x.pid) === String(pid)); if (!r || n(r.yuan) == null) return null; const c = calc(r); return c.bNet == null ? null : { net: c.bNet, unit: c.bUnit, roi: c.bRoi, yuan: n(r.yuan), auto: r.cnAuto || null }; },
    add(row) {
      const nr = rows.push({ id: Date.now() + Math.random(), reason: "", strategy: "", cnUrl: "", yuan: "", size: "", logi: 2200, logiAuto: true, cat: "", dims: "", wt: "",
        ...row, myPrice: row.recPrice ?? row.benchPrice ?? "", price: row.recPrice ?? row.benchPrice ?? "" }); // 🎯 추천 판매가(경쟁사보다 체감 할인)가 있으면 그 값
      render(); save();
      return rows[nr - 1];
    },
    // 🎯 담기 → 1688 자동 조사 줄에 넣기(사진 있는 행만). 끝나면 위안 칸이 채워지고 알림
    queue1688(r) {
      if (!r?.img || (r.yuan !== "" && r.yuan != null)) return;
      api.invoke("cn:queue", { rowId: r.id, name: r.name || r.keyword || "", keyword: r.keyword || "", img: r.img, allow: calc(r).allow, price: r.price }).catch(() => {});
    },
    render,
    async reloadCfg() { cfg = await api.invoke("calc:get"); render(); },
  };

  Promise.all([api.invoke("listup:get"), api.invoke("calc:get"), api.invoke("settings:get"), window.RG?.load()]).then(([r, c, st]) => {
    rows = Array.isArray(r) ? r : [];
    cfg = c || cfg;
    render();
    window.PanelHooks?.onListupChange();
  });
})();
