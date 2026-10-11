// OCR 하네스 — 샘플 12장(d01~d12)을 Vision 으로 읽어 재현율을 재고, tesseract 제공자도 3장 이상 시험한다.
// 실행: npx electron test/detail/ocr-harness.js   (먼저 npx electron test/detail/img/make-samples.js 로 샘플을 만들어 둔다)
// 통과 기준(CHECKLIST B-1, B-2): 장당 상자 ≥1, 전체 재현율 ≥80%, tesseract 3장 이상에서 상자 ≥1(언어 데이터 내려받기 실패 시 사유 기록)
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// --no-swiftc: swiftc 가 없는 상황(B-7)을 흉내 — 바이너리가 없는 별도 userData + 환경변수로 swiftc 검사를 끈다
const NO_SWIFTC = process.argv.includes("--no-swiftc");
app.setPath("userData", path.join(os.tmpdir(), NO_SWIFTC ? "seedhack-detail-test-noswift" : "seedhack-detail-test"));
if (NO_SWIFTC) process.env.SEEDHACK_OCR_NO_SWIFTC = "1";

const here = path.dirname(fileURLToPath(import.meta.url));
const imgDir = path.join(here, "fixture", "img");
const outDir = path.join(here, "img", "out");
const log = (_lv, text) => console.log(text);

// 재현율 판정용 정규화: 공백 제거, ×→x, 전각→반각 비슷한 것, 소문자
const norm = (s) => String(s || "").replace(/\s+/g, "").replace(/[×✕✖]/g, "x").replace(/[＊*]/g, "*").toLowerCase();

// B-7: swiftc 없음 → 한국어 안내 + tesseract 대체 (자식 프로세스로 실행되는 부분)
async function runNoSwiftc() {
  const fails = [];
  try {
    // 언어 데이터는 본 하네스의 캐시를 복사해 두 번 내려받지 않게 한다
    const src = path.join(os.tmpdir(), "seedhack-detail-test", "detail", "tessdata"), dst = path.join(app.getPath("userData"), "detail", "tessdata");
    if (fs.existsSync(src) && !fs.existsSync(dst)) fs.cpSync(src, dst, { recursive: true });
    try { fs.rmSync(path.join(app.getPath("userData"), "detail", "bin"), { recursive: true, force: true }); } catch {}
    const { ocrImages, pickProvider, closeTesseract, visionFailReason, ensureVisionBinary } = await import("../../src/main/detail/ocr.js");
    const prov = pickProvider();
    console.log(`[no-swiftc] pickProvider → ${prov}`);
    if (prov === "vision") fails.push("swiftc 없음인데 vision 선택");
    const lines = [];
    const bin = await ensureVisionBinary({ log: (_l, t) => lines.push(t) });
    console.log(`[no-swiftc] ensureVisionBinary → ${bin} · 안내: ${visionFailReason()}`);
    if (bin) fails.push("바이너리가 만들어짐");
    if (!/xcode-select|Xcode/.test(visionFailReason() || "") || !/tesseract/.test(visionFailReason() || "")) fails.push("한국어 안내(xcode-select + tesseract 대체)가 없음");
    const samples = JSON.parse(fs.readFileSync(path.join(here, "img", "samples.json"), "utf8"));
    const r = await ocrImages(["d01", "d09"].map((id) => ({ id, file: path.join(imgDir, `${id}.png`), w: samples[id].w, h: samples[id].h })), { provider: "vision", log });
    console.log(`[no-swiftc] vision 요청 → 실제 provider=${r.provider}, 상자 ${r.images.map((im) => im.boxes.length).join("/")}`);
    if (r.provider !== "tesseract") fails.push(`대체 제공자가 tesseract 가 아님: ${r.provider}`);
    if (!r.images.every((im) => im.boxes.length >= 1)) fails.push("tesseract 대체 결과 상자 0개");
    await closeTesseract();
  } catch (e) { fails.push(`예외: ${e?.stack || e}`); }
  if (fails.length) { console.log("NOSWIFTC_FAIL\n - " + fails.join("\n - ")); process.exitCode = 1; }
  else console.log("OK NOSWIFTC_OK");
  app.quit();
}

app.whenReady().then(async () => {
  if (NO_SWIFTC) return runNoSwiftc();
  const fails = [];
  try {
    const { ocrImages, pickProvider, closeTesseract, visionFailReason } = await import("../../src/main/detail/ocr.js");
    const samples = JSON.parse(fs.readFileSync(path.join(here, "img", "samples.json"), "utf8"));
    const ids = Object.keys(samples);
    const images = ids.map((id) => ({ id, file: path.join(imgDir, `${id}.png`), w: samples[id].w, h: samples[id].h }));
    fs.mkdirSync(outDir, { recursive: true });

    console.log(`제공자 선택: ${pickProvider()}`);
    // ---- Vision ----
    const t0 = Date.now();
    const progress = [];
    const r = await ocrImages(images, { provider: "vision", log, onProgress: (p) => progress.push(p) });
    console.log(`Vision OCR ${ids.length}장 ${Date.now() - t0}ms · provider=${r.provider}${visionFailReason() ? " · " + visionFailReason() : ""}`);
    if (r.provider !== "vision") fails.push(`Vision 제공자가 아니라 ${r.provider} 로 실행됨`);
    if (progress.length !== ids.length || progress[progress.length - 1]?.done !== ids.length) fails.push(`onProgress 호출 ${progress.length}회(기대 ${ids.length})`);
    fs.writeFileSync(path.join(outDir, "ocr-vision.json"), JSON.stringify(r, null, 2));
    let hit = 0, want = 0;
    for (const im of r.images) {
      const s = samples[im.id];
      const joined = norm(im.boxes.map((b) => b.text).join(""));
      const found = s.texts.filter((t) => joined.includes(norm(t)));
      hit += found.length; want += s.texts.length;
      const miss = s.texts.filter((t) => !joined.includes(norm(t)));
      const cjkBoxes = im.boxes.filter((b) => !b.latin).length;
      console.log(`  ${im.id} ${im.w}x${im.h} 상자 ${im.boxes.length}개(CJK ${cjkBoxes}) 재현 ${found.length}/${s.texts.length}${miss.length ? " 놓침: " + miss.join(" | ") : ""}`);
      if (im.id.startsWith("d") && im.boxes.length < 1) fails.push(`${im.id} 상자 0개`);
      if (im.w !== s.w || im.h !== s.h) fails.push(`${im.id} 크기 불일치 ${im.w}x${im.h} ≠ ${s.w}x${s.h}`);
      for (const b of im.boxes) if (b.x < 0 || b.y < 0 || b.x + b.w > im.w + 2 || b.y + b.h > im.h + 2) fails.push(`${im.id} 상자가 이미지 밖: ${JSON.stringify(b)}`);
    }
    const recall = want ? hit / want : 0;
    console.log(`Vision 재현율 ${(recall * 100).toFixed(1)}% (${hit}/${want})`);
    if (recall < 0.8) fails.push(`재현율 ${(recall * 100).toFixed(1)}% < 80%`);

    // ---- tesseract (3장) ----
    const tessIds = ["d01", "d02", "d09", "d11"];
    const t1 = Date.now();
    const tr = await ocrImages(images.filter((im) => tessIds.includes(im.id)), { provider: "tesseract", log });
    console.log(`tesseract OCR ${tessIds.length}장 ${Date.now() - t1}ms · provider=${tr.provider}`);
    fs.writeFileSync(path.join(outDir, "ocr-tesseract.json"), JSON.stringify(tr, null, 2));
    if (tr.provider !== "tesseract") fails.push(`tesseract 제공자 실행 실패 → ${tr.provider} 로 내려감(언어 데이터 내려받기에 네트워크가 필요할 수 있음)`);
    else {
      let okImgs = 0, th = 0, tw = 0;
      for (const im of tr.images) {
        const s = samples[im.id];
        const joined = norm(im.boxes.map((b) => b.text).join(""));
        const found = s.texts.filter((t) => joined.includes(norm(t)));
        th += found.length; tw += s.texts.length;
        if (im.boxes.length >= 1) okImgs++;
        console.log(`  ${im.id} 상자 ${im.boxes.length}개 재현 ${found.length}/${s.texts.length} · ${im.boxes.slice(0, 3).map((b) => b.text).join(" / ")}`);
      }
      console.log(`tesseract 재현율 ${tw ? ((th / tw) * 100).toFixed(1) : 0}% (${th}/${tw}), 상자 있는 이미지 ${okImgs}/${tessIds.length}`);
      if (okImgs < 3) fails.push(`tesseract 상자 ≥1 인 이미지가 ${okImgs}장 < 3장`);
    }
    await closeTesseract();

    // ---- B-7: swiftc 없음 흉내(자식 프로세스) ----
    const { execFile } = await import("node:child_process");
    const child = await new Promise((resolve) => execFile(process.execPath, [fileURLToPath(import.meta.url), "--no-swiftc"], { timeout: 300000, maxBuffer: 16 * 1024 * 1024 }, (err, so, se) => resolve({ err, so: String(so || ""), se: String(se || "") })));
    const childLines = child.so.split("\n").filter((l) => /\[no-swiftc\]|NOSWIFTC|🔎/.test(l));
    console.log(childLines.map((l) => "  " + l).join("\n"));
    if (child.err || !/OK NOSWIFTC_OK/.test(child.so)) fails.push(`swiftc 없음 대체 시험 실패: ${(child.so.match(/NOSWIFTC_FAIL[\s\S]*/) || [child.se.slice(-400)])[0]}`);
  } catch (e) {
    fails.push(`예외: ${e?.stack || e}`);
  }
  if (fails.length) { console.log("OCR_FAIL\n - " + fails.join("\n - ")); process.exitCode = 1; }
  else console.log("OK OCR_OK");
  app.quit();
});
