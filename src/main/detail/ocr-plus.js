// v13.2 OCR 보강 — macOS Vision 가로 OCR 이 놓치는 두 경우를 한 번 더 읽는다(2026-10-13 슬라이서 737670160588)
//  1) 큰 숫자 배지 안 작은 한자: "2.5 刀距 mm" 를 통째 영문 상자 "2.52" 로 읽어 刀距 가 남던 것 → 큰 영문·숫자 상자(높이 ≥ 36px)를 2배로 키워 다시 읽고,
//     안에서 나온 한자 상자를 더하고 영문 상자는 그 앞까지로 줄인다
//  2) 세로쓰기(위→아래로 쌓인 글자): "一切成片", "品牌形象代言人" → image-core.verticalColumns 로 열을 찾아 글자 칸을 가로로 다시 놓고(restackColumn) 읽는다
// augmentOcr({ file, boxes }) → { boxes(새 배열: 원래 + 더한 것, 영문 상자 줄임 반영), added:[…] }. 실패해도 원래 상자 그대로
import { nativeImage } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBitmap } from "./image.js";
import { verticalColumns, restackColumn, hasCJK, cjkRatio, expandRect } from "./image-core.js";
import { ocrImages } from "./ocr.js";

const noop = () => {};
const hit = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 0 && h > 0 ? (w * h) / Math.min(a.w * a.h, b.w * b.h) : 0; };
const savePng = (bm, file, scale = 1) => { let im = nativeImage.createFromBitmap(Buffer.from(bm.data), { width: bm.w, height: bm.h }); if (scale !== 1) im = im.resize({ width: Math.round(bm.w * scale), quality: "best" }); fs.writeFileSync(file, im.toPNG()); };
const crop = (bm, r) => { const out = { w: r.w, h: r.h, data: Buffer.alloc(r.w * r.h * 4) }; for (let y = 0; y < r.h; y++) bm.data.copy(out.data, y * r.w * 4, ((r.y + y) * bm.w + r.x) * 4, ((r.y + y) * bm.w + r.x + r.w) * 4); return out; };

export async function augmentOcr({ file, boxes = [], log = noop, zoom = true, vertical = true, provider } = {}) {
  let bm; try { bm = loadBitmap(file); } catch { return { boxes, added: [] }; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seedhack-ocrplus-"));
  const out = boxes.map((b) => ({ ...b })), added = [];
  try {
    const jobs = [];
    if (zoom) out.forEach((b, k) => { if (!b.latin || b.h < 36) return; const r = expandRect(b, Math.round(b.h * 0.25), bm.w, bm.h); if (r.w < 8 || r.h < 8) return; const f = path.join(tmp, `z${k}.png`); savePng(crop(bm, r), f, 2); jobs.push({ kind: "zoom", k, r, f }); });
    const cols = vertical ? verticalColumns(bm, out) : [];
    cols.forEach((c, k) => { const rs = restackColumn(bm, c), f = path.join(tmp, `v${k}.png`); savePng(rs.bm, f, Math.max(1, Math.min(3, 48 / c.w))); /* 작은 글자는 키워서(글자 폭 48px 쯤) */ jobs.push({ kind: "vert", c, rs, f }); });
    if (!jobs.length) return { boxes: out, added };
    const res = await ocrImages(jobs.map((j, i) => ({ id: String(i), file: j.f })), { log: noop, ...(provider ? { provider } : {}) });
    jobs.forEach((j, i) => {
      const bx = (res.images.find((x) => x.id === String(i))?.boxes || []).filter((b) => hasCJK(b.text) && cjkRatio(b.text) > 0.5);
      if (j.kind === "zoom") {
        for (const b of bx) { if (Array.from(b.text.replace(/\s/g, "")).length < 2 && (b.conf ?? 1) < 0.5) continue; const nb = { x: Math.round(j.r.x + b.x / 2), y: Math.round(j.r.y + b.y / 2), w: Math.round(b.w / 2), h: Math.round(b.h / 2), text: b.text, conf: b.conf, zoom: true, text_ko: "" };
          if (out.some((o) => !o.latin && hit(o, nb) > 0.5)) continue;
          const lb = out[j.k], R0 = lb.x + lb.w, B0 = lb.y + lb.h; // 영문 상자는 한자 앞(뒤)까지 줄이고, 한자 아래로 이어지던 부분("mm")은 따로 남기는 상자로
          if (nb.x > lb.x + lb.w * 0.4) lb.w = Math.max(4, nb.x - lb.x - 2); else if (nb.x + nb.w < lb.x + lb.w * 0.6) { lb.x = nb.x + nb.w + 2; lb.w = Math.max(4, R0 - lb.x); }
          if (B0 > nb.y + nb.h + 4) out.push({ x: nb.x, y: nb.y + nb.h + 1, w: Math.max(4, Math.min(R0, nb.x + nb.w) - nb.x), h: B0 - (nb.y + nb.h) - 1, text: "", latin: true, split: true });
          if (nb.y > lb.y + 4) out.push({ x: nb.x, y: lb.y, w: Math.max(4, Math.min(R0, nb.x + nb.w) - nb.x), h: nb.y - lb.y - 1, text: "", latin: true, split: true });
          out.push(nb); added.push(nb); }
      } else {
        const ord = [...bx].sort((a, b) => a.x - b.x), text = ord.map((b) => b.text).join("").replace(/\s/g, ""), n = Array.from(text).filter((t) => hasCJK(t)).length, conf = ord.length ? ord.reduce((s, b) => s + (b.conf ?? 1), 0) / ord.length : 0;
        const real = new Set(Array.from(text).filter((t) => hasCJK(t) && !/[一丨丶ノ丿乀亅]/.test(t))); // 치수 눈금선을 "一一一一"로 읽는 것
        if (n < 2 || real.size < 2 || Math.abs(n - j.c.cells.length) > 1 || (conf < 0.5 && !(n >= 4 && n === j.c.cells.length))) return; // 사진 무늬를 글로 읽은 것 거르기(Vision 확신은 0.3/0.5/1 로 거칠다 — 글자 수가 칸 수와 딱 맞는 4자 이상은 받는다)
        const nb = { x: j.c.x, y: j.c.y, w: j.c.w, h: j.c.h, text, conf: +conf.toFixed(2), vertical: true, text_ko: "" };
        if (out.some((o) => hit(o, nb) > 0.5)) return;
        out.push(nb); added.push(nb);
      }
    });
    if (added.length) log("dim", `  🔎 ${path.basename(file)} OCR 보강 +${added.length} (${added.map((b) => `${b.vertical ? "세로 " : ""}${b.text}`).join(", ").slice(0, 80)})`);
  } catch (e) { log("dim", `  🔎 OCR 보강 실패 ${path.basename(file)} (${String(e?.message || e).slice(0, 80)})`); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  return { boxes: out, added };
}

// v13.2 이미지 경계에 걸쳐 잘린 글(1688 상세는 긴 그림을 여러 장으로 잘라 올려 글 한 줄이 두 장에 반씩 걸친다 — 슬라이서 d12→d13 "一个进料口，一种切片厚度"):
// 앞 장 아래 띠 + 다음 장 위 띠를 붙여 읽고, 경계에 걸친 한자 상자를 두 장에 나눠 넣는다. seam = 그 장에 보이는 글 높이 비율(0.6 미만이면 지우기만, 한글은 안 얹음)
// images: [{ id, file, w, h, boxes }](원본 순서) → 고친 boxes 를 제자리에 넣고 더한 개수를 돌려준다
export async function augmentSeams(images = [], { log = noop, band = 110 } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seedhack-seam-")), jobs = [];
  try {
    for (let i = 0; i + 1 < images.length; i++) {
      const A = images[i], B = images[i + 1]; if (!A?.file || !B?.file) continue;
      let a, b; try { a = loadBitmap(A.file); b = loadBitmap(B.file); } catch { continue; }
      if (a.w !== b.w) continue;
      const hb = Math.min(band, Math.floor(a.h * 0.2), Math.floor(b.h * 0.2)); if (hb < 20) continue;
      const strip = { w: a.w, h: hb * 2, data: Buffer.alloc(a.w * hb * 2 * 4) };
      a.data.copy(strip.data, 0, (a.h - hb) * a.w * 4, a.h * a.w * 4); b.data.copy(strip.data, hb * a.w * 4, 0, hb * a.w * 4);
      const f = path.join(tmp, `s${i}.png`); savePng(strip, f, 1); jobs.push({ A, B, hb, f, ah: a.h });
    }
    if (!jobs.length) return 0;
    const res = await ocrImages(jobs.map((j, i) => ({ id: String(i), file: j.f })), { log: noop });
    let n = 0;
    jobs.forEach((j, i) => {
      for (const t of (res.images.find((x) => x.id === String(i))?.boxes || []).filter((t) => hasCJK(t.text) && cjkRatio(t.text) > 0.5)) {
        if (!(t.y < j.hb - 2 && t.y + t.h > j.hb + 2)) continue; // 경계를 가로지르는 줄만(한쪽에만 있는 글은 그 장 OCR 이 이미 읽었다)
        const up = j.hb - t.y, down = t.y + t.h - j.hb, frac = (v) => +(v / t.h).toFixed(2);
        const ba = { x: t.x, y: j.ah - up, w: t.w, h: up, text: t.text, conf: t.conf, seam: frac(up), text_ko: "" }, bb = { x: t.x, y: 0, w: t.w, h: down, text: t.text, conf: t.conf, seam: frac(down), text_ko: "" };
        for (const [im, nb] of [[j.A, ba], [j.B, bb]]) { if (nb.h < 4 || (im.boxes || []).some((o) => hit(o, nb) > 0.5)) continue; (im.boxes ||= []).push(nb); n++; }
      }
    });
    if (n) log("dim", `  🔎 이미지 경계에 걸친 글 ${n}조각 더 읽음`);
    return n;
  } catch (e) { log("dim", `  🔎 경계 글 읽기 실패 (${String(e?.message || e).slice(0, 80)})`); return 0; }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}
