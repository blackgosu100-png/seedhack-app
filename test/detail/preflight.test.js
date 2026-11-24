// 🚦 만들기 전 사전 점검·OCR 실패 멈춤 — `node --test test/detail/preflight.test.js`
// 2026-11-18 윈도우 회귀: 구글 연결 없음 → 배포 전 서버(task 없음)로 OCR → 매 장 실패 → 중국어가 그대로 남은 결과가 "완성"으로 나옴
import test from "node:test";
import assert from "node:assert/strict";
import { judgeReadiness, judgeOcr } from "../../src/main/detail/preflight.js";
import { isUnsupported, userMessage } from "../../src/main/detail/relay.js";

const need = { ocr: true, text: true, image: true };

test("맥(로컬 도구)·구글 연결이면 통과", () => {
  assert.equal(judgeReadiness({ need, prov: { ocr: "local", text: "local", image: "local" } }).ok, true);
  assert.equal(judgeReadiness({ need, prov: { ocr: "google", text: "google", image: "google" }, googleConnected: true }).ok, true);
});

test("윈도우 회귀: 구글 없음 + 서버가 작업을 모름 → 멈추고 '구글 연결이 필요해요'", () => {
  const r = judgeReadiness({ need, prov: { ocr: "server", text: "server", image: "server" }, caps: { ok: false, unsupported: true, tasks: {} }, googleConnected: false, hasTesseract: true });
  assert.equal(r.ok, false);
  assert.equal(r.fix, "google");
  assert.equal(r.headline, "구글 연결이 필요해요");
  assert.equal(r.problems.length, 3);
  assert.match(r.problems[0].msg, /서버가 아직 준비/);
  assert.equal(r.tesseractOk, false); // 글 AI·이미지도 없어 낮은 품질 OCR 만으로는 못 만든다
});

test("서버가 준비됐으면(ping ready) 서버로 통과, 일부만 준비면 그 부분만 문제", () => {
  assert.equal(judgeReadiness({ need, prov: { ocr: "server", text: "server", image: "server" }, caps: { ok: true, tasks: { claude: true, image: true, ocr: true } } }).ok, true);
  const r = judgeReadiness({ need, prov: { ocr: "server", text: "server", image: "server" }, caps: { ok: true, tasks: { claude: true, image: true, ocr: false } }, googleConnected: true, hasTesseract: true });
  assert.equal(r.ok, false); assert.equal(r.fix, "wait"); assert.equal(r.problems[0].what, "ocr"); assert.equal(r.tesseractOk, true);
});

test("낮은 품질 OCR(tesseract)은 사용자가 고를 때만", () => {
  const p = { ocr: "server", text: "google", image: "google" }, caps = { ok: false, unsupported: true, tasks: {} };
  assert.equal(judgeReadiness({ need, prov: p, caps, googleConnected: true, hasTesseract: true }).ok, false);
  const r = judgeReadiness({ need, prov: p, caps, googleConnected: true, hasTesseract: true, allowTesseract: true });
  assert.equal(r.ok, true); assert.equal(r.ocrUse, "tesseract");
});

test("필요 없는 것은 보지 않는다(한국 판매처는 OCR 불필요)", () => {
  assert.equal(judgeReadiness({ need: { ocr: false, text: true, image: true }, prov: { ocr: null, text: "local", image: "local" } }).ok, true);
});

test("OCR 실행 결과: 절반 넘게 실패하거나(원격) 글자가 0개면 멈춤", () => {
  assert.match(judgeOcr({ total: 10, failed: 10, boxes: 0 }), /10장 중 10장에서 실패/);
  assert.match(judgeOcr({ total: 10, failed: 0, boxes: 0, remote: true }), /하나도 찾지 못했어요/);
  assert.equal(judgeOcr({ total: 10, failed: 0, boxes: 0, remote: false }), null); // 맥 Vision: 글 없는 상품일 수 있음
  assert.equal(judgeOcr({ total: 10, failed: 2, boxes: 120 }), null);
  assert.equal(judgeOcr({ total: 10, failed: 9, boxes: 0, lang: "ko" }), null);
});

test("서버가 작업을 모르면(옛 서버 400·주소 404) '준비 안 됨'으로 분류", () => {
  assert.equal(isUnsupported(400, "지원하지 않는 작업입니다 (ocr)"), true);
  assert.equal(isUnsupported(404, ""), true);
  assert.equal(isUnsupported(400, "사진 형식이 잘못됐습니다"), false);
  assert.equal(isUnsupported(429, "지원하지 않는 작업"), false);
  assert.match(userMessage({ code: "unsupported" }), /구글 클라우드를 연결/);
});
