// 서버 중계(relay.js)·윈도우 누끼(cutout-core.js) 순수 부분 — `node --test test/detail/relay.test.js`
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findImagePaths, userMessage, relayEnabled } from "../../src/main/detail/relay.js";
import { pickModel, makeInputSquare, maskSquare, upscaleMask, alphaStats, applyAlpha, MODELS } from "../../src/main/detail/cutout-core.js";
import { textHeavy } from "../../src/main/detail/cutout-core.js";

test("findImagePaths: 빈칸·한글 경로, 있는 파일만, 중복 없이", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay test 씨드핵-"));
  const a = path.join(dir, "clean", "d01.png"), b = path.join(dir, "g 02.jpg");
  fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, "x"); fs.writeFileSync(b, "x");
  const text = `1. id=d01 · detail · 750x1000 · 경로: ${a}\n2. id=g02 · 경로: ${b}\n3. 없는 파일: ${path.join(dir, "none.png")}\n크기 kg/m 표기 · 다시 ${a}`;
  assert.deepEqual(findImagePaths(text), [a, b]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("userMessage: 수강생용 안내", () => {
  assert.match(userMessage({ status: 401 }), /다시 로그인/);
  assert.match(userMessage({ code: "pages", error: "오늘 만들 수 있는 상세페이지 5개를 다 만들었어요." }), /5개/);
  assert.match(userMessage({ code: "net" }), /인터넷/);
  assert.match(userMessage({ status: 503 }), /준비 중/);
  assert.match(userMessage({ code: "wing" }), /Wing/);
});

test("relayEnabled: 노드 단독은 시킬 때만", () => {
  const old = process.env.SEEDHACK_RELAY;
  delete process.env.SEEDHACK_RELAY; assert.equal(relayEnabled(), false);
  process.env.SEEDHACK_RELAY = "server"; assert.equal(relayEnabled(), true);
  if (old == null) delete process.env.SEEDHACK_RELAY; else process.env.SEEDHACK_RELAY = old;
});

test("cutout-core: 모델 고르기", () => {
  assert.equal(pickModel({ totalGB: 64, freeGB: 40 }), "u2net");
  assert.equal(pickModel({ totalGB: 16, freeGB: 6, want: "birefnet" }), "u2net");
  assert.equal(pickModel({ totalGB: 32, freeGB: 6, want: "birefnet" }), "birefnet");
});

test("cutout-core: 전처리 BGRA→RGB 정규화, 마스크 늘리기·통계·알파", () => {
  const S = 2, bgra = Uint8Array.from([0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255]); // 빨강·초록·파랑·흰색
  const t = makeInputSquare(bgra, S, MODELS.u2net);
  assert.ok(Math.abs(t[0] - (1 - 0.485) / 0.229) < 1e-6); // 첫 칸 R=255
  assert.ok(Math.abs(t[S * S + 1] - (1 - 0.456) / 0.224) < 1e-6); // 둘째 칸 G=255
  const g = maskSquare(Float32Array.from([0, 0, 1, 1]), 2, { sigmoid: false });
  assert.deepEqual([...g], [0, 0, 255, 255]);
  const a = upscaleMask(g, 2, 4, 4);
  const st = alphaStats(a, 4, 4);
  assert.equal(st.ok, true); assert.equal(st.bbox.y, 2); assert.equal(st.bbox.h, 2);
  const out = applyAlpha(Buffer.from(new Uint8Array(4 * 4 * 4).fill(200)), a);
  assert.equal(out[3], 0); assert.equal(out[0], 0); assert.equal(out[15 * 4 + 3], 255); assert.equal(out[15 * 4], 200);
});

test("textHeavy: 글자 상자가 많거나 넓으면 인포그래픽", () => {
  const bbox = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(textHeavy(bbox, [{ x: 10, y: 10, w: 10, h: 5, text: "规格" }]), false);
  assert.equal(textHeavy(bbox, [{ x: 0, y: 0, w: 50, h: 20, text: "规格参数" }]), true);
  assert.equal(textHeavy(bbox, Array.from({ length: 6 }, (_, i) => ({ x: i * 10, y: 0, w: 2, h: 2, text: "字" }))), true);
  assert.equal(textHeavy(bbox, [{ x: 0, y: 0, w: 90, h: 90, text: "21cm", latin: true }]), false);
});
