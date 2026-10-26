// 📄 상세페이지 자동 생성 — 화면(A5)
// 왼쪽: 리스트업 상품(1688 주소 있는 것) + 지난 작업 / 오른쪽: 템플릿 고르기 → ▶ 딸깍 → "AI 작업 화면"(aiscan 톤) → 결과(슬라이스 미리보기·폴더·피그마)
// 숫자·로그는 실제 진행 이벤트(detail:progress)만 쓴다. 대기 중 움직임은 경과 시간·스피너·점(...)·진행률 보간뿐이다.
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.signal;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const IMG = "https://thumbnail6.coupangcdn.com/thumbnails/remote/230x230ex/image/";
  const imgUrl = (p) => (!p ? "" : /^https?:/.test(p) ? p : IMG + String(p).replace(/^\//, ""));
  const fileUrl = (p) => { if (!p) return ""; const parts = String(p).replace(/\\/g, "/").split("/"); return "file://" + (parts[0] === "" ? "" : "/") + parts.map((x) => encodeURIComponent(x).replace(/%3A/gi, ":")).join("/"); };
  const clock = () => new Date().toLocaleTimeString("en-GB");
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
  // 진행 표시는 Moast 처럼 5단계로 묶는다(내부 단계는 그대로)
  const GROUPS = [
    { id: "g1", ko: "URL 상품 정보 수집", steps: ["extract", "download"] },
    { id: "g2", ko: "수집 데이터 AI 분석", steps: ["ocr", "clean", "vision", "cutout", "translate"] },
    { id: "g3", ko: "상세페이지 기획", steps: ["brief", "copy"] },
    { id: "g4", ko: "디자인 시스템 세팅", steps: ["scene", "plan", "review"] },
    { id: "g5", ko: "최종 데이터 분석·세팅", steps: ["render", "qa", "done"] },
  ];
  const groupOf = (step) => Math.max(0, GROUPS.findIndex((g) => g.steps.includes(step)));
  const STEPS = ["extract", "download", "ocr", "clean", "vision", "cutout", "translate", "brief", "copy", "scene", "plan", "review", "render", "qa", "done"]; // v3 15단계(장면 사진은 기획안·카피와 동시에 돌고 여기서 합류)
  const STEP_KO = { extract: "상품 정보 읽기", download: "이미지 내려받기", ocr: "중국어 글자 찾기", clean: "사진 영역 자르기", vision: "사진 검수", cutout: "제품 누끼", scene: "AI 장면 사진", translate: "한글 번역", brief: "기획안", review: "확인", qa: "AI 자가 검수", copy: "카피 작성", plan: "페이지 구성", render: "렌더링", done: "완료" };
  // 순환 부제: 단계마다 2~3개 문구를 돌린다(결과 숫자 없음 — 하는 일 설명만)
  const SUBS = {
    extract: ["상품 정보 읽는 중", "제목·속성표·옵션 정리 중"], download: ["이미지 내려받는 중", "대표·상세 이미지 모으는 중"], ocr: ["중국어 글자 찾는 중", "이미지 속 문장 상자 읽는 중"],
    clean: ["글자 없는 사진 영역 잘라내는 중", "사진 영역 찾는 중"], vision: ["사진 검수 — AI가 사진을 직접 봅니다", "쓸 수 있는 사진 고르는 중"], cutout: ["제품 누끼 따는 중", "상품 색 팔레트 뽑는 중"], scene: ["AI 장면 사진 만드는 중 — 한국 집 안에 제품을 놓습니다", "제품 모양이 원본과 같은지 검수 중"], brief: ["기획안 쓰는 중 — 누구에게·무엇을·왜", "섹션 뼈대 잡는 중"], review: ["구성 확인 — 사진 교체·헤드라인 수정", "'이대로 렌더'를 누르면 이어집니다"], qa: ["AI 자가 검수 — 완성본을 직접 봅니다", "결함 고치고 다시 그리는 중"], translate: ["한글 번역 중", "속성·옵션·문장 번역 중"], copy: ["카피 쓰는 중", "헤드라인·핵심포인트·FAQ 쓰는 중"],
    plan: ["페이지 구성 중", "이미지 분류·섹션 배치 중"], render: ["렌더링 중", "780px 이미지로 굽는 중"], done: ["완료"],
  };
  const HOW_KO = { lite: "자체 대체", copy: "원본 복사(지우기 모듈 없음)", none: "OCR 없음", reuse: "재사용", skip: "번역 불필요", given: "입력값", failed: "실패→원문", rules: "규칙 기반", cli: "Claude CLI", server: "서버 중계", vision: "macOS Vision", tesseract: "tesseract" };

  const root = $("detail");
  if (!root || !api) return;
  root.innerHTML = `
  <div class="dt-bar"><b>📄 상세페이지 자동 생성</b><span class="muted" id="dtInfo">1688 상세 이미지 → 중국어 지우고 한글로 → 쿠팡 780px 상세페이지</span><span class="spacer"></span><button id="dtRefresh" class="sec" type="button" title="리스트업·지난 작업 다시 읽기">↻ 목록</button></div>
  <div class="dt-body">
    <div class="dt-scrim" id="dtScrim"></div>
    <aside class="dt-left" id="dtLeft">
      <div id="dtRowsGrp" hidden><div class="dt-sec">리스트업 · 1688 주소 있는 상품 <b id="dtRowN">0</b></div>
      <div class="dt-list" id="dtRows"><p class="dt-empty">리스트업에 1688 주소가 있는 상품이 없습니다. 📋 리스트업 → 🔍1688 → 상품 페이지에서 <b>리스트업에 넣기</b>를 하면 여기 보입니다.</p></div></div>
      <div class="dt-sec">지난 작업 <b id="dtJobN">0</b></div>
      <div class="dt-list" id="dtJobs"><p class="dt-empty">아직 만든 상세페이지가 없습니다.</p></div>
    </aside>
    <section class="dt-main" id="dtMain">
      <div class="dt-setup" id="dtSetup">
        <div class="dt-sec">상품 주소로 바로 만들기</div>
        <form class="dt-url" id="dtUrlForm"><input id="dtUrl" class="mono" type="text" spellcheck="false" autocomplete="off" placeholder="상품 주소 붙여넣기 (1688 · 타오바오 · 쿠팡 · 네이버 · 오늘의집)"><button id="dtUrlGo" type="submit">▶ 주소로 만들기</button></form>
        <div class="dt-sites" id="dtSites">${[["1688", "1688"], ["taobao", "타오바오"], ["coupang", "쿠팡"], ["naver", "네이버"], ["ohou", "오늘의집"]].map(([k, n]) => `<span data-site="${k}">${n}</span>`).join("")}</div>
        <p class="dt-urlmsg" id="dtUrlMsg">그 사이트 화면에서 상품 정보를 읽어 옵니다. 로그인·인증이 뜨면 그 화면에서 넘겨 주세요.</p>
        <div class="dt-pick" id="dtPick"><div class="dt-pick-empty">왼쪽에서 상품을 고르거나, <b>🇨🇳 1688 상품 화면</b> 오른쪽 위의 <b>📄 상세페이지 만들기</b> 버튼을 누르세요.</div></div>
        <div class="dt-sec">템플릿</div>
        <div class="dt-tpls" id="dtTpls"></div>
        <button id="dtGo" class="dt-go" type="button" disabled>▶ 딸깍 — 상세페이지 만들기</button>
        <button id="dtFolder" class="sec dt-folder" type="button" title="이미지 다운로더로 받은 폴더(main-·SKU-·detail- 파일)로 시작">📂 폴더로 만들기</button>
        <p class="dt-guide" id="dtGuide"></p>
        <div class="dt-opts"><label><input type="checkbox" id="dtOptReview"> 렌더 직전에 구성 한 번 더 확인(사람 손 30초 — 사진 교체·헤드라인 수정)</label><label><input type="checkbox" id="dtOptPresentAuto" checked> 발표 모드에서는 확인 없이 자동 진행</label>
          <div class="dt-key"><span>🎨 이미지 생성 키(Gemini)</span><input id="dtKey" type="password" autocomplete="off" spellcheck="false" placeholder="AIza… (저장만 하고 어디에도 기록하지 않습니다)"><select id="dtKeyModel" title="이미지 생성 모델"><option value="gemini-2.5-flash-image">gemini-2.5-flash-image (기본)</option><option value="gemini-2.0-flash-preview-image-generation">gemini-2.0-flash-preview-image-generation</option></select><button id="dtKeySave" class="sec" type="button">저장</button><button id="dtKeyClear" class="sec" type="button" title="저장된 키 지우기">지우기</button><small id="dtKeyState"></small></div>
          <div class="dt-gc" id="dtGc">
            <div class="dt-gc-head"><b>🔗 내 구글 클라우드</b><span id="dtGcState">연결 안 됨</span><small id="dtGcTrial"></small></div>
            <div class="dt-gc-form"><label class="sec dt-gc-file" data-tip="서비스 계정 키 파일(.json)을 고르거나 이 칸으로 끌어다 놓기">📄 키 파일로 연결<input id="dtGcFile" type="file" accept=".json,application/json" hidden></label><input id="dtGcKey" type="password" autocomplete="off" spellcheck="false" placeholder="또는 API 키 (AIza…)"><input id="dtGcProj" autocomplete="off" spellcheck="false" placeholder="프로젝트 ID"><button id="dtGcSave" class="sec" type="button">연결</button><button id="dtGcTest" class="sec" type="button" data-tip="글 AI · 이미지 AI · 글자 읽기가 되는지 다시 확인">확인</button><button id="dtGcClear" class="sec" type="button" data-tip="이 PC 에서 구글 연결 지우기">끊기</button></div>
            <ul class="dt-gc-checks" id="dtGcChecks"></ul>
            <div class="dt-gc-links"><button class="lnk" type="button" data-gc="trial">무료 체험 시작</button><button class="lnk" type="button" data-gc="vertex">Vertex AI 켜기</button><button class="lnk" type="button" data-gc="vision">Cloud Vision 켜기</button><button class="lnk" type="button" data-gc="keys">API 키 만들기</button><button class="lnk" type="button" data-gc="credits">남은 크레딧 보기</button></div>
          </div>
          <div class="dt-usage" id="dtUsage" hidden>
            <div class="dt-unums"><div><b id="uToday">0장</b><small>오늘</small></div><div><b id="uMonth">0장</b><small>이번 달</small></div><div><b id="uCost">₩0</b><small>이번 달 예상 비용</small></div><button id="uBill" class="sec" type="button" data-tip="실제 청구 금액 보기(브라우저로 열림)">💳 실제 청구</button></div>
            <details class="dt-umore"><summary>자세히</summary><div class="dt-uweek" id="uWeek"></div><div class="dt-umodels" id="uModels"></div><small class="dt-unote" id="uNote"></small></details>
          </div>
          <small class="dt-keyhelp">키가 있으면 누끼 제품을 한국 집 안 장면에 다시 놓은 AI 사진(대표 1 + 포인트 3컷 × 2장)을 만들어 검수 뒤 씁니다. 없으면 이 단계는 건너뜁니다.</small></div>
      </div>
      <div class="dt-review" id="dtReview" hidden>
        <div class="dt-rvhead"><b>✋ 구성 확인</b><span class="muted" id="rvInfo">사진을 누르면 다른 사진으로 바꿀 수 있고, 글은 바로 고칠 수 있습니다</span><a id="rvSrc" class="dt-rvsrc" href="#" hidden title="원본 1688 주소 — 앱의 1688 탭에서 열기">🔗 원본</a><span class="spacer"></span><button id="rvSkip" class="sec" type="button">그냥 렌더</button><button id="rvGo" class="pri" type="button">✔ 이대로 렌더</button></div>
        <div class="dt-rvbody"><ol class="dt-rvlist" id="rvList"></ol><aside class="dt-rvpick" id="rvPick" hidden><div class="dt-sec">다른 사진 고르기 <button id="rvPickClose" class="sec" type="button">닫기</button></div><div class="dt-rvphotos" id="rvPhotos"></div></aside></div>
      </div>
      <div class="dt-work" id="dtWork" hidden>
        <div class="dt-win">
          <div class="dt-engine"><b></b>AI DETAIL ENGINE</div>
          <div class="dt-chip" id="dwTitle"><b></b><span>상품</span></div>
          <div class="dt-title">상세페이지 만드는 중<span class="dots">...</span></div>
          <div class="dt-sub"><span id="dwSub">준비 중</span></div>
          <div class="dt-prow"><span class="dt-found" id="dwFound">이미지 <b>0</b>장</span><span class="dt-pct" id="dwPct">0%</span></div>
          <div class="dt-pbar"><i id="dwBar"></i></div>
          <div class="dt-cols">
            <ol class="dt-steps" id="dwSteps">${GROUPS.map((g) => `<li data-step="${g.id}"><i></i><span>${esc(g.ko)}</span><small></small></li>`).join("")}</ol>
            <div class="dt-gridwrap"><div class="dt-grid" id="dwGrid"></div></div>
          </div>
          <div class="dt-term"><div class="dt-th"><i></i><i></i><i></i>AI Detail Engine · 1688 → 쿠팡 780px</div><div class="dt-log" id="dwLog"></div>
            <div class="dt-live"><span class="sp" id="dwSp">⠋</span><span class="m" id="dwLive">엔진 준비 중</span><span class="ms" id="dwMs">0.00s</span></div></div>
          <button class="dt-cancel" type="button" id="dwCancel">✕ 취소</button>
        </div>
      </div>
      <div class="dt-infov" id="dtInfoV" hidden>
        <div class="dt-ivhead"><div><b>✅ 상품 정보를 가져왔어요</b><small id="ivSub">확인하고 고친 뒤 상세페이지를 생성하세요</small></div><span class="spacer"></span><a id="ivSrc" href="#" title="앱의 🇨🇳 1688 탭에서 원본 열기"></a><button id="ivRefetch" class="sec" type="button" title="사진 선별·누끼·기획을 다시 분석합니다">↻ 다시 가져오기</button></div>
        <div class="dt-ivrights" id="ivRights" hidden></div>
        <div class="dt-ivbody">
          <section class="dt-ivmode"><h4>만들기 방식</h4><div class="dt-modes" id="ivModes"></div></section>
          <section><h4>① 대표 이미지(main) <small>AI 이미지 선별 — 불필요한 사진은 AI가 제외했어요(누르면 포함/제외)</small></h4><div class="dt-ivgrid" id="ivGallery"></div>
            <h4 id="ivSkuH" hidden>옵션 이미지(SKU) <small id="ivSkuN"></small></h4><div class="dt-ivgrid small" id="ivSku"></div></section>
          <section><h4>② 상세 이미지 <small id="ivDetailN"></small></h4><div class="dt-ivgrid small" id="ivDetail"></div>
            <details id="ivTextsBox"><summary id="ivTextsSum">이미지에서 추출한 텍스트 확인하기</summary><div id="ivTexts"></div></details></section>
          <section><h4>③ 상품명</h4><input id="ivName" type="text" maxlength="80" placeholder="판매용 한글 상품명"></section>
          <section><h4>④ 상품정보 <small>기획서 — 직접 고칠 수 있어요</small><button id="ivAiRe" class="sec" type="button">✦ AI 정보추출</button></h4><textarea id="ivBrief" rows="16" spellcheck="false"></textarea></section>
          <section><h4>⑤ 디자인 스타일</h4><div class="dt-tpls" id="ivTpls"></div>
            <div class="dt-ivstyle" id="ivStyle"></div></section>
          <section class="dt-claims"><h4>⑦ 판매 실적·신뢰 배지 <small>선택 — 켠 항목만 상세페이지에 들어가요</small><button id="ivClaimSug" class="sec" type="button">✦ 문구 예시 받기</button></h4>
            <p class="dt-claimnote">실제 사실만 입력하세요. 허위·과장 표시는 표시광고법 위반이 될 수 있습니다.</p>
            <div class="dt-claimlist" id="ivClaims"></div></section>
        </div>
        <div class="dt-ivfoot"><span id="ivEst"></span><span class="spacer"></span><div class="dt-ivgo"><button id="ivGo" class="dt-go" type="button">✦ 상세페이지 생성하기</button><p class="dt-iverr" id="ivErr" hidden></p></div></div>
      </div>
      <div class="dt-result" id="dtResult" hidden>
        <div class="dt-rhead">
          <div class="dt-rline"><span class="dt-rapp" title="상세페이지">📄</span><b id="drTitle"></b><span class="dt-src" id="drSrc" hidden><a id="drSrcUrl" href="#"></a><button id="drSrcOpen" class="ic" type="button" data-tip="🔗 원본 1688 페이지 열기" aria-label="원본 1688 페이지 열기">🔗</button><button id="drSrcCopy" class="ic" type="button" data-tip="⧉ 원본 주소 복사" aria-label="원본 주소 복사">⧉</button></span>
            <span class="spacer"></span>
            <div class="dt-racts">
              <button id="drFolder" class="ic pri wide" type="button" data-tip="📂 결과 폴더 열기" aria-label="결과 폴더 열기">📂<span>폴더</span></button>
              <button id="drFigma" class="ic" type="button" data-tip="🎨 피그마 묶음 저장" aria-label="피그마 묶음 저장">🎨</button>
              <button id="drHtml" class="ic" type="button" data-tip="🌐 HTML로 보기" aria-label="HTML로 보기">🌐</button>
              <button id="drTpl" class="ic" type="button" data-tip="↻ 다른 템플릿·테마로 다시 그리기" aria-label="다른 템플릿·테마로 다시 그리기">↻</button>
              <button id="drExpGo" class="ic wide" type="button" data-tip="⬇ 이미지 내보내기" aria-label="이미지 내보내기">⬇<span>내보내기</span></button>
              <button id="drList" class="ic" type="button" data-tip="☰ 작업 목록 열기" aria-label="작업 목록 열기" aria-expanded="false">☰</button>
              <button id="drClose" class="ic" type="button" data-tip="✕ 결과 닫기" aria-label="결과 닫기">✕</button>
            </div></div>
        </div>
        <span class="dt-rmeta" id="drMeta"></span>
        <div class="dt-rtabs" id="drTabs"></div>
        <div class="dt-rtpl" id="drTplPick" hidden></div>
        <div class="dt-rsum" id="drSumWrap"><button type="button" class="dt-rsumline" id="drSum" aria-expanded="false" data-tip="누르면 검수 제안·단계별 시간·처리 내역을 펼칩니다"></button>
          <div class="dt-rsumbody" id="drSumBody" hidden><div class="dt-qa" id="drQa" hidden></div><p class="dt-times" id="drTimes" hidden></p><p class="dt-rhow" id="drHow"></p></div></div>
        <div class="dt-rbody">
          <aside class="dt-secs" id="drSecs" hidden><div class="dt-sec">섹션 <small>누르면 편집</small></div><div class="dt-locqa" id="drLocQa" hidden></div><button type="button" class="dt-qafilter" id="drQaOnly" hidden aria-pressed="false" data-tip="⚠ 확인이 필요한 장만 보기 — 다시 누르면 전체"></button><div class="dt-locrem" id="drLocRem" hidden></div><div class="dt-srcsum"><span id="drSrcSum"></span><button class="sec" id="drSrcToggle" type="button" aria-pressed="true" data-tip="미리보기 위에 섹션마다 원본/AI 생성 표시를 켜고 끕니다">미리보기 표시</button></div><ol id="drSecList"></ol></aside>
          <div class="dt-slices" id="drSlices"></div>
          <aside class="dt-sedit" id="drSedit" hidden>
            <div class="dt-sec">섹션 편집 <b id="seName"></b><button id="seClose" class="sec" type="button">닫기</button></div>
            <img id="seImg" alt="">
            <label>요청문 <small>(예: 제품 원본과 다른 확대샷이야)</small><textarea id="seReq" rows="3"></textarea></label>
            <label class="chk"><input type="checkbox" id="seRewrite"> 이 섹션 글도 다시 쓰기</label>
            <button id="seRegen" class="pri" type="button">↻ 이 섹션 다시 만들기</button>
            <div class="dt-sec">글자 바로 고치기 <small>AI 호출 없음</small></div><div id="seTexts"></div>
            <button id="seSaveText" class="sec" type="button">✔ 글자 저장·다시 그리기</button>
            <div class="dt-semove"><button id="seUp" class="sec" type="button">▲ 위로</button><button id="seDown" class="sec" type="button">▼ 아래로</button><button id="seDel" class="sec" type="button">🗑 섹션 삭제</button></div>
          </aside>
          <aside class="dt-sedit dt-loced" id="drLoced" hidden>
            <div class="dt-sec"><b id="leName"></b><button id="leClose" class="sec" type="button">닫기</button></div>
            <div class="le-state" id="leState"></div>
            <div class="le-acts">
              <button type="button" class="le-big" data-le="autofix" data-tip="🔧 이 장만 검수를 다시 돌려 글 배치·지운 자리·문구를 고쳐요 (1~2분)"><b>🔧 다시 자동 고치기</b><small>이 장만 다시 손봐요</small></button>
              <button type="button" class="le-big" data-le="tidy" data-tip="📐 같은 종류 글의 크기와 줄 왼쪽 끝을 똑같이 맞춰요 (몇 초)"><b>📐 줄·크기 맞추기</b><small>크기·줄 끝 통일</small></button>
              <button type="button" class="le-big" data-le="plain" data-tip="🖼 중국어를 지운 그림만 두고 한글은 얹지 않아요 — 글이 지저분할 때"><b>🖼 한글 빼고 그림만</b><small>글 없이 깨끗하게</small></button>
              <button type="button" class="le-big" data-le="drop" data-tip="🙈 이 장을 상세페이지에서 빼요 — 목록 위 ‘뺀 장’에서 다시 넣을 수 있어요"><b>🙈 이 장 빼기</b><small>다시 넣을 수 있어요</small></button>
            </div>
            <div class="le-ask"><input id="leAsk" type="text" maxlength="200" placeholder="이 장에 요청 — 예: 글자를 원 안에 넣어줘"><button id="leAskGo" class="sec" type="button" data-tip="🤖 AI 가 이 장의 글을 요청대로 고쳐요 (30초~1분)">보내기</button></div>
            <details class="le-more" id="leMore"><summary>✏️ 글 직접 고치기 · 세부 조정</summary><div id="leLines"></div><button id="leSave" class="pri" type="button">✔ 저장하고 다시 그리기</button></details>
            <div class="le-foot"><button id="leUndo" class="sec" type="button" data-tip="↶ 이 장을 바로 전 상태로 되돌려요">↶ 되돌리기</button><span id="leBusy"></span></div>
          </aside>
        </div>
        <div class="dt-export" id="drExport"><b>내보내기</b><select id="exW"><option value="780">780px</option><option value="860">860px</option></select><select id="exF"><option value="jpg">JPG</option><option value="png">PNG</option></select><select id="exM"><option value="single">한 장으로</option><option value="sections">섹션별</option></select><button id="exGo" class="sec" type="button">⬇ 폴더에 저장</button><small id="exMsg"></small></div>
      </div>
    </section>
  </div>`;

  const st = { rows: [], jobs: [], tpls: [], sel: null, tpl: "clean", mode: "setup", work: null, lastResult: null };
  try { st.tpl = localStorage.getItem("detailTpl") || "clean"; } catch {}

  // ---------- 왼쪽 목록 ----------
  const is1688 = (u) => /^https?:\/\/([\w-]+\.)*1688\.com\//.test(String(u || ""));
  async function load() {
    const [rows, jobs, tpls] = await Promise.all([api.invoke("listup:get").catch(() => []), api.invoke("detail:list").catch(() => []), api.invoke("detail:templates").catch(() => [])]);
    st.rows = (rows || []).filter((r) => r.cnUrl); st.jobs = jobs || []; st.tpls = (tpls || []).filter((t) => t.kind !== "mine"); // 🧲 내 템플릿은 테마 목록(THEMES)에서 보인다
    renderLists(); renderTpls();
    const n = st.jobs.filter((j) => j.status === "done").length;
    const c = $("dcount"); if (c) { c.textContent = String(n); c.hidden = !n; }
    if (st.sel?.kind === "job") { const j = st.jobs.find((x) => x.jobId === st.sel.jobId); if (j) st.sel = { kind: "job", ...j }; }
    renderPick();
  }
  function renderLists() {
    $("dtRowN").textContent = String(st.rows.length); $("dtRowsGrp").hidden = st.mode === "result" || !st.rows.length; // 결과 화면이 아니고 리스트업 상품이 있을 때만 그 묶음을 보인다
    $("dtJobN").textContent = String(st.jobs.length);
    if (st.rows.length) $("dtRows").innerHTML = st.rows.map((r) => `<button class="dt-item${st.sel?.kind === "row" && st.sel.id === r.id ? " on" : ""}" type="button" data-row="${esc(r.id)}">
      ${r.img ? `<img src="${esc(imgUrl(r.img))}" alt="">` : `<span class="ph">📋</span>`}<span class="tx"><b>${esc(r.name || r.cnTitle || r.keyword || "(이름 없음)")}</b><small>${esc(r.keyword || "")}${r.cnTitle ? " · " + esc(String(r.cnTitle).slice(0, 30)) : ""}</small></span><em>${is1688(r.cnUrl) ? "1688" : "URL"}</em></button>`).join("");
    if (st.jobs.length) $("dtJobs").innerHTML = st.jobs.map((j) => `<button class="dt-item${st.sel?.kind === "job" && st.sel.jobId === j.jobId ? " on" : ""}" type="button" data-job="${esc(j.jobId)}" title="${esc(j.url || "원본 주소 없음")}">
      ${j.preview ? `<img src="${esc(fileUrl(j.preview))}" alt="">` : `<span class="ph">${j.status === "running" ? "⏳" : j.status === "done" ? "📄" : "✕"}</span>`}<span class="tx"><b>${esc(j.title)}</b><small>${new Date(j.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${esc(j.templateId)}${j.sliceCount ? ` · ${j.sliceCount}장` : ""}</small></span>${j.renderCount > 1 ? `<i class="dt-rc" title="렌더 ${j.renderCount}개(템플릿별 보관)">${j.renderCount}</i>` : ""}<em class="${esc(j.status)}">${j.status === "done" ? "완료" : j.status === "prepared" ? "확인 대기" : j.status === "running" ? "진행 중" : j.status === "cancelled" ? "취소" : j.status === "failed" ? "실패" : "미완"}</em></button>`).join("");
    else $("dtJobs").innerHTML = `<p class="dt-empty">아직 만든 상세페이지가 없습니다.</p>`;
  }
  function renderTpls() {
    const tpls = st.tpls.length ? st.tpls : [{ id: "clean", name: "화이트 클린", desc: "" }, { id: "dark", name: "다크 프리미엄", desc: "" }, { id: "pop", name: "컬러 팝", desc: "" }];
    const card = (t) => `<button class="dt-tpl${st.tpl === t.id ? " on" : ""}" type="button" data-tpl="${esc(t.id)}" title="${esc(t.desc || "")}">
      <span class="mini ${esc(t.id)}"><i class="hero"></i><i class="h"></i><i class="l"></i><i class="l s"></i><i class="img"></i><i class="l"></i><i class="cta"></i></span><b>${esc(t.name)}</b><small>${esc(t.desc || "")}</small>${t.ready === false ? `<em>자체 렌더</em>` : ""}</button>`;
    $("dtTpls").innerHTML = tpls.map(card).join("");
    $("drTplPick").innerHTML = tpls.map(card).join("");
  }
  function renderPick() {
    const s = st.sel, go = $("dtGo"), guide = $("dtGuide");
    if (!s) { $("dtPick").innerHTML = `<div class="dt-pick-empty">왼쪽에서 상품을 고르거나, <b>🇨🇳 1688 상품 화면</b> 오른쪽 위의 <b>📄 상세페이지 만들기</b> 버튼을 누르세요.</div>`; go.disabled = true; go.textContent = "▶ 딸깍 — 상세페이지 만들기"; guide.textContent = ""; return; }
    if (s.kind === "row") {
      $("dtPick").innerHTML = `<div class="dt-pick-card">${s.img ? `<img src="${esc(imgUrl(s.img))}" alt="">` : ""}<div><b>${esc(s.name || s.cnTitle || s.keyword || "")}</b><small>${esc(s.keyword || "")}</small><input class="mono" readonly value="${esc(s.cnUrl)}" title="1688 상품 주소"></div></div>`;
      go.disabled = !is1688(s.cnUrl); go.textContent = is1688(s.cnUrl) ? "▶ 딸깍 — 1688에서 읽어 상세페이지 만들기" : "▶ 1688 상품 주소가 아닙니다";
      guide.innerHTML = is1688(s.cnUrl) ? `상품 정보는 <b>1688 화면에서 직접</b> 읽습니다(추가 요청 없음). 1688 탭에서 이 주소를 자동으로 열어 읽은 뒤 이 화면으로 돌아와 진행됩니다. 로그인·보안 인증이 뜨면 1688 탭에서 넘기고 그 화면의 <b>📄 상세페이지 만들기</b> 버튼을 누르세요.` : `1688(detail.1688.com) 상품 주소만 지원합니다. 타오바오·티몰은 1688 탭에서 열어 📄 버튼을 눌러 보세요.`;
      return;
    }
    $("dtPick").innerHTML = `<div class="dt-pick-card">${s.preview ? `<img src="${esc(fileUrl(s.preview))}" alt="">` : ""}<div><b>${esc(s.title)}</b><small>${new Date(s.createdAt).toLocaleString("ko-KR")} · 템플릿 ${esc(s.templateId)} · ${s.status === "done" ? `완료 ${s.sliceCount}장` : s.status}</small>${s.url ? `<input class="mono" readonly value="${esc(s.url)}">` : ""}</div></div>`;
    const canRe = s.status !== "running";
    go.disabled = !canRe; go.textContent = s.status === "done" ? "↻ 고른 템플릿으로 다시 그리기" : "↻ 다시 만들기(남은 단계만)";
    guide.innerHTML = s.status === "done" ? `OCR·번역·카피는 다시 하지 않고 <b>구성(plan)만 템플릿에 다시 그립니다</b>. 결과를 보려면 왼쪽 목록의 작업을 두 번 누르세요.` : `중간에 멈춘 작업입니다. 이미 받은 이미지·OCR 결과는 재사용합니다.`;
  }
  $("dtRows").addEventListener("click", (e) => { const b = e.target.closest("[data-row]"); if (!b) return; st.sel = { kind: "row", ...st.rows.find((r) => String(r.id) === b.dataset.row) }; renderLists(); renderPick(); });
  $("dtJobs").addEventListener("click", (e) => { const b = e.target.closest("[data-job]"); if (!b) return; root.classList.remove("dt-listopen"); $("drList")?.setAttribute("aria-expanded", "false"); if ($("drList")) { $("drList").dataset.tip = "☰ 작업 목록 열기"; $("drList").classList.remove("on"); } const j = st.jobs.find((x) => x.jobId === b.dataset.job); if (!j) return; st.sel = { kind: "job", ...j }; renderLists(); renderPick(); if (j.status === "done") showResult(j.jobId); else if (j.status === "prepared") openInfo(j.jobId); else if (j.status === "running") { setMode("work"); } });
  $("dtJobs").addEventListener("dblclick", (e) => { const b = e.target.closest("[data-job]"); if (b) { const j = st.jobs.find((x) => x.jobId === b.dataset.job); if (j?.status === "done") showResult(j.jobId); } });
  const pickTpl = (id) => { st.tpl = id; try { localStorage.setItem("detailTpl", id); } catch {} api.invoke("detail:setTemplate", id).catch(() => {}); renderTpls(); };
  $("dtTpls").addEventListener("click", (e) => { const b = e.target.closest("[data-tpl]"); if (b) pickTpl(b.dataset.tpl); });
  // v5(카드) 테마 카드 — 미니 미리보기 색 [바탕, 카드, 포인트]
  let THEMES = []; // 기본 테마(kind theme) + 🧲 내 템플릿(kind mine) — detail:themes
  const loadThemes = () => api.invoke("detail:themes").then((t) => { THEMES = Array.isArray(t) ? t : []; }).catch(() => {});
  loadThemes();
  const themeName = (id) => THEMES.find((t) => t.id === id)?.name || id;
  const themeCard = (t, on) => `<button class="dt-tpl dt-theme${on ? " on" : ""}${t.kind === "mine" ? " mine" : ""}" type="button" data-theme="${esc(t.id)}" title="${esc(t.desc || "")}"><span class="mini" style="--m-bg:${esc(t.colors?.[0] || "#fff")};--m-fg:${esc(t.colors?.[1] || "#eee")};--m-ac:${esc(t.colors?.[2] || "#16a34a")};--m-img:${esc(t.colors?.[1] || "#eee")}"><i class="hero"></i><i class="h"></i><i class="l"></i><i class="l s"></i><i class="img"></i><i class="l"></i><i class="cta"></i></span><b>${esc(t.name)}</b><small>${esc(t.desc || "")}</small>${t.kind === "mine" ? `<em class="mine">🧲 내 템플릿</em>` : ""}</button>`;
  const importCard = () => `<button class="dt-tpl dt-theme dt-tplimport" type="button" data-import title="카톡·강의 자료로 받은 템플릿 파일(.seedtpl.json)을 보관함에 넣습니다"><span class="mini imp">📥</span><b>가져오기</b><small>.seedtpl.json 파일</small></button>`;
  // 🧲 세부 조정 칩(손잡이) — 템플릿 overrides. enum 은 칩, 색은 색 고르기(+없음), 숫자는 슬라이더
  const chipRows = (chips, tplId) => (chips || []).map((c) => `<div class="dt-chiprow${c.changed ? " changed" : ""}"><span class="k">${esc(c.label)}</span>${c.kind === "enum"
    ? c.values.map((v) => `<button type="button" class="chip${c.value === v ? " on" : ""}" data-ovk="${esc(c.key)}" data-ovv="${esc(v)}">${esc(c.ko?.[v] || v)}</button>`).join("")
    : c.kind === "color" ? `<input type="color" data-ovk="${esc(c.key)}" value="${esc(c.value || "#888888")}" title="${esc(c.label)}"><code>${esc(c.value || "없음")}</code>${/brand/.test(c.key) ? `<button type="button" class="chip${c.value ? "" : " on"}" data-ovk="${esc(c.key)}" data-ovv="">없음</button>` : ""}`
    : `<input type="range" data-ovk="${esc(c.key)}" min="${c.min}" max="${c.max}" step="${c.step || 1}" value="${esc(c.value ?? c.min)}"><code>${esc(c.value ?? "-")}</code>`}</div>`).join("") + `<div class="dt-chipfoot"><button type="button" class="sec" data-ovreset="${esc(tplId)}">↺ 조정 초기화</button><span class="muted">바꾼 칩은 이 템플릿에 저장돼 다음 상품에도 그대로 쓰여요</span></div>`;
  // 순서 따르기 강도 토글: 레퍼런스 그대로(false) / 우리 강점 섹션 유지(true, applyReferenceOrder keepExtra)
  const keepToggle = (on) => `<div class="dt-keep"><span class="k">섹션 순서</span><button type="button" class="chip${on ? "" : " on"}" data-keep="0" title="레퍼런스에 없는 우리 섹션은 뺍니다(레퍼런스처럼 짧게)">레퍼런스 그대로</button><button type="button" class="chip${on ? " on" : ""}" data-keep="1" title="레퍼런스에 없는 우리 장점 섹션(상세·활용·옵션)도 원래 자리에 남깁니다">우리 강점 섹션 유지</button></div>`;
  const tplActions = (id) => `<div class="dt-tplacts"><input class="dt-tplname" type="text" maxlength="40" value="${esc(themeName(id))}" data-tplname="${esc(id)}" title="템플릿 이름 — 고치고 ✎ 저장"><button type="button" class="sec" data-tplact="rename" data-id="${esc(id)}">✎ 이름 저장</button><button type="button" class="sec" data-tplact="export" data-id="${esc(id)}">📤 내보내기</button><button type="button" class="sec danger" data-tplact="remove" data-id="${esc(id)}">🗑 삭제</button></div>`;
  async function tplAction(act, id, after) {
    if (act === "rename") { const cur = themeName(id); const name = (root.querySelector(`[data-tplname="${id}"]`)?.value || "").trim(); if (!name || name === cur) return; const r = await api.invoke("detail:template:set", { id, name }); if (r?.error) return flash(r.error); await loadThemes(); toast(`✔ 이름 바꿈 · ${name}`); }
    else if (act === "export") { const r = await api.invoke("detail:template:export", { id }); if (r?.cancelled) return; if (r?.error) return flash(r.error); toast(`✔ 내보내기 · ${r.file.split(/[\\/]/).pop()} — 카톡·강의 자료로 주고받으세요`); return; }
    else if (act === "remove") { if (!confirm(`「${themeName(id)}」 템플릿을 보관함에서 지울까요?`)) return; const r = await api.invoke("detail:template:remove", { id }); if (r?.error) return flash(r.error); await loadThemes(); toast("🗑 템플릿 삭제"); }
    after?.();
  }
  async function tplImport(after) { const r = await api.invoke("detail:template:import", {}); if (r?.cancelled) return null; if (r?.error) { flash(r.error); return null; } await loadThemes(); toast(`✔ 템플릿 가져옴 · ${r.template?.name || ""}`); after?.(r.template); return r.template; }
  const isV5Result = (r) => !!r && ((r.renders || []).find((x) => x.id === r.current)?.templateId === "card" || r.templateId === "card");
  $("drTplPick").addEventListener("click", async (e) => {
    if (e.target.closest("[data-import]")) { await tplImport(() => renderThemePick()); return; }
    const th = e.target.closest("[data-theme]");
    if (th && st.lastResult) { $("drTplPick").hidden = true; const r = await api.invoke("detail:theme", { jobId: st.lastResult.jobId, theme: th.dataset.theme }); if (r?.error) flash(r.error); return; }
  });
  $("drTplPick").addEventListener("click", async (e) => { if (e.target.closest("[data-theme]")) return; const b = e.target.closest("[data-tpl]"); if (!b || !st.lastResult) return; pickTpl(b.dataset.tpl); $("drTplPick").hidden = true; const r = await api.invoke("detail:rerender", { jobId: st.lastResult.jobId, templateId: st.tpl, review: reviewFlag() }); if (r?.error) flash(r.error); });
  $("dtRefresh").onclick = load;
  $("dtGo").onclick = async () => {
    const s = st.sel; if (!s) return;
    if (s.kind === "row") { if (is1688(s.cnUrl)) await fromUrl(s.cnUrl, s.id); return; }
    const r = await api.invoke("detail:rerender", { jobId: s.jobId, templateId: st.tpl, review: reviewFlag() });
    if (r?.error) flash(r.error);
  };
  // 주소(또는 상품번호) → 1688 탭에서 열어 읽기 → 파이프라인. 진행 화면 전환은 메인(detail:fromPage → showDetail)이 한다
  let urlBusy = false;
  // 붙여 넣은 주소 → 사이트 칩(site-core.js siteOfText 와 같은 규칙 — 칩 표시만, 판정은 메인이 한다)
  const SITE_KO = { "1688": "1688", taobao: "타오바오", tmall: "티몰", coupang: "쿠팡", naver: "네이버", ohou: "오늘의집" };
  const siteOfText = (s) => { s = String(s || "").trim(); return /^\d{6,20}$/.test(s) || /1688\.com/i.test(s) ? "1688" : /tmall\.(com|hk)/i.test(s) ? "tmall" : /taobao\.com/i.test(s) ? "taobao" : /coupang\.com/i.test(s) ? "coupang" : /(smartstore|brand)\.naver\.com/i.test(s) ? "naver" : /ohou\.se/i.test(s) ? "ohou" : ""; };
  const paintSites = () => { const s = siteOfText($("dtUrl").value), k = s === "tmall" ? "taobao" : s; $("dtSites").querySelectorAll("[data-site]").forEach((el) => el.classList.toggle("on", el.dataset.site === k)); $("dtSites").classList.toggle("has", !!k); };
  $("dtUrl").addEventListener("input", paintSites);
  async function fromUrl(url, rowId = null) {
    if (urlBusy) return;
    const msg = $("dtUrlMsg"), btn = $("dtUrlGo");
    const site = siteOfText(url), where = site && site !== "1688" ? SITE_KO[site] : "1688"; // 1688 은 예전 문구 그대로
    urlBusy = true; btn.disabled = true; btn.textContent = `⠋ ${where}에서 읽는 중…`;
    msg.className = "dt-urlmsg busy"; msg.textContent = where === "1688" ? "1688 탭에서 상품 화면을 열고 제목·속성표·상세 이미지를 읽는 중입니다 (10~30초)" : `${where} 상품 화면을 열고 제목·옵션·상세 이미지를 읽는 중입니다 (20~60초)`;
    const spin = setInterval(() => { btn.textContent = `${SPIN[Math.floor(performance.now() / 80) % SPIN.length]} ${where}에서 읽는 중…`; }, 80);
    try {
      const r = await api.invoke("detail:fromUrl", { url, rowId, templateId: st.tpl });
      if (r?.ok) { msg.className = "dt-urlmsg ok"; msg.textContent = `✔ 읽었습니다 — 상세페이지를 만드는 중 (작업 ${r.jobId})`; $("dtUrl").value = ""; paintSites(); }
      else {
        msg.className = "dt-urlmsg err"; msg.textContent = "✕ " + (r?.error || "만들지 못했습니다");
        if (r?.needVisible) { // 네이버·오늘의집 로그인·보안 확인 → 같은 세션의 보이는 창에서 사람이 넘긴다
          const vb = document.createElement("button"); vb.type = "button"; vb.className = "sec dt-urlvis"; vb.textContent = "보이는 창으로 열기";
          vb.onclick = async () => { const o = await api.invoke("detail:openVisible", { url }); if (o?.error) flash(o.error); else { msg.className = "dt-urlmsg busy"; msg.textContent = "열린 창에서 로그인·확인을 마친 뒤 ▶ 주소로 만들기를 다시 누르세요"; $("dtUrl").value = url; paintSites(); } };
          msg.append(" ", vb);
        }
      }
    } catch (e) { msg.className = "dt-urlmsg err"; msg.textContent = "✕ " + String(e?.message || e).replace(/^Error invoking remote method '[^']+': /, "").slice(0, 160); }
    clearInterval(spin); urlBusy = false; btn.disabled = false; btn.textContent = "▶ 주소로 만들기";
  }
  $("dtUrlForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("dtUrl").value.trim(); if (!v) { $("dtUrl").focus(); return; } fromUrl(v); });
  function flash(msg) { const g = $("dtGuide"); g.textContent = msg; g.classList.add("hot"); setTimeout(() => g.classList.remove("hot"), 2500); }
  function setMode(m) { st.mode = m; root.classList.toggle("dt-mresult", m === "result"); if (m !== "result") root.classList.remove("dt-listopen"); { const g = $("dtRowsGrp"); if (g) g.hidden = m === "result" || !st.rows.length; } $("dtSetup").hidden = m !== "setup"; $("dtWork").hidden = m !== "work"; $("dtResult").hidden = m !== "result"; $("dtReview").hidden = m !== "review"; $("dtInfoV").hidden = m !== "info"; if (m !== "work") stopWork(); else startWorkLoop(); }
  // ---------- 설정(확인 단계·발표 모드 자동) ----------
  async function loadOpts() { const o = await api.invoke("detail:settings", null).catch(() => null); if (!o) return; $("dtOptReview").checked = o.detailReview === true; $("dtOptPresentAuto").checked = o.detailPresentAuto !== false; $("dtKeyModel").value = o.geminiImageModel || "gemini-2.5-flash-image"; $("dtKeyState").textContent = o.imageGen?.connected ? `✔ 이미지 생성: ${o.imageGen.provider === "vertex" ? `Vertex(프로젝트 ${o.imageGen.project || "?"})` : o.imageGen.provider === "server" ? "씨드핵 서버" : o.imageGen.provider} 연결됨${o.hasGeminiKey ? ` · Gemini 키 ${o.geminiKeyHint || ""}` : ""}` : "이미지 생성: 키 없음 — AI 장면 사진 단계 건너뜀"; loadUsage(); }
  // 🎨 이미지 생성 사용량(받은 장만 · 비용은 토큰 수 × 공개 단가로 낸 예상)
  async function loadUsage() {
    const u = await api.invoke("detail:imageUsage").catch(() => null); if (!u) return;
    const won = (n) => `₩${Math.round(n).toLocaleString("ko-KR")}`;
    $("dtUsage").hidden = !u.all.n && !$("dtKeyState").textContent.startsWith("✔");
    $("uToday").textContent = `${u.today.n}장`; $("uMonth").textContent = `${u.month.n}장`; $("uCost").textContent = won(u.month.krw);
    const max = Math.max(1, ...u.week.map((d) => d.n));
    $("uWeek").innerHTML = u.week.map((d) => `<div data-tip="${d.day} · ${d.n}장 · ${won(d.usd * u.krwPerUsd)}"><i style="height:${Math.round((d.n / max) * 100)}%"></i><span>${d.day.slice(8)}</span></div>`).join("");
    $("uModels").textContent = Object.entries(u.models).map(([m, n]) => `${m} ${n}장`).join(" · ") || "이번 달 기록 없음";
    $("uNote").textContent = `$1 = ₩${u.krwPerUsd.toLocaleString("ko-KR")} 기준 예상치 · 정확한 금액은 💳 실제 청구`;
  }
  $("uBill").onclick = () => api.invoke("detail:openBilling").catch(() => {});
  let usageT = 0; api.on("detail:progress", () => { if (!usageT) usageT = setTimeout(() => { usageT = 0; loadUsage(); }, 1500); }); // 만드는 중에도 숫자가 올라가게(1.5초에 한 번)
  $("dtKeySave").onclick = async () => { const k = $("dtKey").value; const o = await api.invoke("detail:settings", { ...(k ? { geminiKey: k } : {}), geminiImageModel: $("dtKeyModel").value }).catch(() => null); $("dtKey").value = ""; if (o) $("dtKeyState").textContent = o.hasGeminiKey ? `✔ 키 저장됨 ${o.geminiKeyHint || ""}` : "키 없음 — AI 장면 사진 단계 건너뜀"; };
  // 🔗 내 구글 클라우드(수강생 무료 체험) — main/detail/google-ipc.js
  function showGc(g) {
    if (!g) return;
    $("dtGcState").textContent = g.connected ? `✔ 연결됨 · ${g.project || "프로젝트 ?"}${g.keyHint ? ` · ${g.keyHint}` : ""}` : g.dev ? "개발 PC(gcloud) 사용 중" : "연결 안 됨 — 연결하면 내 무료 체험 크레딧으로 AI 를 씁니다";
    $("dtGcState").className = g.connected ? "on" : "";
    const t = g.trial; $("dtGcTrial").textContent = t ? (t.ended ? "무료 체험 기간(90일)이 끝났을 수 있어요 — 남은 크레딧을 확인하세요" : `무료 체험 약 ${t.daysLeft}일 남음(연결한 날 기준)`) : "";
    const c = g.checks || {};
    $("dtGcChecks").innerHTML = g.connected ? ["text", "image", "ocr"].map((k) => c[k] ? `<li class="${c[k].ok ? "ok" : "bad"}">${c[k].ok ? "✔" : "✕"} ${esc(c[k].msg)}</li>` : "").join("") : "";
    if (g.error) flash(g.error);
  }
  api.invoke("detail:google:get").then(showGc).catch(() => {});
  $("dtGcSave").onclick = async () => { $("dtGcState").textContent = "연결 확인 중…"; const g = await api.invoke("detail:google:set", { kind: "apikey", apiKey: $("dtGcKey").value, project: $("dtGcProj").value }).catch((e) => ({ error: String(e) })); $("dtGcKey").value = ""; if (g?.error && !g.connected) { flash(g.error); api.invoke("detail:google:get").then(showGc); return; } showGc(g); loadOpts(); };
  const gcFile = async (f) => { if (!f) return; $("dtGcState").textContent = "연결 확인 중…"; const g = await api.invoke("detail:google:set", { kind: "sa", json: await f.text() }).catch((e) => ({ error: String(e) })); if (g?.error && !g.connected) { flash(g.error); api.invoke("detail:google:get").then(showGc); return; } showGc(g); loadOpts(); };
  $("dtGcFile").onchange = (e) => gcFile(e.target.files?.[0]);
  $("dtGc").addEventListener("dragover", (e) => e.preventDefault());
  $("dtGc").addEventListener("drop", (e) => { e.preventDefault(); gcFile(e.dataTransfer.files?.[0]); });
  $("dtGcTest").onclick = async () => { $("dtGcState").textContent = "확인 중…"; showGc(await api.invoke("detail:google:test").catch(() => null)); };
  $("dtGcClear").onclick = async () => { showGc(await api.invoke("detail:google:clear").catch(() => null)); loadOpts(); };
  root.querySelectorAll("[data-gc]").forEach((b) => { b.onclick = () => api.invoke("detail:google:open", { what: b.dataset.gc }); });
  $("dtKeyClear").onclick = async () => { const o = await api.invoke("detail:settings", { geminiKey: "" }).catch(() => null); $("dtKey").value = ""; if (o) $("dtKeyState").textContent = "키 없음 — AI 장면 사진 단계 건너뜀"; };
  $("dtKeyModel").onchange = () => api.invoke("detail:settings", { geminiImageModel: $("dtKeyModel").value }).catch(() => {});
  $("dtOptReview").onchange = () => api.invoke("detail:settings", { detailReview: $("dtOptReview").checked }).catch(() => {});
  $("dtOptPresentAuto").onchange = () => api.invoke("detail:settings", { detailPresentAuto: $("dtOptPresentAuto").checked }).catch(() => {});
  const reviewFlag = () => ($("dtOptReview").checked && !(document.body.classList.contains("present") && $("dtOptPresentAuto").checked) ? undefined : false); // undefined = 설정 그대로, false = 끔

  // ---------- 확인 화면(review): plan 보여 주고 사진 교체·글 수정 → 이대로 렌더 ----------
  const rv = { jobId: null, plan: null, photos: [], pickFor: null };
  async function openReview(jobId) {
    const r = await api.invoke("detail:plan:get", { jobId });
    if (!r || r.error) { flash(r?.error || "구성을 읽지 못했습니다"); return; }
    rv.jobId = r.jobId; rv.plan = r.plan; rv.photos = r.photos || []; rv.dir = r.dir; rv.url = r.url || "";
    $("rvSrc").hidden = !rv.url; $("rvSrc").textContent = `🔗 원본 ${rv.url.replace(/^https?:\/\//, "").slice(0, 48)}`;
    renderReview(); setMode("review");
  }
  const photoUrl = (rel) => (rel ? fileUrl(rv.dir + "/" + rel) : "");
  function renderReview() {
    const secs = rv.plan.sections;
    $("rvInfo").textContent = `섹션 ${secs.length}개 · 사진 후보 ${rv.photos.filter((p) => p.usable).length}장 · 템플릿 ${rv.plan.meta?.templateId || ""}`;
    $("rvList").innerHTML = secs.map((sec, i) => {
      const img = sec.image ? `<img src="${esc(photoUrl(sec.image))}" data-pick="${i}" title="누르면 다른 사진으로">` : sec.images?.length ? `<span class="gal">${sec.images.slice(0, 4).map((f) => `<img src="${esc(photoUrl(f))}">`).join("")}</span>` : `<span class="noimg">사진 없음</span>`;
      const texts = [["headline", sec.headline], ["sub", sec.sub], ["title", sec.title], ["desc", sec.desc], ["note", sec.note]].filter(([, v]) => typeof v === "string").map(([k, v]) => `<div class="tx" contenteditable="true" data-sec="${i}" data-k="${k}" spellcheck="false">${esc(v)}</div>`).join("");
      const items = Array.isArray(sec.items) && sec.items.length ? `<small>${sec.items.slice(0, 4).map((it) => esc(typeof it === "string" ? it : it.title || it.text || it.q || "")).join(" · ")}${sec.items.length > 4 ? " …" : ""}</small>` : "";
      return `<li data-i="${i}"><em>${esc(sec.id || i + 1)}</em><b>${esc(sec.type)}</b>${img}<div class="txs">${texts}${items}</div><button class="sec del" type="button" data-del="${i}" title="이 섹션 빼기">✕</button></li>`;
    }).join("");
  }
  $("rvList").addEventListener("input", (e) => { const t = e.target.closest("[data-sec]"); if (!t) return; rv.plan.sections[+t.dataset.sec][t.dataset.k] = t.textContent.slice(0, 300); });
  $("rvList").addEventListener("click", (e) => {
    const d = e.target.closest("[data-del]"); if (d) { const i = +d.dataset.del; if (["hero", "cta"].includes(rv.plan.sections[i]?.type)) return flash("첫 화면과 마지막 안내는 뺄 수 없습니다"); rv.plan.sections.splice(i, 1); renderReview(); return; }
    const p = e.target.closest("[data-pick]"); if (!p) return;
    rv.pickFor = +p.dataset.pick;
    const used = new Set(rv.plan.sections.flatMap((s) => [s.image, ...(s.images || [])]).filter(Boolean));
    $("rvPhotos").innerHTML = rv.photos.filter((ph) => ph.usable || ph.file === rv.plan.sections[rv.pickFor].image).map((ph) => `<button type="button" data-file="${esc(ph.file)}" class="${used.has(ph.file) ? "used" : ""}${rv.plan.sections[rv.pickFor].image === ph.file ? " on" : ""}"><img src="${esc(fileUrl(ph.path))}" alt=""><span>${esc(ph.id)}${ph.score != null ? ` · ${ph.score}점` : ""}${ph.role ? ` · ${esc(ph.role)}` : ""}</span><small>${esc(ph.shows || "")}</small></button>`).join("") || `<p class="dt-empty">바꿀 수 있는 사진이 없습니다.</p>`;
    $("rvPick").hidden = false;
  });
  $("rvPhotos").addEventListener("click", (e) => { const b = e.target.closest("[data-file]"); if (!b || rv.pickFor == null) return; rv.plan.sections[rv.pickFor].image = b.dataset.file; $("rvPick").hidden = true; renderReview(); });
  $("rvPickClose").onclick = () => { $("rvPick").hidden = true; };
  async function reviewDone(save) {
    if (save) { const r = await api.invoke("detail:plan:set", { jobId: rv.jobId, plan: { sections: rv.plan.sections } }); if (r?.error) { flash(r.error); return; } }
    const c = await api.invoke("detail:continue", { jobId: rv.jobId });
    if (c?.error) flash(c.error);
    setMode("work");
  }
  $("rvGo").onclick = () => reviewDone(true);
  $("rvSrc").onclick = (e) => { e.preventDefault(); if (rv.url) api.invoke("detail:openSource", { url: rv.url }).then((r) => r?.error && flash(r.error)); };
  $("rvSkip").onclick = () => reviewDone(false);

  // ---------- AI 작업 화면 ----------
  // RAF 한 번에: 점(...)·스피너·경과 시간·진행률 보간. 이벤트가 없는 동안에도 진행률은 그 단계 구간 안에서 천천히 다가간다(단계 상한은 넘지 않음)
  const RANGE = { extract: [0, 3], download: [3, 17], ocr: [17, 30], clean: [30, 38], vision: [38, 46], cutout: [46, 50], translate: [50, 52], brief: [52, 56], copy: [56, 61], scene: [61, 72], plan: [72, 74], review: [74, 76], render: [76, 88], qa: [88, 99], done: [100, 100] };
  let raf = 0;
  function startWorkLoop() {
    cancelAnimationFrame(raf);
    const w = st.work; if (!w) return;
    const frame = (now) => {
      if (st.mode !== "work" || st.work !== w) return;
      const dots = root.querySelector(".dt-title .dots"); if (dots) dots.textContent = ".".repeat(3 - (Math.floor(now / 450) % 3));
      $("dwSp").textContent = SPIN[Math.floor(now / 80) % SPIN.length];
      $("dwMs").textContent = ((performance.now() - w.tEvent) / 1000).toFixed(2) + "s";
      if (!w.finished) {
        const [, hi] = RANGE[w.step] || [w.pct, w.pct];
        const creep = reduce() ? w.pct : Math.max(w.pct, Math.min(hi - 0.5, w.pct + (hi - w.pct) * (1 - Math.exp(-(performance.now() - w.tEvent) / 7000))));
        w.shown += (creep - w.shown) * (reduce() ? 1 : 0.1);
        if (Math.abs(creep - w.shown) < 0.05) w.shown = creep;
        $("dwPct").textContent = Math.floor(w.shown) + "%"; $("dwBar").style.width = w.shown + "%";
        // 순환 부제 2.4초마다
        const subs = SUBS[w.step] || [STEP_KO[w.step] || w.step];
        const k = Math.floor((performance.now() - w.tStep) / 2400) % subs.length;
        const el = $("dwSub"); if (el.textContent !== subs[k]) { el.textContent = subs[k]; el.classList.remove("up"); void el.offsetWidth; el.classList.add("up"); }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }
  function stopWork() { cancelAnimationFrame(raf); raf = 0; }
  function line(cls, html) {
    const logEl = $("dwLog"); const p = document.createElement("p"); p.className = cls || ""; p.innerHTML = `<span class="t">[${clock()}]</span> ${html}`;
    logEl.appendChild(p); while (logEl.childElementCount > 12) logEl.firstChild.remove();
  }
  function newWork(jobId, title) {
    root.querySelectorAll(".dt-done").forEach((d) => d.remove());
    st.work = { jobId, title: title || "", step: "extract", pct: 0, shown: 0, tEvent: performance.now(), tStep: performance.now(), t0: performance.now(), finished: false, cells: new Map(), total: 0 };
    $("dwTitle").querySelector("span").textContent = title || jobId;
    $("dwLog").innerHTML = ""; $("dwGrid").innerHTML = ""; $("dwFound").innerHTML = "이미지 <b>0</b>장"; $("dwPct").textContent = "0%"; $("dwBar").style.width = "0";
    $("dwLive").textContent = "엔진 준비 중"; $("dwSub").textContent = SUBS.extract[0];
    root.querySelectorAll("#dwSteps li").forEach((li) => { li.className = ""; li.querySelector("small").textContent = ""; });
    line("sys", `AI Detail Engine 시작 · 작업 <b>${esc(jobId)}</b>`);
    setMode("work");
  }
  function ensureCells(n) {
    const w = st.work, g = $("dwGrid"); if (!w || n <= w.total) return;
    for (let i = w.total; i < n; i++) { const c = document.createElement("div"); c.className = "cell"; c.innerHTML = `<i></i><b></b>`; c.style.animationDelay = `${(i % 12) * 30}ms`; g.appendChild(c); }
    w.total = n; $("dwFound").innerHTML = `이미지 <b>${n}</b>장`;
  }
  function cellOf(id, done) { // id 순서를 모르면 done 번째 칸
    const w = st.work; if (!w) return null;
    if (id && w.cells.has(id)) return w.cells.get(id);
    const cells = [...$("dwGrid").children];
    const free = cells.find((c) => !c.dataset.id) || cells[Math.min(cells.length - 1, Math.max(0, (done || 1) - 1))];
    if (free && id) { free.dataset.id = id; w.cells.set(id, free); }
    return free;
  }
  function onProgress(ev) {
    if (!ev || !ev.jobId) return;
    if (ev.bg) { // 뒤에서 빠진 장면 채우기 — 진행 화면으로 넘어가지 않고 알림만
      navRun(ev.pct, !(ev.step === "done" || ev.step === "fail"));
      if (ev.step === "done") { toast("🎨 빠진 섹션 장면을 채워 새 렌더 탭을 만들었어요"); if (st.mode === "result" && st.lastResult?.jobId === ev.jobId) showResult(ev.jobId); load(); }
      if (ev.step === "fail") toast(`△ 빠진 장면 채우기 실패 · ${ev.msg}`);
      return;
    }
    navRun(ev.pct, !(ev.step === "done" || ev.step === "fail"));
    if (!st.work || st.work.jobId !== ev.jobId) { if (ev.step === "fail" || ev.step === "done") return; newWork(ev.jobId, ev.extra?.title); }
    const w = st.work; const x = ev.extra || {};
    if (st.mode !== "work" && !w.finished) setMode("work");
    if (ev.step !== w.step) { w.tStep = performance.now(); }
    w.tEvent = performance.now();
    if (ev.step !== "fail") { w.step = ev.step; w.pct = Math.max(w.pct, ev.pct || 0); }
    if (x.title) { w.title = x.title; $("dwTitle").querySelector("span").textContent = x.title; }
    // 단계 체크 목록
    const idx = STEPS.indexOf(ev.step);
    const gi = ev.step === "done" ? GROUPS.length : groupOf(ev.step === "fail" ? w.step : ev.step), gw = groupOf(w.step);
    root.querySelectorAll("#dwSteps li").forEach((li, i) => { li.className = ev.step === "fail" ? (i < gw ? "done" : i === gw ? "fail" : "") : i < gi ? "done" : i === gi ? "now" : ""; });
    if (idx >= 0 && ev.step !== "done") { const sm = root.querySelector(`#dwSteps li[data-step="${GROUPS[gi]?.id}"] small`); if (sm) sm.textContent = x.total ? `${STEP_KO[ev.step] || ""} ${x.done}/${x.total}` : (STEP_KO[ev.step] || ""); }
    // 이미지 격자: extract(개수) → download(점등·썸네일) → ocr(글자 수) → clean(지운 썸네일)
    if (ev.step === "extract" && x.gallery != null) ensureCells((x.gallery || 0) + (x.detail || 0));
    if (ev.step === "download" && x.total) { ensureCells(x.total); if (x.id) { const c = cellOf(x.id, x.done); if (c) c.classList.add("dl"); } if (x.files) x.files.forEach((f) => { const c = cellOf(f.id); if (c) { c.classList.add("dl"); if (!c.querySelector("img")) { const im = new Image(); im.src = fileUrl(f.file); im.alt = ""; c.prepend(im); } } }); }
    if (ev.step === "ocr" && x.id) { const c = cellOf(x.id, x.done); if (c) { c.classList.add("ocr"); if (x.boxes != null) c.querySelector("b").textContent = x.boxes ? `字${x.boxes}` : "·"; } }
    if (ev.step === "clean" && x.id) { const c = cellOf(x.id, x.done); if (c) { c.classList.add("clean"); if (x.thumb) { const im = c.querySelector("img") || c.insertBefore(new Image(), c.firstChild); im.src = fileUrl(x.thumb) + "?t=" + Date.now(); } if (x.erased != null) c.querySelector("b").textContent = x.erased ? `🧹${x.erased}` : c.querySelector("b").textContent; } }
    if (x.sceneThumb) { const g = $("dwGrid"); const c = document.createElement("div"); c.className = "cell scene rd"; c.title = x.sectionId || ""; const im = new Image(); im.src = fileUrl(x.sceneThumb); c.appendChild(im); const b = document.createElement("b"); b.textContent = String(x.sectionId || "").replace(/^v5-\d+-/, ""); c.appendChild(b); g.prepend(c); }
    if (ev.step === "render" && x.total) { root.querySelectorAll("#dwGrid .cell").forEach((c, i) => { if (i / w.total <= x.done / x.total) c.classList.add("rd"); }); }
    // 터미널 한 줄 + live
    const cls = ev.step === "fail" ? "stop" : /^✔|^■/.test(ev.msg) ? "go" : /실패|없음|△/.test(ev.msg) ? "warn" : "";
    line(cls, esc(ev.msg));
    $("dwLive").textContent = ev.msg.replace(/^[✔■↓字🧹🌐🖼]\s*/, "").slice(0, 90);
    if (ev.step === "review" && x.waiting) openReview(ev.jobId);
    if (ev.step === "review" && x.waiting === false && st.mode === "review") setMode("work");
    if (ev.step === "done" && x.prepared) { prepared(ev); return; }
    if (ev.step === "done") finish(ev);
    if (ev.step === "fail") failed(ev);
  }
  function finish(ev) {
    const w = st.work; w.finished = true; w.pct = 100; w.shown = 100;
    $("dwPct").textContent = "100%"; $("dwBar").style.width = "100%"; $("dwSub").textContent = "완료";
    root.querySelectorAll("#dwSteps li").forEach((li) => (li.className = "done"));
    root.querySelectorAll("#dwGrid .cell").forEach((c) => c.classList.add("rd"));
    const box = document.createElement("div"); box.className = "dt-done";
    const secs = ((ev.extra?.durationMs || 0) / 1000).toFixed(1);
    const tm = ev.extra?.timings ? Object.entries(ev.extra.timings).filter(([, ms]) => ms >= 500).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, ms]) => `${STEP_KO[k] || k} ${(ms / 1000).toFixed(0)}초`).join(" · ") : "";
    box.innerHTML = `<div class="dt-check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><h3>상세페이지 완성!</h3><p>${esc(w.title)} · 이미지 ${ev.extra?.slices ?? "?"}장 · ${secs}초</p>${tm ? `<p class="dt-tm">⏱ ${esc(tm)}</p>` : ""}<small>클릭하면 바로 결과로</small>`;
    $("dtWork").querySelector(".dt-win").appendChild(box);
    if (!reduce()) sparks(box);
    const go = () => { clearTimeout(t); showResult(w.jobId); };
    const t = setTimeout(go, reduce() ? 300 : 1700);
    box.onclick = go;
    load();
  }
  function failed(ev) {
    const w = st.work; w.finished = true;
    const cancelled = !!ev.extra?.cancelled;
    const box = document.createElement("div"); box.className = "dt-done fail";
    box.innerHTML = `<div class="dt-check"><svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg></div><h3>${cancelled ? "취소했습니다" : "만들지 못했습니다"}</h3><p>${esc(ev.msg)}</p><small>클릭하면 닫힙니다</small>`;
    $("dtWork").querySelector(".dt-win").appendChild(box);
    const back = () => { clearTimeout(t); st.work = null; setMode("setup"); load(); };
    const t = setTimeout(back, 6000);
    box.onclick = back;
  }
  function sparks(box) {
    const cols = ["#3ddc84", "#a6ffcf", "#5ccfe6", "#ffcc4d"];
    const r = box.getBoundingClientRect(), cx = r.width / 2, cy = r.height / 2 - 60;
    for (let k = 0; k < 28; k++) {
      const s = document.createElement("i"); s.className = "dt-spark"; s.style.cssText = `left:${cx}px;top:${cy}px;background:${cols[k % cols.length]}`; box.appendChild(s);
      const a = (k / 28) * Math.PI * 2, d = 70 + Math.random() * 100;
      s.animate([{ transform: "translate(0,0) scale(1)", opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d}px) scale(.3)`, opacity: 0 }], { duration: 700 + Math.random() * 400, easing: "cubic-bezier(.1,.8,.3,1)", fill: "forwards" });
    }
  }
  $("dwCancel").onclick = async () => { if (!st.work) return; $("dwCancel").disabled = true; $("dwCancel").textContent = "취소하는 중…"; await api.invoke("detail:cancel", { jobId: st.work.jobId }); setTimeout(() => { $("dwCancel").disabled = false; $("dwCancel").textContent = "✕ 취소"; }, 1500); };

  // ---------- 결과 화면 ----------
  async function showResult(jobId, renderId, { keepScroll = false } = {}) {
    const sc0 = keepScroll ? { r: root.querySelector(".dt-result")?.scrollTop || 0, s: $("drSlices").scrollTop || 0 } : null; // 뒤 검수가 고친 장을 바꿔 끼울 때 보던 자리 그대로
    const r = await api.invoke("detail:get", { jobId, renderId });
    if (!r || r.error || r.status === "running") { if (r?.error) flash(r.error); return; }
    st.lastResult = r; st.work = null; root.dataset.job = jobId; root.dispatchEvent(new CustomEvent("dt:result", { detail: { jobId } })); // 🖼 썸네일(thumb.js)이 지금 작업을 안다
    const tall = (r.slices || []).reduce((n, s) => n + (s.h || 0), 0);
    $("drTitle").textContent = r.title || jobId;
    loadSections(jobId);
    // 단계별 시간
    const TK = { total: "전체", vision: "사진 검수", cutout: "누끼", brief: "기획", copy: "카피", sceneGen: "장면 생성(카피와 동시)", scene: "장면 마무리 대기", plan: "구성", render: "렌더", qa: "검수", qaBackground: "뒤 검수" };
    const tm = r.timings ? Object.entries(r.timings).filter(([k, ms]) => TK[k] && ms >= 500).map(([k, ms]) => `${TK[k]} ${(ms / 1000).toFixed(0)}초`).join(" · ") : "";
    $("drTimes").textContent = tm ? `⏱ ${tm}` : ""; $("drTimes").hidden = !tm;
    // AI 검수 제안(뒤 검수) — 누르면 그 섹션 다시 만들기/글 수정
    const sugg = (r.qa?.suggestions || []).filter((x) => !x.applied);
    $("drQa").hidden = !r.qa?.background; 
    if (r.qa?.background) $("drQa").innerHTML = `<b>🤖 AI 검수 ${r.qa.score}/5 · 제안 ${sugg.length}건</b>${sugg.length ? ` <button type="button" class="sec" id="drQaToggle">반영하기 ▾</button>` : " — 고칠 곳 없음"}<ul id="drQaList" hidden>${sugg.map((x) => `<li><span>[${esc(x.section)}] ${esc(x.what)}</span><button type="button" class="sec" data-qa="${x.i}">${x.action === "rewrite" ? "✍ 글 다시" : x.action === "drop" ? "🗑 섹션 빼기" : "↻ 장면 다시"}</button></li>`).join("")}</ul>`;
    const tg = $("drQaToggle"); if (tg) tg.onclick = () => { $("drQaList").hidden = !$("drQaList").hidden; }; if ((r.renders || []).find((x) => x.id === r.current)?.width === 860) $("exW").value = "860";
    // 원본 1688 주소
    $("drSrc").hidden = !r.url; $("drSrcUrl").textContent = r.url || ""; $("drSrcUrl").dataset.url = r.url || "";
    // 렌더 탭(템플릿별 보관) — 누르면 그 렌더, 각 탭에 폴더·피그마·HTML·삭제(두 번 눌러 확인)
    const tplName = (id) => (st.tpls.find((t) => t.id === id)?.name || id);
    $("drTabs").innerHTML = (r.renders || []).slice().reverse().map((x) => `<div class="dt-rtab${x.id === r.current ? " on" : ""}" data-rid="${esc(x.id)}">
      <span class="tt" data-tip="${esc(x.id)} · ${x.sliceCount || x.slices?.length || 0}장${x.qa != null ? ` · 검수 ${x.qa}/5` : ""}"><b>${esc((x.label && /한글화/.test(x.label)) || x.templateId === "localize" ? "원본 한글화" : x.theme ? `카드 · ${x.templateRef ? `🧲 ${themeName(x.templateRef)}` : themeName(x.theme)}` : tplName(x.templateId))}</b><small>${x.createdAt ? new Date(x.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "이전"}</small></span>
      <span class="acts"><button type="button" data-act="folder" data-tip="📂 이 렌더 폴더 열기">📂</button><button type="button" data-act="figma" data-tip="🎨 이 렌더 피그마 묶음 저장">🎨</button><button type="button" data-act="html" data-tip="🌐 이 렌더 HTML로 보기">🌐</button><button type="button" data-act="del" data-tip="🗑 이 렌더 삭제 — 두 번 눌러 확인">🗑</button></span></div>`).join("");
    $("drMeta").textContent = `템플릿 ${r.templateId} · 이미지 ${r.slices?.length || 0}장(세로 ${tall.toLocaleString("ko-KR")}px) · 원본 ${r.counts?.images ?? "-"}장 · ${((r.durationMs || 0) / 1000).toFixed(0)}초${r.costUsd != null ? ` · $${Number(r.costUsd).toFixed(3)}` : ""}`;
    const how = r.how || {};
    const notes = Object.entries(how).filter(([, v]) => ["lite", "copy", "none", "failed"].includes(v)).map(([k, v]) => `${STEP_KO[k] || k}: ${HOW_KO[v] || v}`);
    $("drHow").textContent = notes.length ? `△ 대체 동작으로 처리한 단계 — ${notes.join(" · ")}` : `✔ 모든 단계 정상 (OCR ${HOW_KO[how.ocr] || how.ocr || "-"} · 카피 ${HOW_KO[how.copy] || how.copy || "-"})`;
    $("drHow").className = "dt-rhow" + (notes.length ? " warn" : "");
    if (r.scene?.used) $("drHow").textContent += ` · 🎨 AI 생성 이미지 ${r.scene.used}장 사용 — 제품 모양이 실제와 같은지 확인하세요`;
    if (r.aiNotice) { $("drHow").textContent = `⚠ ${r.aiNotice} · ${$("drHow").textContent}`; $("drHow").classList.add("warn"); } // 서버 AI 한도·로그인 등(relay.js) — 그 단계는 AI 없이 만들었다
    if (r.qa) { const ang = r.brief ? String(r.brief.angle || r.brief.audience || "").trim() : ""; const qp = [r.qa.score != null ? `🤖 AI 검수 ${r.qa.score}/5` : "", r.qa.fixed != null ? `고친 것 ${r.qa.fixed}건` : "", r.qa.rounds != null ? `${r.qa.rounds}회차` : "", r.qa.remaining ? `남은 지적 ${r.qa.remaining}건: ${(r.qa.defects || []).slice(0, 2).map((d) => d.what).join(" / ")}` : "", ang ? `기획 "${ang}"` : ""].filter(Boolean); $("drHow").textContent = `${qp.join(" · ")} — ${$("drHow").textContent}`; $("drHow").className = "dt-rhow" + (r.qa.score >= 4 && !r.scene?.used ? "" : " warn"); }
    $("drSlices").innerHTML = (r.slicePaths || []).map((p, i) => `<figure><img src="${esc(fileUrl(p))}?t=${Date.now()}" alt="" loading="lazy"><figcaption>${esc(r.slices?.[i]?.file || "")} · ${r.slices?.[i]?.w || ""}×${r.slices?.[i]?.h || ""}</figcaption></figure>`).join("") || `<p class="dt-empty">이미지가 없습니다.</p>`;
    $("drTplPick").hidden = true;
    // 한 줄 요약(AI 검수 · 시간 · 확인할 것) — 누르면 검수 제안·단계별 시간·처리 내역 펼침
    const totalS = Math.round(((r.timings?.total) || r.durationMs || 0) / 1000);
    const lq = (r.renders || []).find((x) => x.id === r.current)?.locQa; // 원본 한글화 탭: 뒤 검수 결과를 맨 앞에
    const lqPart = lq?.status === "running" ? "🔍 검수 중…" : lq?.status === "done" ? [lq.flagged ? `⚠ 확인 필요 ${lq.flagged}장` : `✔ 검수 통과 ${lq.checked}장`, lq.fixed ? `🔧 자동으로 고침 ${lq.fixed}장` : ""].filter(Boolean).join(" · ") : "";
    const sumParts = [lqPart, r.qa?.score != null && !lq ? `🤖 AI 검수 ${r.qa.score}/5${sugg.length ? ` · 제안 ${sugg.length}건` : ""}` : "", totalS ? `⏱ ${totalS}초` : "", r.scene?.used ? `⚠ AI 생성 이미지 ${r.scene.used}장 확인` : "", notes.length ? `△ 대체 동작 ${notes.length}단계` : ""].filter(Boolean);
    $("drSum").innerHTML = `<span>${esc(sumParts.join(" · ") || "✔ 모든 단계 정상")}</span><em>${$("drSumBody").hidden ? "자세히 ▾" : "접기 ▴"}</em>`;
    $("drSum").classList.toggle("warn", !!(r.scene?.used || notes.length || (r.qa?.score != null && r.qa.score < 4 && !lq) || lq?.flagged));
    setMode("result");
    $("drSlices").scrollTop = sc0 ? sc0.s : 0; root.querySelector(".dt-result").scrollTop = sc0 ? sc0.r : 0;
  }
  $("drFolder").onclick = () => st.lastResult && api.invoke("detail:open", { jobId: st.lastResult.jobId, what: "folder", renderId: st.lastResult.current });
  $("drFigma").onclick = () => st.lastResult && api.invoke("detail:open", { jobId: st.lastResult.jobId, what: "figma", renderId: st.lastResult.current });
  $("drHtml").onclick = () => st.lastResult && api.invoke("detail:open", { jobId: st.lastResult.jobId, what: "html", renderId: st.lastResult.current });
  // ---- v5 섹션 편집 ----
  const se = { list: [], cur: null };
  async function loadSections(jobId) {
    // 카드(v5) 결과가 아닌 탭(원본 한글화 등): 목록 = 그 탭에 실제로 그려진 섹션(이동만, 글 편집은 카드 결과에서)
    const lr = st.lastResult, rd = (lr?.renders || []).find((x) => x.id === lr?.current) || {};
    se.view = rd.templateId && rd.templateId !== "card" ? "render" : "card";
    if (se.view === "render") {
      const RN = { hero: "대표", image: "원본 이미지", notice: "구매 전 확인", spec: "제품 정보", faq: "자주 묻는 질문" }; let im = 0;
      se.list = (rd.sections || []).map((x, i) => ({ id: `r${i}`, type: x.type, name: x.type === "image" ? `이미지 ${++im}` : RN[x.type] || x.type, texts: {}, fields: [], src: x.type === "image" ? "loc" : x.type === "hero" ? "orig" : "text" }));
      // 원본 한글화 앱 내 검수: 장별 결과(검수가 잰 장 위치 y)를 렌더 섹션 위치에 붙인다
      const qs = Object.entries(rd.locQa?.sections || {});
      se.list.forEach((x, i) => { const s = rd.sections[i], end = rd.sections[i + 1]?.y ?? Infinity; const hit = qs.find(([, q]) => q.y != null && q.y >= s.y - 5 && q.y < end - 5); if (hit) x.qa = { id: hit[0], ...hit[1] }; });
      $("drSecs").hidden = !se.list.length; $("drSedit").hidden = true; se.cur = null;
    } else {
    const r = await api.invoke("detail:sections:get", { jobId }).catch(() => null);
    $("drSecs").hidden = !r || r.error || !r.v5; if ($("drSecs").hidden) { $("drSedit").hidden = true; return; }
    se.list = r.sections;
    }
    const shots = secShots(se.list);
    const cnt = {}; se.list.forEach((x) => { const k = srcOf(x).k; cnt[k] = (cnt[k] || 0) + 1; });
    $("drSrcSum").innerHTML = Object.entries(SRC).filter(([k]) => cnt[k]).map(([k, v]) => `<span class="src-tag ${k}">${v} ${cnt[k]}</span>`).join("");
    paintLocQa(); paintLocRemoved(rd);
    $("drSecList").innerHTML = se.list.map((x, i) => `<li data-i="${i}" class="${se.cur === x.id ? "on" : ""}${x.qa && !x.qa.pass ? " qa-warn" : ""}"${se.qaOnly && !(x.qa && !x.qa.pass) ? " hidden" : ""}><span class="thumbw">${shots[i] || (x.image ? `<img src="${esc(fileUrl(x.image))}" alt="">` : `<span class="ph">${esc(x.type)}</span>`)}</span><span><b>${i + 1}. ${esc(x.name || x.type)}</b><i class="src-tag ${srcOf(x).k}">${srcOf(x).t}</i>${x.qa && !x.qa.pass ? `<em class="qa-tag warn" data-tip="${esc(x.qa.issues.map((q) => q.why).join(" · "))}">⚠ 확인 필요</em><small class="qa-why">${esc(x.qa.why)}</small>` : x.qa?.edited && x.qa.pass && x.qa.fixed ? `<em class="qa-tag ok" data-tip="⚠ 였던 장을 고쳐 다시 검수하니 문제가 없어요">✔ 고침 완료</em>` : x.qa?.fixed ? `<em class="qa-tag ok" data-tip="뒤 검수가 자동으로 고친 장">🔧 고침</em>` : ""}<small>${esc((x.texts.title || x.texts.name || x.texts.sub || "").slice(0, 16))}</small>${x.image ? `<span class="dt-logo${x.logo ? " on" : ""}" role="button" tabindex="0" data-logo="${i}" data-tip="사진에 다른 브랜드 로고가 있으면 켜세요 — 주요 섹션에서 뺍니다">${x.logo ? "로고 있음" : "로고?"}</span>` : ""}</span></li>`).join("");
    paintSrc();
    if (se.view === "render" && le.id) { const i = se.list.findIndex((x) => x.qa?.id === le.id); if (i >= 0) { le.i = i; root.querySelectorAll("#drSecList li").forEach((l) => l.classList.toggle("on", +l.dataset.i === i)); loadLocEdit(); } else closeLocEdit(); }
    else if (se.view !== "render") closeLocEdit();
  }
  // 사진 출처: 장면 생성(scene/) = AI 생성, 원본 사진(clean·raw) = 원본, 원본 한글화(localize/) = 원본 한글화, 사진 없음 = 글만
  const SRC = { orig: "원본", loc: "원본 한글화", ai: "AI 생성", text: "글만" };
  function srcOf(x) { const r = String(x.rel || "").replace(/\\/g, "/"); const k = x.src ? x.src : x.from === "scene" || /^scene\//.test(r) ? "ai" : !r ? "text" : /^localize\//.test(r) ? "loc" : "orig"; return { k, t: SRC[k] }; }
  // 미리보기 위 출처 표시: 섹션 위치(secShots 가 찾은 슬라이스·y)에 작은 꼬리표
  let srcOn = true; try { srcOn = localStorage.getItem("dtSrcOn") !== "0"; } catch {}
  function paintSrc() {
    const b = $("drSrcToggle"); if (b) { b.setAttribute("aria-pressed", String(srcOn)); b.classList.toggle("on", srcOn); }
    root.querySelectorAll("#drSlices .src-ov").forEach((e) => e.remove()); if (!srcOn) return;
    const figs = [...root.querySelectorAll("#drSlices figure")];
    (se.pos || []).forEach((p, i) => { const f = figs[p?.n]; const im = f?.querySelector("img"); const x = se.list[i]; if (!f || !im || !x) return; const o = srcOf(x); if (o.k === "text") return;
      const bad = x.qa && !x.qa.pass; const t = document.createElement("span"); t.className = `src-ov src-tag ${bad ? "qa-warn" : o.k}`; t.textContent = bad ? `⚠ ${i + 1}. ${x.qa.why}` : `${i + 1}. ${o.t}`; if (le.id && le.i === i) t.style.opacity = ".35"; t.style.top = `${Math.round(p.y / p.sh * im.clientHeight) + 8}px`; f.appendChild(t); });
  }
  $("drSrcToggle").onclick = () => { srcOn = !srcOn; try { localStorage.setItem("dtSrcOn", srcOn ? "1" : "0"); } catch {} paintSrc(); };
  window.addEventListener("resize", () => paintSrc());
  $("drSlices").addEventListener("load", (e) => { if (e.target.tagName === "IMG") { paintSrc(); if (le.id) paintLocMarks(); } }, true);
  // 섹션 썸네일 = 완성 화면에서 그 섹션 부분(글만 있는 섹션도 이미지로). 렌더의 섹션 위치(y,h)와 슬라이스 이미지로 잘라 보여 준다
  // 썸네일: 같은 크기 칸(SHOT_W×SHOT_H) 안에 그 섹션 전체를 축소해 가운데 놓는다(위만 잘리거나 납작해지지 않게)
  const SHOT_W = 96, SHOT_H = 120;
  function secShots(list) {
    const r = st.lastResult; const rd = (r?.renders || []).find((x) => x.id === r.current) || {};
    const rs = rd.sections || [], sl = r?.slices || [], paths = r?.slicePaths || []; if (!rs.length || !sl.length || sl.length !== paths.length) return [];
    const W = rd.width || sl[0].w || 780; let top = 0; const sy = sl.map((s) => { const y = top; top += s.h || 0; return y; }); const total = top;
    const out = []; let j = 0; se.pos = [];
    for (let i = 0; i < list.length; i++) {
      let m = -1; for (let t = j; t < rs.length; t++) if (rs[t].type === list[i].type) { m = t; break; } // 비어서 안 그려진 섹션은 건너뜀
      if (m < 0) continue; j = m + 1; const s = rs[m];
      const n = sy.findIndex((y, q) => s.y >= y && s.y < y + (sl[q].h || 0)); if (n < 0) continue;
      se.pos[i] = { n, y: s.y - sy[n], sh: sl[n].h || 1 };
      const end = Math.min(sy[n] + (sl[n].h || 0), s.h ? s.y + s.h : (rs[m + 1]?.y ?? total)); const hh = Math.max(1, end - s.y); // 높이 정보가 없으면 다음 섹션 시작까지, 슬라이스 밖은 자름
      const k = Math.min(SHOT_W / W, SHOT_H / hh), w = Math.round(W * k), h = Math.max(8, Math.round(hh * k));
      out[i] = `<span class="shot"><span style="width:${w}px;height:${h}px;background-image:url('${esc(fileUrl(paths[n]))}');background-size:${w}px auto;background-position:0 ${-Math.round((s.y - sy[n]) * k)}px" role="img" aria-label="${esc(list[i].type)} 섹션 화면"></span></span>`;
    }
    return out;
  }
  $("drSecList").addEventListener("click", async (e) => { const lg = e.target.closest("[data-logo]"); if (!lg) return; e.stopPropagation(); const x = se.list[+lg.dataset.logo]; if (!x?.rel && !x?.image) return; const on = !x.logo; lg.classList.toggle("on", on); lg.textContent = on ? "로고 있음" : "로고?"; const r = await api.invoke("detail:logo:set", { jobId: st.lastResult.jobId, renderId: st.lastResult.current, file: x.rel || x.image, on }); if (r?.error) flash(r.error); else toast(on ? "로고 있음 — 이 사진을 빼고 다시 구성합니다" : "로고 표시 해제 — 다시 구성합니다"); }, true);
  $("drSecList").addEventListener("click", (e) => { if (e.target.closest("[data-logo]")) return; const li = e.target.closest("[data-i]"); if (!li) return; const x = se.list[+li.dataset.i]; se.cur = x.id; if (se.view === "render") { root.querySelectorAll("#drSecList li").forEach((l) => l.classList.toggle("on", l === li)); goSec(+li.dataset.i); if (x.qa?.id) openLocEdit(+li.dataset.i); return; } openSedit(x); goSec(+li.dataset.i); loadSections(st.lastResult.jobId); });
  // 목록에서 고른 섹션으로 미리보기 이동(맨 위 고정 줄 아래에 오게) + 잠깐 테두리 표시
  function goSec(i) {
    const p = se.pos?.[i]; const f = p && root.querySelectorAll("#drSlices figure")[p.n]; const im = f?.querySelector("img"); if (!im) return;
    let sc = f.parentElement; while (sc && sc !== document.body && !(sc.scrollHeight > sc.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    const y = im.getBoundingClientRect().top + p.y / p.sh * im.clientHeight;
    const hd = root.querySelector(".dt-rhead")?.getBoundingClientRect().bottom || 0, gap = 12;
    const beh = reduce() ? "auto" : "smooth";
    if (sc && sc !== document.body) sc.scrollBy({ top: y - Math.max(hd, sc.getBoundingClientRect().top) - gap, behavior: beh }); else window.scrollBy({ top: y - hd - gap, behavior: beh });
    root.querySelectorAll("#drSlices .sec-flash").forEach((e) => e.remove());
    const nx = se.pos.find((q, k) => k > i && q); const h = nx && nx.n === p.n ? (nx.y - p.y) : (p.sh - p.y);
    const fl = document.createElement("span"); fl.className = "sec-flash"; fl.style.top = `${Math.round(p.y / p.sh * im.clientHeight)}px`; fl.style.height = `${Math.round(h / p.sh * im.clientHeight)}px`; f.appendChild(fl); setTimeout(() => fl.remove(), 1600);
  }
  function openSedit(x) {
    $("drLoced").hidden = true; le.id = null; $("drSedit").hidden = false; $("seName").textContent = `${x.type} (${x.id.replace(/^v5-/, "")}) · ${srcOf(x).t}`; $("seImg").src = x.image ? fileUrl(x.image) : ""; $("seImg").hidden = !x.image; $("seReq").value = "";
    const KN = { label: "작은 머리말", category: "분류", name: "상품명", sub: "보조 문구", title: "제목", desc: "설명", headline: "큰 제목" };
    const fields = x.fields || Object.entries(x.texts).map(([k, v]) => ({ path: k, label: KN[k] || k, value: v }));
    let g0 = null; // 배지·목록·표·FAQ 는 "FAQ 2"처럼 묶음 머리를 달아 보여 준다
    $("seTexts").innerHTML = fields.map((f) => { const head = f.group && f.group !== g0 ? `<div class="se-grp">${esc(f.group)}</div>` : ""; g0 = f.group || null; return `${head}<label class="${f.group ? "in" : ""}">${esc(f.group && f.label === f.group ? "" : f.label)}<textarea data-k="${esc(f.path)}" rows="1">${esc(f.value)}</textarea></label>`; }).join("") || `<p class="dt-empty">고칠 글이 없는 섹션입니다.</p>`;
    $("seTexts").querySelectorAll("textarea").forEach(fitTa);
  }
  // 글 칸은 내용 길이만큼 늘어나 전부 보이게(잘림 없음)
  function fitTa(t) { t.style.height = "auto"; t.style.height = t.scrollHeight + 2 + "px"; }
  $("seTexts").addEventListener("input", (e) => { if (e.target.matches("textarea")) fitTa(e.target); });
  $("seClose").onclick = () => { $("drSedit").hidden = true; se.cur = null; };
  $("seRegen").onclick = async () => { if (!se.cur) return; const r = await api.invoke("detail:section:regen", { jobId: st.lastResult.jobId, renderId: st.lastResult.current, sectionId: se.cur, request: $("seReq").value, rewrite: $("seRewrite").checked }); if (r?.error) flash(r.error); };
  $("seSaveText").onclick = async () => { if (!se.cur) return; const patch = Object.fromEntries([...$("seTexts").querySelectorAll("textarea[data-k]")].map((t) => [t.dataset.k, t.value])); const r = await api.invoke("detail:section:text", { jobId: st.lastResult.jobId, renderId: st.lastResult.current, sectionId: se.cur, patch }); if (r?.error) flash(r.error); };
  const moveSec = async (d) => { const i = se.list.findIndex((x) => x.id === se.cur); const j = i + d; if (i < 0 || j < 0 || j >= se.list.length) return; const order = se.list.map((x) => x.id); [order[i], order[j]] = [order[j], order[i]]; const r = await api.invoke("detail:sections:set", { jobId: st.lastResult.jobId, renderId: st.lastResult.current, order }); if (r?.error) flash(r.error); };
  $("seUp").onclick = () => moveSec(-1); $("seDown").onclick = () => moveSec(1);
  $("seDel").onclick = async () => { const b = $("seDel"); if (!b.classList.contains("arm")) { b.classList.add("arm"); b.textContent = "정말 삭제?"; setTimeout(() => { b.classList.remove("arm"); b.textContent = "🗑 섹션 삭제"; }, 2500); return; } const r = await api.invoke("detail:sections:set", { jobId: st.lastResult.jobId, renderId: st.lastResult.current, removed: [se.cur] }); if (r?.error) flash(r.error); };
  $("exGo").onclick = async () => { $("exMsg").textContent = "만드는 중…"; const r = await api.invoke("detail:export", { jobId: st.lastResult.jobId, renderId: st.lastResult.current, width: +$("exW").value, format: $("exF").value, mode: $("exM").value }); $("exMsg").textContent = r?.error ? `✕ ${r.error}` : `✔ ${r.files.length}개 저장 · ${r.dir.split(/[\\/]/).slice(-2).join("/")}`; };
  $("drQa").addEventListener("click", async (e) => { const b = e.target.closest("[data-qa]"); if (!b || !st.lastResult) return; b.disabled = true; b.textContent = "시작 중…"; const r = await api.invoke("detail:qa:apply", { jobId: st.lastResult.jobId, i: +b.dataset.qa }); if (r?.error) { flash(r.error); b.disabled = false; } });
  // 작은 알림(화면 아래)
  function toast(msg) { let t = document.getElementById("dtToast"); if (!t) { t = document.createElement("div"); t.id = "dtToast"; t.className = "dt-toast"; root.appendChild(t); } t.textContent = msg; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 4500); }
  $("drTabs").addEventListener("click", async (e) => {
    const tab = e.target.closest("[data-rid]"); if (!tab || !st.lastResult) return;
    const rid = tab.dataset.rid, act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return showResult(st.lastResult.jobId, rid);
    if (act === "del") {
      const b = e.target.closest("[data-act]");
      if (!b.classList.contains("arm")) { b.classList.add("arm"); b.textContent = "정말?"; setTimeout(() => { b.classList.remove("arm"); b.textContent = "🗑"; }, 2500); return; }
      const r = await api.invoke("detail:renderDelete", { jobId: st.lastResult.jobId, renderId: rid });
      if (r?.error) return flash(r.error);
      if (!r.renders) { setMode("setup"); load(); return; }
      return showResult(st.lastResult.jobId);
    }
    api.invoke("detail:open", { jobId: st.lastResult.jobId, what: act, renderId: rid });
  });
  const openSrc = (url, jobId) => api.invoke("detail:openSource", { url, jobId }).then((r) => r?.error && flash(r.error));
  $("drSrcOpen").onclick = () => st.lastResult && openSrc(st.lastResult.url, st.lastResult.jobId);
  $("drSrcUrl").onclick = (e) => { e.preventDefault(); st.lastResult && openSrc(st.lastResult.url, st.lastResult.jobId); };
  $("drSrcCopy").onclick = async () => { try { await navigator.clipboard.writeText(st.lastResult?.url || ""); $("drSrcCopy").textContent = "✔"; setTimeout(() => ($("drSrcCopy").textContent = "⧉"), 1500); } catch { flash("복사하지 못했습니다"); } };
  const renderThemePick = () => {
    if (isV5Result(st.lastResult)) { const cur = (st.lastResult.renders || []).find((x) => x.id === st.lastResult.current); const curTheme = cur?.templateRef || cur?.theme || "ivory"; $("drTplPick").innerHTML = THEMES.map((t) => themeCard(t, t.id === curTheme)).join("") + importCard() + `<p class="dt-ivnote">기본 테마는 색·질감만 바꿔 다시 그립니다(AI 0). 🧲 내 템플릿은 섹션 순서·카피 각도까지 따라가서 섹션·카피를 새로 씁니다.</p>`; } // v5: 테마만(구성·장면·카피 그대로, AI 0)
    else renderTpls();
  };
  $("drTpl").onclick = () => { renderThemePick(); $("drTplPick").hidden = !$("drTplPick").hidden; };
  $("drClose").onclick = () => { setMode("setup"); load(); };
  // 결과 화면: 왼쪽 작업 목록은 접혀 있고 ☰ 로 덮어서 연다(바깥 클릭·Esc·다시 누르면 닫힘)
  const listOpen = (on) => { window.SeedTip?.hide(); root.classList.toggle("dt-listopen", !!on); const b = $("drList"); b.dataset.tip = on ? "☰ 작업 목록 닫기" : "☰ 작업 목록 열기"; b.setAttribute("aria-label", b.dataset.tip.slice(2)); b.setAttribute("aria-expanded", String(!!on)); b.classList.toggle("on", !!on); if (on) load(); };
  $("drList").onclick = () => listOpen(!root.classList.contains("dt-listopen"));
  $("dtScrim").onclick = () => listOpen(false);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && root.classList.contains("dt-listopen")) listOpen(false); });
  $("drExpGo").onclick = () => $("drExport").scrollIntoView({ behavior: reduce() ? "auto" : "smooth", block: "end" });
  $("drSum").onclick = () => { const b = $("drSumBody"); b.hidden = !b.hidden; $("drSum").setAttribute("aria-expanded", String(!b.hidden)); const em = $("drSum").querySelector("em"); if (em) em.textContent = b.hidden ? "자세히 ▾" : "접기 ▴"; if (!b.hidden && $("drQaList")) $("drQaList").hidden = false; };

  // ---------- 원본 한글화 장별 고치기(오른쪽 칸) ----------
  // 단추 4개(다시 자동 고치기 · 줄·크기 맞추기 · 한글 빼고 그림만 · 이 장 빼기) + 이 장에 요청 + 접힌 "글 직접 고치기"(줄마다 문구·크기·굵게·정렬·빼기) + ↶ 되돌리기
  const le = { id: null, i: null, view: null, edits: {}, busy: null, tick: 0 };
  const nzt = (t) => String(t || "").replace(/[\s\u200b\u00ad]+/g, "");
  const curRd = () => (st.lastResult?.renders || []).find((x) => x.id === st.lastResult?.current) || {};
  function closeLocEdit() { le.id = null; le.view = null; $("drLoced").hidden = true; root.querySelectorAll("#drSlices .le-mark").forEach((e) => e.remove()); }
  function openLocEdit(i) { const x = se.list[i]; if (!x?.qa?.id) return; if (le.id !== x.qa.id) { le.edits = {}; $("leMore").open = false; $("leAsk").value = ""; } le.id = x.qa.id; le.i = i; $("drSedit").hidden = true; $("drLoced").hidden = false; loadLocEdit(); }
  async function loadLocEdit() {
    const id = le.id; if (!id) return;
    const r = await api.invoke("detail:loc:section", { jobId: st.lastResult.jobId, renderId: st.lastResult.current, sectionId: id }).catch((e) => ({ error: String(e) }));
    if (le.id !== id) return;
    if (r?.error) { flash(r.error); closeLocEdit(); return; }
    le.view = r; paintLocEdit(); paintLocMarks();
  }
  // 문제마다 "이렇게 풀어요" 한 줄(수강생이 어떤 단추를 누를지 바로 알게)
  const HINT = { overlap: "→ 📐 줄·크기 맞추기, 또는 글 직접 고치기에서 크기 −", overflow: "→ 글 직접 고치기에서 크기 − 나 문구 줄이기", roleDev: "→ 📐 줄·크기 맞추기", colDev: "→ 📐 줄·크기 맞추기", layout: "→ 📐 줄·크기 맞추기", contrast: "→ 글 직접 고치기에서 굵게, 또는 요청 \"글자를 잘 보이게\"", residue: "→ 🔧 다시 자동 고치기로 다시 지워 보고, 그래도 남으면 🙈 빼기", chinese: "→ 🔧 다시 자동 고치기", literal: "→ 글 직접 고치기나 요청으로 문구 바꾸기", translation: "→ 글 직접 고치기나 요청으로 문구 바꾸기", emptyDeco: "→ 🖼 한글 빼고 그림만, 또는 🙈 빼기" };
  const AI_HINT = { align: "colDev", spacing: "layout", size: "roleDev", overflow: "overflow", residue: "residue", empty_deco: "emptyDeco", translation: "translation" };
  const issueTexts = (q) => (q?.issues || []).flatMap((x) => x.texts || []).map(nzt).filter(Boolean);
  const lineOfText = (t) => { const k = nzt(t); return (le.view?.layers || []).findIndex((l) => { const n = nzt(l.ko); return n && k && (n === k || n.startsWith(k) || k.startsWith(n)); }); };
  function paintLocEdit() {
    const v = le.view, x = se.list[le.i] || {}, q = x.qa || v?.qa; if (!v) return;
    $("leName").textContent = `${x.name || v.id} 고치기`;
    const busy = !!le.busy;
    $("leState").innerHTML = !q ? "" : q.pass ? `<p class="ok">✔ ${q.edited ? "고쳤어요 — 다시 검수해 보니 문제 없어요" : "검수에서 문제 없음"}</p>`
      : `<p class="warn">⚠ 이 장에서 확인할 것</p><ul>${(q.issues || []).map((i) => `<li>${esc(i.why)}<small>${esc(HINT[i.kind === "ai" ? AI_HINT[i.ai] || "layout" : i.kind] || "")}</small></li>`).join("")}</ul>`;
    root.querySelectorAll("#drLoced [data-le]").forEach((b) => { b.disabled = busy || (v.type !== "image" && b.dataset.le !== "drop"); });
    $("leAsk").disabled = $("leAskGo").disabled = busy || v.type !== "image"; $("leSave").disabled = busy; $("leUndo").disabled = busy || !v.canUndo;
    $("leMore").hidden = v.type !== "image" || !v.layers.length;
    $("leLines").innerHTML = v.layers.map((l) => { const e = { ...l, ...(le.edits[l.i] || {}) }; const bold = e.weight >= 700; const al = e.align || "";
      return `<div class="le-line${e.drop ? " off" : ""}${issueTexts(q).some((t) => { const n = nzt(l.ko); return n.startsWith(t) || t.startsWith(n); }) ? " bad" : ""}" data-i="${l.i}">
        <textarea rows="1" data-k="ko"${e.drop ? " disabled" : ""}>${esc(e.ko)}</textarea>
        <div class="le-ctl"><button type="button" data-op="size" data-v="-2" data-tip="글자 작게">−</button><span class="sz" title="글자 크기">${Math.round(e.size)}</span><button type="button" data-op="size" data-v="2" data-tip="글자 크게">+</button>
        <button type="button" data-op="bold" class="${bold ? "on" : ""}" data-tip="굵게 켜고 끄기"><b>굵게</b></button>
        <span class="le-al">${[["left", "왼쪽"], ["center", "가운데"], ["right", "오른쪽"]].map(([k, t]) => `<button type="button" data-op="align" data-v="${k}" class="${al === k ? "on" : ""}" data-tip="${t} 맞춤">${t}</button>`).join("")}</span>
        <button type="button" data-op="drop" class="le-x" data-tip="${e.drop ? "이 줄 다시 살리기" : "이 줄 빼기"}">${e.drop ? "↺" : "✕"}</button></div>
        ${l.shape ? `<small class="le-shape">${l.shape} 안 글</small>` : ""}</div>`; }).join("") || `<p class="dt-empty">고칠 한글 줄이 없어요.</p>`;
    $("leLines").querySelectorAll("textarea").forEach(fitTa);
    $("leSave").hidden = !Object.keys(le.edits).length;
    $("leBusy").textContent = busy ? `⏳ ${le.busy.msg || "고치는 중"} · ${Math.round((Date.now() - le.busy.t0) / 1000)}초` : le.last || "";
  }
  // 미리보기 위 표시: 이 장의 글 상자(검수 측정) — 문제 글은 빨간 테두리, 누르면 그 줄 고치기로
  function paintLocMarks() {
    root.querySelectorAll("#drSlices .le-mark").forEach((e) => e.remove());
    const x = se.list[le.i], q = x?.qa, p = se.pos?.[le.i], rd = curRd(), s = rd.sections?.[le.i]; if (!le.id || !q?.box || !p || !s) return;
    const f = root.querySelectorAll("#drSlices figure")[p.n], im = f?.querySelector("img"); if (!im || !im.clientWidth) return;
    const k = im.clientWidth / (rd.width || 780), top0 = (q.y ?? s.y) - (s.y - p.y), bad = issueTexts(q);
    for (const u of q.box.units || []) {
      const y = top0 + u.y; if (y < 0 || y > p.sh) continue;
      const m = document.createElement("span"); const isBad = bad.some((t) => { const n = nzt(u.t); return n.startsWith(t) || t.startsWith(n); });
      m.className = `le-mark${isBad ? " bad" : ""}`; Object.assign(m.style, { left: `${Math.round(u.x * k) - 3}px`, top: `${Math.round(y * k) - 3}px`, width: `${Math.round(u.w * k) + 6}px`, height: `${Math.round(u.h * k) + 6}px` });
      m.dataset.tip = isBad ? "⚠ 문제 있는 글 — 누르면 이 줄 고치기" : "누르면 이 줄 고치기"; m.dataset.t = u.t;
      f.appendChild(m);
    }
  }
  $("drSlices").addEventListener("click", (e) => { const m = e.target.closest(".le-mark"); if (!m) return; const i = lineOfText(m.dataset.t); $("leMore").open = true; const row = i >= 0 ? $("leLines").querySelector(`[data-i="${le.view.layers[i].i}"]`) : null; if (row) { row.scrollIntoView({ block: "center", behavior: reduce() ? "auto" : "smooth" }); row.classList.add("flash"); setTimeout(() => row.classList.remove("flash"), 1200); row.querySelector("textarea")?.focus(); } });
  window.addEventListener("resize", () => { if (le.id) paintLocMarks(); });
  function paintLocRemoved(rd) { const rm = rd?.locQa?.removed || [], el = $("drLocRem"); el.hidden = !rm.length; el.innerHTML = rm.length ? `<span>🙈 뺀 장 ${rm.length}</span>${rm.map((r) => `<button type="button" class="sec" data-undo="${esc(r.id)}" data-tip="↶ 이 장을 다시 넣어요">${esc(r.name || r.id)} 다시 넣기</button>`).join("")}` : ""; }
  $("drLocRem").addEventListener("click", (e) => { const b = e.target.closest("[data-undo]"); if (b) locAct("undo", {}, b.dataset.undo); });
  // 줄 고치기(모아 두었다가 저장)
  $("leLines").addEventListener("input", (e) => { const t = e.target.closest("textarea"); if (!t) return; fitTa(t); const i = +t.closest("[data-i]").dataset.i; (le.edits[i] ||= {}).ko = t.value; $("leSave").hidden = false; });
  $("leLines").addEventListener("click", (e) => {
    const b = e.target.closest("[data-op]"); if (!b) return; const i = +b.closest("[data-i]").dataset.i, l = le.view.layers.find((q) => q.i === i), ed = (le.edits[i] ||= {}), cur = { ...l, ...ed };
    if (b.dataset.op === "size") ed.size = Math.max(8, Math.round(cur.size + Number(b.dataset.v)));
    if (b.dataset.op === "bold") ed.weight = cur.weight >= 700 ? 400 : 700;
    if (b.dataset.op === "align") ed.align = b.dataset.v;
    if (b.dataset.op === "drop") ed.drop = !cur.drop;
    paintLocEdit();
  });
  async function locAct(action, payload = {}, sectionId = le.id) {
    if (!st.lastResult || !sectionId || le.busy) return;
    le.busy = { msg: "시작", t0: Date.now() }; le.last = ""; if (le.id) paintLocEdit();
    clearInterval(le.tick); le.tick = setInterval(() => { if (le.busy && le.id) $("leBusy").textContent = `⏳ ${le.busy.msg || "고치는 중"} · ${Math.round((Date.now() - le.busy.t0) / 1000)}초`; }, 1000);
    const r = await api.invoke("detail:loc:edit", { jobId: st.lastResult.jobId, renderId: st.lastResult.current, sectionId, action, payload }).catch((e) => ({ error: String(e) }));
    clearInterval(le.tick); le.busy = null;
    if (r?.error) { le.last = `✕ ${r.error}`; flash(r.error); if (le.id) paintLocEdit(); return; }
    if (action === "text") le.edits = {};
    if (action === "drop") closeLocEdit();
    if (action === "undo" && sectionId !== le.id) le.id = sectionId; // 뺀 장 다시 넣기 → 그 장 칸 열기
    le.last = `${r.pass === false ? "⚠" : "✔"} ${r.note}${r.pass === false && r.why ? ` · 남은 것: ${r.why}` : ""} · ${Math.round((r.ms || 0) / 1000)}초${r.costUsd ? ` · $${Number(r.costUsd).toFixed(3)}` : ""}`;
    toast(le.last);
    await showResult(st.lastResult.jobId, st.lastResult.current, { keepScroll: true }); // 고친 그림으로 바꿔 끼우고 같은 칸 다시 열기(loadSections 끝)
  }
  root.querySelectorAll("#drLoced [data-le]").forEach((b) => { b.onclick = () => { if (b.dataset.le === "drop") { if (!b.classList.contains("arm")) { b.classList.add("arm"); b.querySelector("small").textContent = "한 번 더 누르면 빼요"; setTimeout(() => { b.classList.remove("arm"); b.querySelector("small").textContent = "다시 넣을 수 있어요"; }, 2500); return; } } locAct(b.dataset.le, b.dataset.le === "drop" ? { name: se.list[le.i]?.name } : {}); }; });
  $("leAskGo").onclick = () => { const t = $("leAsk").value.trim(); if (!t) return flash("요청을 적어 주세요 — 예: 제목을 더 크게"); locAct("request", { text: t }); };
  $("leAsk").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) $("leAskGo").click(); });
  $("leSave").onclick = () => { const layers = Object.entries(le.edits).map(([i, e]) => ({ i: +i, ...e })); if (layers.length) locAct("text", { layers }); };
  $("leUndo").onclick = () => locAct("undo");
  $("leClose").onclick = () => closeLocEdit();
  api.on("detail:changed", (p) => { const q = p?.locEdit; if (!q || st.lastResult?.jobId !== q.jobId) return; if (q.status === "running" && le.busy) { le.busy.msg = String(q.msg || "").replace(/^\S+\s+/, ""); } });

  // ---------- 메인 프로세스 이벤트 ----------
  api.on("detail:progress", onProgress);
  api.on("detail:changed", (p) => { if (p?.qa && st.mode === "result" && st.lastResult?.jobId === p.qa.jobId) { toast(`🤖 AI 검수 ${p.qa.score}/5 · 제안 ${p.qa.n}건`); showResult(p.qa.jobId, st.lastResult.current); } });
  api.on("detail:changed", (p) => { if (p?.templates) loadThemes(); });
  // 원본 한글화 뒤 검수: 진행 글만 바꾸고, 끝나면 고친 새 렌더로 조용히 바꿔 끼움(보던 자리 유지) + 알림
  api.on("detail:changed", (p) => {
    const q = p?.locQa; if (!q || st.mode !== "result" || st.lastResult?.jobId !== q.jobId) return;
    const rd = (st.lastResult.renders || []).find((x) => x.id === q.renderId); if (rd) rd.locQa = { ...(rd.locQa || {}), status: q.status, msg: q.msg || rd.locQa?.msg };
    if (q.status === "running") { if (st.lastResult.current === q.renderId) paintLocQa(); return; }
    if (q.status === "done") { const t = [q.fixed ? `🔧 ${q.fixed}장 자동으로 고침` : "", q.flagged ? `⚠ 확인 필요 ${q.flagged}장` : ""].filter(Boolean).join(" · "); toast(t || "✔ 원본 한글화 검수 통과"); }
    showResult(q.jobId, st.lastResult.current, { keepScroll: true });
  });
  // 검수 진행 줄 · "확인 필요 N장" 거르기 단추 — 지금 보는 탭의 locQa 로 그린다
  let qaTick = 0;
  function paintLocQa() {
    const lr = st.lastResult, rd = (lr?.renders || []).find((x) => x.id === lr?.current) || {}, q = rd.locQa, el = $("drLocQa"), fb = $("drQaOnly");
    clearInterval(qaTick); qaTick = 0;
    el.hidden = !(q && q.status === "running");
    if (!el.hidden) { const t0 = q.startedAt || Date.now(); const draw = () => { el.innerHTML = `<b>🔍 검수 중…</b><small>${esc(String(q.msg || "").replace(/^\S+\s+/, ""))} · ${Math.round((Date.now() - t0) / 1000)}초</small>`; }; draw(); qaTick = setInterval(() => { if (!root.isConnected || el.hidden) return clearInterval(qaTick); draw(); }, 1000); }
    const n = Object.values(q?.sections || {}).filter((x) => !x.pass).length;
    fb.hidden = !(q?.status === "done" && n); if (!n) se.qaOnly = false;
    fb.textContent = se.qaOnly ? `⚠ 확인 필요 ${n}장 · 전체 보기` : `⚠ 확인 필요 ${n}장`; fb.setAttribute("aria-pressed", String(!!se.qaOnly)); fb.classList.toggle("on", !!se.qaOnly);
  }
  $("drQaOnly").onclick = () => { se.qaOnly = !se.qaOnly; paintLocQa(); root.querySelectorAll("#drSecList li").forEach((li) => { const x = se.list[+li.dataset.i]; li.hidden = !!se.qaOnly && !(x?.qa && !x.qa.pass); }); };
  api.on("detail:changed", () => { if (st.mode !== "work") load(); else { const c = $("dcount"); api.invoke("detail:list").then((jobs) => { const n = (jobs || []).filter((j) => j.status === "done").length; if (c) { c.textContent = String(n); c.hidden = !n; } }).catch(() => {}); } });
  async function show() {
    await load();
    const run = await api.invoke("detail:get", {}).catch(() => null);
    if (run?.status === "running") { navRun(run.pct, true); if (!st.work || st.work.jobId !== run.jobId) { newWork(run.jobId, run.title); (run.events || []).forEach(onProgress); } else setMode("work"); if (run.waiting) openReview(run.jobId); }
    else if (st.mode === "work" && !st.work?.finished) { st.work = null; setMode("setup"); }
    loadOpts();
  }
  // ---------- v4 1단계 확인 화면("상품 정보를 가져왔어요") ----------
  const iv = { jobId: null, info: null, dirty: {} };
  function prepared(ev) {
    const w = st.work; if (w) { w.finished = true; w.pct = 100; w.shown = 100; }
    $("dwPct").textContent = "100%"; $("dwBar").style.width = "100%";
    root.querySelectorAll("#dwSteps li").forEach((li, i) => (li.className = i < 3 ? "done" : ""));
    line("go", esc(ev.msg));
    setTimeout(() => openInfo(ev.jobId), reduce() ? 0 : 700);
    load();
  }
  async function openInfo(jobId) {
    const r = await api.invoke("detail:info:get", { jobId });
    if (!r || r.error) { flash(r?.error || "상품 정보를 읽지 못했습니다"); return; }
    iv.jobId = jobId; iv.info = r; iv.dirty = {};
    renderInfo(); setMode("info"); ivErr(""); ivSyncRun();
  }
  const toggleIds = () => { const exc = [], inc = []; [...iv.info.gallery, ...iv.info.detail].forEach((x) => { if (x.excluded && !x.aiExcluded) exc.push(x.id); if (!x.excluded && x.aiExcluded) inc.push(x.id); if (x.excluded && x.aiExcluded) {} }); return { excluded: [...iv.info.gallery, ...iv.info.detail].filter((x) => x.excluded).map((x) => x.id), included: inc }; };
  // 한국 판매처(쿠팡·네이버·오늘의집): 다른 판매자 사진일 수 있다 → 재료로 쓰기 전에 한 번 고르기(내 상품 / 🧲 레퍼런스)
  function renderRights() {
    const r = iv.info, el = $("ivRights"); el.hidden = !r.koSource; if (!r.koSource) return;
    const site = SITE_KO[r.koSource] || r.koSource;
    el.className = "dt-ivrights" + (r.rightsOk ? " ok" : "");
    el.innerHTML = r.rightsOk ? `<span>✔ 내 상품 사진으로 확인했어요 · ${esc(site)}</span><button type="button" class="sec" data-rights="undo">바꾸기</button>`
      : `<span><b>내 상품 사진일 때만 재료로 쓰세요</b> · 다른 판매자 상품이면 🧲 레퍼런스(템플릿)로 저장해 벤치마킹하세요</span><button type="button" class="pri" data-rights="mine">✔ 내 상품 사진이에요</button><button type="button" class="sec" data-rights="ref" data-tip="상세 이미지의 구조(섹션 순서·색·설득 흐름)만 뽑아 🧲 내 템플릿에 넣습니다 — 사진·문장은 쓰지 않아요">🧲 레퍼런스로 저장</button><em id="ivRightsMsg"></em>`;
  }
  $("ivRights").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-rights]"); if (!b || !iv.info) return;
    const act = b.dataset.rights;
    if (act === "mine" || act === "undo") { iv.info.rightsOk = act === "mine"; renderRights(); ivErr(""); ivSave({ rightsOk: iv.info.rightsOk }); return; }
    b.disabled = true; const msg = $("ivRightsMsg"); if (msg) msg.textContent = "🧲 상세 이미지 분석 중 (1~5분)";
    const r = await api.invoke("detail:refFromJob", { jobId: iv.jobId }).catch((err) => ({ error: err?.message || String(err) }));
    b.disabled = false;
    if (r?.error) { if ($("ivRightsMsg")) $("ivRightsMsg").textContent = `✕ ${r.error}`; return; }
    if ($("ivRightsMsg")) $("ivRightsMsg").textContent = r.existing ? `이미 보관함에 있어요 · ${r.template?.name || ""}` : `✔ 🧲 보관함에 저장 · ${r.template?.name || ""} — ⑤ 디자인 스타일에서 골라 쓰세요`;
    await loadThemes?.(); toast(`🧲 레퍼런스 저장 · ${r.template?.name || ""}`);
  });
  api.on("detail:captureProgress", (p) => { if (p?.jobId && p.jobId === iv.jobId && $("ivRightsMsg")) $("ivRightsMsg").textContent = `🧲 ${p.msg || ""}`; }); // 🧲 레퍼런스 저장 진행(메인 detail:refFromJob)
  function renderInfo() {
    const r = iv.info;
    renderRights();
    $("ivSrc").textContent = r.url ? `🔗 원본 ${r.url.replace(/^https?:\/\//, "").slice(0, 46)}` : ""; $("ivSrc").hidden = !r.url;
    const card = (x) => `<button type="button" class="dt-ivimg${x.excluded ? " off" : ""}" data-id="${esc(x.id)}" title="${esc(x.why || "")}"><img src="${esc(fileUrl(x.photo || x.path))}" alt="" loading="lazy">${x.excluded ? `<em>제외</em>` : ""}<small>${esc(x.id)}${x.label ? ` · ${esc(x.label)}` : ""}${x.score != null ? ` · ${x.score}점` : ""}${x.sameAs ? ` · 대표 ${esc(x.sameAs)}과 같음` : ""}</small><span class="dt-logo${x.logo ? " on" : ""}" role="button" tabindex="0" data-logo="${esc(x.id)}" data-tip="사진에 다른 브랜드 로고가 있으면 켜세요 — 주요 섹션에서 뺍니다">${x.logo ? "로고 있음" : "로고?"}</span></button>`;
    $("ivGallery").innerHTML = r.gallery.map(card).join("") || `<p class="dt-empty">대표 이미지가 없습니다.</p>`;
    const sku = r.sku || []; $("ivSkuH").hidden = !sku.length; $("ivSku").innerHTML = sku.map(card).join(""); $("ivSkuN").textContent = sku.length ? `${sku.length}장 — 옵션 사진(색상·규격)` : "";
    // 만들기 방식(원본 한글화 · AI 장면 연출 · 둘 다) — 예상 비용·시간 따로
    const MD = [["localize", "🈚 원본 한글화", "1688 원본 사진을 살리고 중국어만 한글로 · 빠름·저비용 · 실제 사진·크기 정확"], ["scene", "🎨 AI 장면 연출(v5)", "섹션마다 AI 장면 사진 + 짧은 카드 글 · 분위기·연출"], ["both", "✨ 둘 다", "렌더 탭 2개(원본 한글화 + AI 장면) — 비교해서 고르기"]];
    $("ivModes").innerHTML = MD.filter(([id]) => !r.koSource || r.modes?.[id]).map(([id, name, desc]) => { const m = r.modes?.[id] || {}; return `<button type="button" class="dt-mode${(r.mode || "both") === id ? " on" : ""}" data-mode="${id}"><b>${name}</b><small>${desc}</small><em>약 $${(m.usd ?? 0).toFixed(2)} · 약 ${m.minutes ?? "?"}분</em></button>`; }).join("");
    $("ivDetail").innerHTML = r.detail.map(card).join("");
    $("ivDetailN").textContent = `${r.detail.filter((x) => !x.excluded).length}/${r.detail.length}장 사용`;
    const withText = [...r.gallery, ...r.detail].filter((x) => x.texts?.length);
    $("ivTextsSum").textContent = `이미지에서 추출한 텍스트 확인하기 (${withText.length}개)`;
    $("ivTexts").innerHTML = withText.map((x) => `<div class="dt-ivtx"><img src="${esc(fileUrl(x.path))}" alt=""><textarea data-id="${esc(x.id)}" rows="${Math.min(6, Math.max(2, x.texts.length))}" spellcheck="false">${esc(x.texts.join("\n"))}</textarea></div>`).join("");
    $("ivName").value = r.product_name_ko || "";
    $("ivBrief").value = r.brief_text || "";
    const tpls = st.tpls.length ? st.tpls : [];
    if ((r.mode || "both") === "localize") $("ivTpls").innerHTML = `<p class="dt-ivnote">원본 한글화는 원본 이미지 그대로 — 테마 선택이 필요 없어요.</p>`;
    else if (r.templateId === "card" && (r.themes || THEMES).length) { // 기본은 고른 한 장만(자동 추천) — "다른 디자인 고르기"를 펼치면 기본 테마 + 🧲 내 템플릿 + 가져오기, 내 템플릿이면 세부 조정·순서 토글
      const list = r.themes || THEMES, selId = r.templateRef || (r.theme === "custom" ? "" : r.theme) || "ivory", sel = list.find((t) => t.id === selId) || (r.theme === "custom" ? { id: "custom", name: "레퍼런스 자동 템플릿", desc: "폴더 레퍼런스에서 뽑은 손잡이", colors: ["#fff", "#eee", "#1c1f26"] } : list[0]);
      const mine = list.filter((t) => t.kind === "mine");
      $("ivTpls").innerHTML = themeCard(sel, true) + `<button type="button" class="dt-tpl dt-tplmore" data-showall aria-expanded="${iv.showAll ? "true" : "false"}"><b>${iv.showAll ? "접기 ▴" : "다른 디자인 고르기 ▾"}</b><small>기본 테마 ${list.length - mine.length}개${mine.length ? ` · 🧲 내 템플릿 ${mine.length}개` : ""} · 가져오기</small></button>`
        + (iv.showAll ? list.filter((t) => t.id !== sel.id).map((t) => themeCard(t, false)).join("") + importCard() : "")
        + `<p class="dt-ivnote">${sel.kind === "mine" ? "🧲 내 템플릿: 이 상세의 섹션 순서·색·정렬·설득 각도를 따라가고, 문장은 우리 상품으로 새로 씁니다." : "섹션마다 장면 사진 + 짧은 글(카드형 v5) — 테마만 고르세요. 생성 뒤에도 AI 없이 테마를 바꿀 수 있어요."}</p>`
        + (sel.kind === "mine" ? keepToggle(!!r.refKeepExtra) + tplActions(sel.id) + `<details class="dt-tpladj" id="ivTplAdj"${iv.adjOpen ? " open" : ""}><summary>세부 조정 <small>색·정렬·여백·키커·띠·사진·강조·정보 판 손잡이 — 바꾼 것만 저장</small></summary>${chipRows(r.templateChips || [], sel.id)}</details>` : "");
    }
    else $("ivTpls").innerHTML = tpls.map((t) => `<button class="dt-tpl${r.templateId === t.id ? " on" : ""}" type="button" data-tpl="${esc(t.id)}" title="${esc(t.desc || "")}"><span class="mini ${esc(t.id)}"><i class="hero"></i><i class="h"></i><i class="l"></i><i class="l s"></i><i class="img"></i><i class="l"></i><i class="cta"></i></span><b>${esc(t.name)}</b>${r.recommend?.templateId === t.id ? `<em class="rec">AI 추천</em><small>${esc(r.recommend.reason || "")}</small>` : `<small>${esc(t.desc || "")}</small>`}</button>`).join("");
    const sg0 = r.styleGuide || {};
    const sg = { ...sg0, backgroundColor: sg0.background || sg0.backgroundColor, colorPalette: sg0.palette || sg0.colorPalette || [], accentColors: sg0.accents || sg0.accentColors || [], sectionConsistencyRules: sg0.consistencyRules || sg0.sectionConsistencyRules || [], forbiddenProductUsageNote: sg0.forbiddenProductUsage || sg0.forbiddenProductUsageNote || "" };
    const chip = (c, label) => (c ? `<span class="chip"><i style="background:${esc(c)}"></i>${esc(label)} <code>${esc(c)}</code></span>` : "");
    $("ivStyle").innerHTML = `<h5>AI가 분석한 디자인 톤앤매너</h5><div class="chips">${chip(sg.backgroundColor, "배경")}${(sg.colorPalette || []).slice(0, 3).map((c, i) => chip(c, i ? "베이스" : "메인")).join("")}${(sg.accentColors || []).slice(0, 2).map((c) => chip(c, "포인트")).join("")}</div>
      <p><b>톤</b> ${esc(sg.backgroundTone || "")}</p><p><b>조명</b> ${esc(sg.lighting || "")}</p><p><b>소재감</b> ${esc(sg.materialMood || "")}</p><p><b>글꼴</b> ${esc(sg.typographyTone || "")}</p>
      ${sg.sectionConsistencyRules?.length ? `<details><summary>섹션 일관성 규칙 ${sg.sectionConsistencyRules.length}개</summary><ul>${sg.sectionConsistencyRules.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>${sg.forbiddenProductUsageNote ? `<p class="warn">⚠ ${esc(sg.forbiddenProductUsageNote)}</p>` : ""}</details>` : ""}`;
    renderClaims();
    const e = r.estimate || {};
    const mm = r.modes?.[r.mode || "both"];
    $("ivEst").textContent = mm ? `${mm.label} · 예상 약 $${mm.usd.toFixed(2)} · 약 ${mm.minutes}분${(r.mode || "both") !== "localize" ? ` · ${e.sections || "?"}개 섹션${e.sceneOn ? " · AI 장면 사진 포함" : " · 장면 사진 없음(이미지 생성 키 없음)"}` : ""}` : `${e.sections || "?"}개 섹션 · 예상 약 $${(e.usd ?? 0).toFixed(2)} · 약 ${e.minutes || "?"}분`;
    $("ivSub").textContent = `대표 ${r.gallery.filter((x) => !x.excluded).length}장 · 상세 ${r.detail.filter((x) => !x.excluded).length}장 · 텍스트 ${withText.length}개 — 확인하고 고친 뒤 생성하세요`;
  }
  // ⑦ 판매 실적·신뢰 배지(선택): 항목별 켜기 + 문구 + 숫자
  function renderClaims() {
    const r = iv.info, cl = r.claims || {};
    $("ivClaims").innerHTML = (r.claimTypes || []).map((c) => { const v = cl[c.type] || {}; return `<div class="dt-claim${v.on ? " on" : ""}" data-claim="${esc(c.type)}">
      <label class="tg"><input type="checkbox" data-f="on"${v.on ? " checked" : ""}><span>${esc(c.label)}</span></label>
      <input type="text" data-f="text" maxlength="80" placeholder="${esc(c.ph)}" value="${esc(v.text || "")}"${v.options?.length ? ` list="ivcl-${esc(c.type)}"` : ""}>${v.options?.length ? `<datalist id="ivcl-${esc(c.type)}">${v.options.map((o) => `<option value="${esc(o)}">`).join("")}</datalist>` : ""}
      ${c.unit !== "" || c.valuePh ? `<input type="text" class="num" data-f="value" maxlength="40" placeholder="${esc(c.valuePh || "숫자")}" value="${esc(v.value || "")}"><em>${esc(c.unit || "")}</em>` : ""}</div>`; }).join("");
  }
  const claimSave = (type) => { const row = $("ivClaims").querySelector(`[data-claim="${type}"]`); if (!row) return; const v = { on: row.querySelector('[data-f="on"]').checked, text: row.querySelector('[data-f="text"]').value, value: row.querySelector('[data-f="value"]')?.value || "" }; iv.info.claims = { ...(iv.info.claims || {}), [type]: v }; row.classList.toggle("on", v.on); ivSave({ claims: { [type]: v } }); };
  $("ivClaims").addEventListener("change", (e) => { const row = e.target.closest("[data-claim]"); if (row) claimSave(row.dataset.claim); });
  $("ivClaims").addEventListener("input", (e) => { const row = e.target.closest("[data-claim]"); if (row && e.target.dataset.f === "text" && e.target.value && !row.querySelector('[data-f="on"]').checked) { row.querySelector('[data-f="on"]').checked = true; row.classList.add("on"); } });
  $("ivClaimSug").onclick = async () => {
    const b = $("ivClaimSug"); b.disabled = true; b.innerHTML = `<span class="spin"></span> 문구 예시 만드는 중…`;
    const r = await api.invoke("detail:claims:suggest", { jobId: iv.jobId }).catch((e) => ({ error: e?.message || String(e) }));
    b.disabled = false; b.textContent = "✦ 문구 예시 받기";
    if (r?.error) return flash(r.error);
    let n = 0; const cl = { ...(iv.info.claims || {}) };
    for (const [k, v] of Object.entries(r.items || {})) { const cur = cl[k] || {}; if (!cur.text && v.text) { cl[k] = { ...cur, on: !!cur.on, text: v.text, value: cur.value || "", options: v.options || [] }; n++; } else if (v.options?.length) cl[k] = { ...cur, options: v.options }; }
    iv.info.claims = cl; renderClaims(); ivSave({ claims: cl });
    toast(n ? `✦ 문구 예시 ${n}개 — ${r.note || "□ 칸은 실제 숫자로 채우고, 넣을 항목만 켜 주세요"}` : "이미 문구가 있어요 — 빈 칸에만 예시를 넣습니다(다른 예시는 입력 칸 목록에)");
  };
  const ivSave = async (patch) => { const r = await api.invoke("detail:info:set", { jobId: iv.jobId, patch }); if (r?.error) flash(r.error); };
  $("dtFolder").onclick = async () => { const r = await api.invoke("detail:importFolder", {}); if (r?.cancelled) return; if (r?.error) return flash(r.error); newWork(r.jobId, "폴더에서 가져오는 중"); };
  $("ivModes").addEventListener("click", (e) => { const b = e.target.closest("[data-mode]"); if (!b) return; iv.info.mode = b.dataset.mode; renderInfo(); ivSave({ mode: b.dataset.mode }); });
  [$("ivGallery"), $("ivDetail"), $("ivSku")].forEach((g) => g.addEventListener("click", (e) => {
    const lg = e.target.closest("[data-logo]");
    if (lg) { e.stopPropagation(); const x = [...iv.info.gallery, ...(iv.info.sku || []), ...iv.info.detail].find((y) => y.id === lg.dataset.logo); if (!x) return; x.logo = !x.logo; x.logoHuman = true; renderInfo(); ivSave({ logos: { [x.id]: x.logo } }); return; }
    const b = e.target.closest("[data-id]"); if (!b) return;
    const x = [...iv.info.gallery, ...(iv.info.sku || []), ...iv.info.detail].find((y) => y.id === b.dataset.id); if (!x) return;
    x.excluded = !x.excluded; renderInfo();
    const all = [...iv.info.gallery, ...(iv.info.sku || []), ...iv.info.detail];
    ivSave({ excluded: all.filter((y) => y.excluded).map((y) => y.id), included: all.filter((y) => !y.excluded && y.aiExcluded).map((y) => y.id) });
  }));
  $("ivTexts").addEventListener("change", (e) => { const t = e.target.closest("textarea[data-id]"); if (!t) return; ivSave({ texts: { [t.dataset.id]: t.value.split("\n").map((x) => x.trim()).filter(Boolean) } }); });
  $("ivName").addEventListener("change", () => ivSave({ product_name_ko: $("ivName").value }));
  $("ivBrief").addEventListener("change", () => ivSave({ brief_text: $("ivBrief").value }));
  const ivReload = async () => { const r = await api.invoke("detail:info:get", { jobId: iv.jobId }); if (r && !r.error) { iv.info = r; renderInfo(); } };
  $("ivTpls").addEventListener("click", async (e) => {
    if (e.target.closest("[data-showall]")) { iv.showAll = !iv.showAll; renderInfo(); return; }
    if (e.target.closest("[data-import]")) { await tplImport(async (t) => { if (t?.id) { await ivSave({ templateRef: t.id }); iv.showAll = false; } await ivReload(); }); return; }
    const k = e.target.closest("[data-keep]"); if (k) { iv.info.refKeepExtra = k.dataset.keep === "1"; renderInfo(); ivSave({ refKeepExtra: iv.info.refKeepExtra }); return; }
    const a = e.target.closest("[data-tplact]"); if (a) { await tplAction(a.dataset.tplact, a.dataset.id, async () => { if (a.dataset.tplact === "remove") await ivSave({ templateRef: "" }); await ivReload(); }); return; }
    const rs = e.target.closest("[data-ovreset]"); if (rs) { const r = await api.invoke("detail:template:set", { id: rs.dataset.ovreset, overrides: {}, merge: false }); if (r?.error) return flash(r.error); iv.info.templateChips = r.template?.chips || []; iv.adjOpen = true; renderInfo(); loadThemes(); return; }
    const ch = e.target.closest("[data-ovk][data-ovv]"); if (ch) { const v = ch.dataset.ovv === "" ? null : ch.dataset.ovv; const r = await api.invoke("detail:template:set", { id: iv.info.templateRef, overrides: { [ch.dataset.ovk]: v } }); if (r?.error) return flash(r.error); iv.info.templateChips = r.template?.chips || []; iv.adjOpen = true; renderInfo(); loadThemes(); return; }
    const th = e.target.closest("[data-theme]");
    if (th) { const id = th.dataset.theme; const mine = THEMES.find((t) => t.id === id)?.kind === "mine"; iv.showAll = false; if (mine) { await ivSave({ templateRef: id }); await ivReload(); } else { iv.info.theme = id; iv.info.templateRef = ""; iv.info.templateChips = null; renderInfo(); ivSave({ theme: id }); } return; }
    const b = e.target.closest("[data-tpl]"); if (!b) return; iv.info.templateId = b.dataset.tpl; renderInfo(); ivSave({ templateId: b.dataset.tpl });
  });
  // 색·숫자 손잡이는 change 로 저장(드래그 중엔 숫자만 보여 줌)
  $("ivTpls").addEventListener("input", (e) => { const i = e.target.closest("input[type=range][data-ovk]"); if (i) { const c = i.nextElementSibling; if (c) c.textContent = i.value; } });
  $("ivTpls").addEventListener("change", async (e) => { const i = e.target.closest("input[data-ovk]"); if (!i || !iv.info?.templateRef) return; const v = i.type === "range" ? Number(i.value) : i.value; const r = await api.invoke("detail:template:set", { id: iv.info.templateRef, overrides: { [i.dataset.ovk]: v } }); if (r?.error) return flash(r.error); iv.info.templateChips = r.template?.chips || []; iv.adjOpen = true; renderInfo(); loadThemes(); });
  $("ivTpls").addEventListener("toggle", (e) => { if (e.target.id === "ivTplAdj") iv.adjOpen = e.target.open; }, true);
  $("ivSrc").onclick = (e) => { e.preventDefault(); if (iv.info?.url) api.invoke("detail:openSource", { url: iv.info.url }).then((r) => r?.error && flash(r.error)); };
  $("ivAiRe").onclick = async () => { await ivSave({ product_name_ko: $("ivName").value }); const r = await api.invoke("detail:prepare", { jobId: iv.jobId, fresh: ["brief"] }); if (r?.error) flash(r.error); };
  $("ivRefetch").onclick = async () => { const r = await api.invoke("detail:prepare", { jobId: iv.jobId, fresh: ["vision", "cutout", "brief"] }); if (r?.error) flash(r.error); };
  // 생성하기: 누르는 즉시 비활성+스피너, 응답 오면 바로 진행 화면(이벤트를 기다리지 않음), 에러는 버튼 아래 빨간 줄
  const goRunning = async (jobId) => { const run = await api.invoke("detail:get", {}).catch(() => null); if (run?.status === "running") { if (!st.work || st.work.jobId !== run.jobId) { newWork(run.jobId, run.title); (run.events || []).forEach(onProgress); } else setMode("work"); } else if (jobId) { newWork(jobId, $("ivName").value); } };
  const ivErr = (msg, jobId) => { const e = $("ivErr"); e.hidden = !msg; e.innerHTML = msg ? `✕ ${esc(msg)}${jobId ? ` <button type="button" class="sec" id="ivSeeRun">진행 화면 보기</button>` : ""}` : ""; const b = $("ivSeeRun"); if (b) b.onclick = () => goRunning(jobId); };
  const ivBtnReset = () => { const b = $("ivGo"); b.disabled = false; b.classList.remove("busy"); b.textContent = "✦ 상세페이지 생성하기"; };
  $("ivGo").onclick = async () => {
    const b = $("ivGo");
    if (b.dataset.mode === "watch") return goRunning(b.dataset.job);
    if (b.disabled) return;
    ivErr("");
    if (iv.info?.koSource && !iv.info.rightsOk) { ivErr("위 안내에서 「내 상품 사진이에요」를 먼저 눌러 주세요"); $("ivRights").scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    b.disabled = true; b.classList.add("busy"); b.innerHTML = `<span class="spin"></span> 생성 시작 중…`;
    const edits = { product_name_ko: $("ivName").value, brief_text: $("ivBrief").value, templateId: iv.info.templateId };
    let r = null;
    try { r = await api.invoke("detail:confirm", { jobId: iv.jobId, edits, review: reviewFlag() }); } catch (e) { r = { error: e?.message || String(e) }; }
    if (r?.error) { ivBtnReset(); ivErr(r.error, /이미/.test(r.error) ? r.jobId || null : null); return; }
    ivBtnReset();
    newWork(r.jobId || iv.jobId, $("ivName").value); // 바로 진행 화면
    line("sys", "생성 요청 접수 — 장면·카피·구성·렌더를 시작합니다");
  };
  // 확인 화면에서 지금 생성 중인 작업이 있으면 생성하기 대신 "진행 보기"
  async function ivSyncRun() {
    const b = $("ivGo"); const run = await api.invoke("detail:get", {}).catch(() => null);
    if (run?.status === "running") { b.dataset.mode = "watch"; b.dataset.job = run.jobId; b.disabled = false; b.classList.remove("busy"); b.textContent = run.jobId === iv.jobId ? `▶ 생성 중 ${Math.floor(run.pct || 0)}% — 진행 보기` : "▶ 다른 상품 생성 중 — 진행 보기"; }
    else { delete b.dataset.mode; delete b.dataset.job; ivBtnReset(); }
  }

  // 사이드바 📄 메뉴: 진행 중 점 깜빡임 + %
  const navRun = (() => { const host = document.getElementById("tDetail"); if (!host) return () => {}; let el = host.querySelector(".dt-navrun"); if (!el) { el = document.createElement("i"); el.className = "dt-navrun"; el.hidden = true; host.appendChild(el); } return (pct, on) => { el.hidden = !on; if (on) el.innerHTML = `<b></b>${Math.floor(pct || 0)}%`; }; })();

  // ---------- 공용 말풍선 툴팁: data-tip 속성이 있는 아무 요소(앱 전체) — 0.25초 뒤 아래에 검정 알약 ----------
  if (!window.SeedTip) {
    const tip = document.createElement("div"); tip.className = "seed-tip"; tip.setAttribute("role", "tooltip"); tip.hidden = true; document.body.appendChild(tip);
    let timer = null, cur = null;
    const place = (el) => {
      const r = el.getBoundingClientRect(); tip.hidden = false; tip.textContent = el.dataset.tip;
      const tw = tip.offsetWidth, th = tip.offsetHeight, below = r.bottom + 8 + th < innerHeight;
      tip.style.left = Math.round(Math.min(innerWidth - tw - 6, Math.max(6, r.left + r.width / 2 - tw / 2))) + "px";
      tip.style.top = Math.round(below ? r.bottom + 8 : r.top - th - 8) + "px"; tip.classList.toggle("up", !below);
      requestAnimationFrame(() => tip.classList.add("on"));
    };
    const show = (el) => { clearTimeout(timer); cur = el; timer = setTimeout(() => { if (cur === el && el.isConnected && el.dataset.tip) place(el); }, 250); };
    const hide = () => { clearTimeout(timer); cur = null; tip.classList.remove("on"); tip.hidden = true; };
    document.addEventListener("mouseover", (e) => { const el = e.target.closest?.("[data-tip]"); if (el === cur) return; if (el) show(el); else hide(); });
    document.addEventListener("focusin", (e) => { const el = e.target.closest?.("[data-tip]"); if (el) show(el); });
    ["focusout", "scroll", "mousedown", "keydown"].forEach((ev) => document.addEventListener(ev, hide, true));
    window.SeedTip = { show, hide };
  }
  window.Detail = { show, load, showResult, openInfo, state: st, push: onProgress, le, se }; // le·se: 화면 하네스(장별 고치기 상태) // push: 화면 하네스·시연용(진행 이벤트를 직접 넣기)
  setMode("setup");
  api.invoke("detail:list").then((jobs) => { const n = (jobs || []).filter((j) => j.status === "done").length; const c = $("dcount"); if (c) { c.textContent = String(n); c.hidden = !n; } }).catch(() => {});
})();
