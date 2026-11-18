// 👁 1688 추천 후보를 "사진으로" 확인 — 제목 글자만으로는 색·소재·종류를 못 가린다(투명 욕조 트레이 추천에 검정 트레이·음료 진열대가 섞임, 2026-11-18)
// 쿠팡 상품 사진(기준)과 후보 썸네일을 AI에게 직접 보여 주고 "같은 상품(종류·색·소재)인지"만 묻는다.
//   · 이 PC에 Claude CLI가 있으면(대표님 맥) CLI로: Read 도구만 허용 · 생각 끔 → 15초 안팎
//   · 없으면(수강생 PC) 서버 중계(detail/relay.js relayStructured · purpose "vision") — 글 속 사진 경로를 찾아 첨부해 보낸다
// 사진은 userData/vision/ 에 작은 JPG(긴 쪽 320px)로 잠깐 저장한다.
import { app, nativeImage } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cliPath } from "./ai-cli.js";
import { relayStructured, relayEnabled } from "./detail/relay.js";

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["n", "same", "why"],
    properties: { n: { type: "integer" }, same: { type: "string", enum: ["yes", "no", "unsure"] }, why: { type: "string" } } } } },
};
const SYSTEM = `당신은 소싱 담당자입니다. "기준 사진"(쿠팡에서 파는 내 상품)과 1688 후보 사진들을 직접 보고, 각 후보가 기준과 **같은 상품**인지 판정합니다.
같은 상품 = 상품 종류가 같고(예: 욕조 위에 걸치는 트레이), 눈에 보이는 색·소재가 같다(예: 투명 아크릴). 크기·무늬·구도·배경·소품 차이는 무시합니다.
- yes: 종류도 색·소재도 같다
- no: 종류가 다르다(진열대·수납함 등) 또는 색·소재가 뚜렷이 다르다(투명 ↔ 검정·나무·금속)
- unsure: 사진만으로 판단이 어렵다(여러 색 옵션이 한 사진에 있음 등)
why 는 한국어 12자 이내(예: "검정 트레이", "화장품 진열대", "투명 욕조 트레이").
반드시 JSON 하나만 출력: {"items":[{"n":1,"same":"yes|no|unsure","why":"…"}]}`;

const dir = () => { const d = path.join(app.getPath("userData"), "vision"); fs.mkdirSync(d, { recursive: true }); return d; };
function saveJpg(buf, file) {
  const im = nativeImage.createFromBuffer(buf); if (im.isEmpty()) return false;
  const { width: w, height: h } = im.getSize(), m = Math.max(w, h);
  const out = m > 320 ? im.resize(w >= h ? { width: 320, quality: "good" } : { height: 320, quality: "good" }) : im;
  fs.writeFileSync(file, out.toJPEG(82)); return true;
}
function viaCli({ text, timeoutMs }) {
  return new Promise((resolve) => {
    let out = "", done = false; const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const env = { ...process.env, MAX_THINKING_TOKENS: "0" }; delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT;
    let child; try { child = spawn(cliPath(), ["-p", "--output-format", "json", "--system-prompt", SYSTEM, "--allowedTools", "Read", "--no-session-persistence", "--model", "haiku"], { stdio: ["pipe", "pipe", "pipe"], env }); }
    catch (e) { return finish({ error: `CLI 실행 실패: ${e.message}` }); }
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ error: "사진 확인 시간 초과" }); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", (e) => { clearTimeout(timer); finish({ error: `CLI 실행 실패: ${e.message}` }); });
    child.on("close", () => {
      clearTimeout(timer);
      try { const j = JSON.parse(out); if (j.is_error) return finish({ error: String(j.result || "CLI 오류").slice(0, 160) });
        const t = String(j.result || ""); finish({ ok: true, result: JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)), model: "cli:haiku", costUsd: j.total_cost_usd ?? null }); }
      catch { finish({ error: "사진 확인 응답을 해석하지 못했습니다" }); }
    });
    child.stdin.end(text);
  });
}

// ref: Buffer(쿠팡 사진) · items: [{ offerId, title, img }] · fetchImg(url) → Buffer
// → { ok, items: [{ offerId, same, why }], model, ms } 또는 { error }
export async function visionCheck({ ref, name = "", items = [], fetchImg, log = () => {} } = {}) {
  const t0 = Date.now(), d = dir(), stamp = Date.now().toString(36);
  const refFile = path.join(d, `ref-${stamp}.jpg`);
  if (!ref || !saveJpg(ref, refFile)) return { error: "기준 사진이 없습니다" };
  const files = [refFile], rows = [];
  await Promise.all(items.slice(0, 8).map(async (it, i) => {
    try {
      const url = String(it.img || "").replace(/^\/\//, "https://").replace(/(\.(?:jpg|jpeg|png))_.*$/i, "$1") + "_220x220.jpg";
      const f = path.join(d, `c${i + 1}-${stamp}.jpg`);
      if (saveJpg(await fetchImg(url), f)) { files.push(f); rows[i] = { n: i + 1, offerId: it.offerId, file: f }; }
    } catch {}
  }));
  const list = rows.filter(Boolean);
  const clean = () => { for (const f of files) { try { fs.unlinkSync(f); } catch {} } };
  if (!list.length) { clean(); return { error: "후보 사진을 받지 못했습니다" }; }
  const text = [`기준 사진(내 상품${name ? ` · 쿠팡 상품명: ${name}` : ""}):`, refFile, "", "후보 사진:", ...list.flatMap((r) => [`후보 n=${r.n}`, r.file]), "", "위 사진 파일을 모두 열어 보고 판정하세요."].join("\n");
  let r;
  try {
    if (cliPath() && process.env.SEEDHACK_RELAY !== "server") r = await viaCli({ text, timeoutMs: 60000 });
    else if (relayEnabled()) r = await relayStructured({ system: SYSTEM, schema: SCHEMA, text, model: "haiku", allowedTools: ["Read"], purpose: "vision", timeoutMs: 60000, log });
    else r = { error: "AI 연결이 없습니다" };
  } catch (e) { r = { error: String(e?.message || e).slice(0, 160) }; }
  clean();
  if (!r?.ok) return { error: r?.error || "사진 확인 실패" };
  const out = (r.result?.items || []).map((x) => { const row = list.find((q) => q.n === Number(x.n)); return row ? { offerId: row.offerId, same: ["yes", "no", "unsure"].includes(x.same) ? x.same : "unsure", why: String(x.why || "").slice(0, 24) } : null; }).filter(Boolean);
  return { ok: true, items: out, model: r.model || "", ms: Date.now() - t0, costUsd: r.costUsd ?? null };
}
