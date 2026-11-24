// 📄 만들기 전 사전 점검 — 원본 한글화·카드에 필요한 AI(글자 읽기 OCR · 글 AI · 이미지 AI)가 이 PC 에서 실제로 되는지 본다.
// 하나라도 안 되면 조용히 대체하지 않고 멈춘다(2026-11-18 윈도우: 구글 연결 없음 → 배포 전 서버로 OCR → 매 장 실패 → 중국어가 그대로 남은 "완성").
//   checkReadiness({ needOcr, needText, needImage, settings }) → { ok, problems:[{ what, msg }], fix:"google"|"wait"|null, headline, tesseractOk }
// 판정(순수 함수 judgeReadiness)과 상태 수집(checkReadiness)을 나눠 테스트한다(test/detail/preflight.test.js).

const LABEL = { ocr: "글자 읽기(OCR)", text: "글 AI(번역·기획·카피)", image: "이미지 AI(글자 지우기·장면)" };

// 제공자 상태 → 판정. prov: { ocr, text, image } 각 "local"|"google"|"server"|"tesseract"|null, caps: 서버 relayCaps() 결과(서버를 쓸 때만)
// hasTesseract: 이 PC 에 tesseract.js 가 있음 → OCR 만 문제면 "낮은 품질로 계속"을 고를 수 있다(allowTesseract 면 그걸로 진행: ocrUse "tesseract")
export function judgeReadiness({ need = {}, prov = {}, caps = null, googleConnected = false, allowTesseract = false, hasTesseract = false } = {}) {
  const problems = [];
  let serverDown = false, tesseractOk = false, ocrUse = null;
  for (const k of ["ocr", "text", "image"]) {
    if (!need[k]) continue;
    const p = prov[k];
    if (p === "local" || p === "google") continue;
    if (p === "server" && caps?.ok && caps.tasks?.[k === "text" ? "claude" : k]) continue;
    if (k === "ocr" && (hasTesseract || p === "tesseract")) { // 중국어에 약한 대체 OCR — 사용자가 골랐을 때만
      if (allowTesseract) { ocrUse = "tesseract"; continue; }
      tesseractOk = true;
    }
    if (k === "ocr" && p === "tesseract") { problems.push({ what: k, msg: `${LABEL[k]}: 이 PC 의 기본 OCR 은 중국어를 잘 못 읽어요` }); continue; }
    if (p === "server") {
      serverDown = true;
      problems.push({ what: k, msg: `${LABEL[k]}: ${caps?.net ? "씨드핵 서버에 연결하지 못했어요" : "씨드핵 서버가 아직 준비되지 않았어요"}` });
      continue;
    }
    problems.push({ what: k, msg: `${LABEL[k]}: 연결된 AI 가 없어요` });
  }
  if (!problems.length) return { ok: true, problems, fix: null, headline: "", tesseractOk: false, ocrUse };
  const fix = !googleConnected ? "google" : serverDown ? "wait" : "google";
  const headline = !googleConnected ? "구글 연결이 필요해요" : serverDown ? "씨드핵 서버가 아직 준비 중이에요" : "AI 연결을 확인해 주세요";
  return { ok: false, problems, fix, headline, tesseractOk: tesseractOk && problems.length === 1 && problems[0].what === "ocr", ocrUse };
}

// 지금 이 PC 의 제공자를 모은다
export async function checkReadiness({ needOcr = true, needText = true, needImage = true, settings = {} } = {}) {
  const [{ pickProvider, hasTesseract }, cli, scene, gc, relay] = await Promise.all([import("./ocr.js"), import("./cli.js"), import("./scene.js"), import("./google-conn.js"), import("./relay.js")]);
  const o = pickProvider(), t = cli.aiProvider(), im = scene.resolveProvider({ settings });
  const prov = {
    ocr: o === "vision" ? "local" : o === "google" ? "google" : o === "server" ? "server" : o === "tesseract" ? "tesseract" : null,
    text: t === "claude" ? "local" : t === "gemini" ? "google" : t === "server" ? "server" : null,
    image: im.provider === "google" ? "google" : im.provider === "server" ? "server" : im.key ? "local" : null,
  };
  const need = { ocr: !!needOcr, text: !!needText, image: !!needImage };
  const useServer = Object.keys(need).some((k) => need[k] && prov[k] === "server");
  const caps = useServer ? await relay.relayCaps() : null;
  return { ...judgeReadiness({ need, prov, caps, googleConnected: gc.googleConnected(), allowTesseract: !!settings.detailAllowTesseract, hasTesseract: hasTesseract() }), prov, caps };
}

// 실행 중 OCR 결과 점검: 중국어 상세인데 대부분 실패했거나 상자가 하나도 없으면 멈춘다
// remote: 서버·구글 OCR(맥 Vision 은 글이 정말 없는 상품일 수 있어 상자 0개만으로는 멈추지 않는다)
export function judgeOcr({ total = 0, failed = 0, boxes = 0, lang = "zh", remote = true } = {}) {
  if (lang === "ko" || !total) return null;
  if (failed >= Math.max(1, Math.ceil(total * 0.5))) return `글자 읽기(OCR)가 ${total}장 중 ${failed}장에서 실패했어요`;
  if (remote && boxes === 0 && total >= 3) return `이미지 ${total}장에서 글자를 하나도 찾지 못했어요(OCR 연결 문제로 보여요)`;
  return null;
}
