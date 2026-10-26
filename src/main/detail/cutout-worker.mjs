// 누끼 ONNX 일꾼 — 앱 실행 파일을 ELECTRON_RUN_AS_NODE 로 따로 띄워(child_process.fork) onnxruntime-node 로 전경 마스크만 계산한다(cutout-onnx.js 가 부름).
// utilityProcess 는 Chromium 메모리 상한에 걸려 BiRefNet(8~9GB)이 코드 5로 죽어서(2026-10-23 실측) 일반 Node 프로세스로 띄운다.
// 큰 모델(BiRefNet 은 한 장에 메모리 8~9GB)이 앱 본체를 죽이지 않게 따로 돌리고, 작업이 끝나면 프로세스째 닫아 메모리를 돌려준다.
// 받는 말: { type:"load", file, cfg } → { type:"loaded" } | { type:"error" }
//          { type:"run", id, bgra(Uint8Array S×S×4), S } → { type:"mask", id, mask(Uint8Array S×S) }
import ort from "onnxruntime-node";
import { makeInputSquare, maskSquare } from "./cutout-core.js";

let session = null, cfg = null;
const port = { postMessage: (m) => process.send(m) };
process.on("disconnect", () => process.exit(0));
process.on("message", async (msg) => {
  const m = msg || {};
  try {
    if (m.type === "load") {
      cfg = m.cfg;
      session = await ort.InferenceSession.create(m.file, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
      port.postMessage({ type: "loaded" });
    } else if (m.type === "run") {
      const S = cfg.size, inp = makeInputSquare(m.bgra, S, cfg);
      const res = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", inp, [1, 3, S, S]) });
      port.postMessage({ type: "mask", id: m.id, mask: maskSquare(res[session.outputNames[0]].data, S, cfg) });
    }
  } catch (err) { port.postMessage({ type: "error", id: m.id, error: String(err?.message || err).slice(0, 200) }); }
});
