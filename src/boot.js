// 씨드핵 시작점 — "화면만 바로 업데이트"(src/main/hot.js)로 받아 둔 새 코드가 있으면 그걸로, 없으면 설치본 코드로 켠다.
// 새 코드는 <userData>/hot/<seq>/ 에 src/·tools/ 를 통째로 둔다. 패키지(엑셀·누끼 엔진 등)는 설치본 것을 그대로 쓰도록 import 경로를 돌린다(module.registerHooks).
// 안전장치: 켤 때마다 trying 을 적고, 화면이 뜨면 hot.markGood() 이 지운다. trying 이 남은 채 다시 켜지면(켜다가 죽음) 그 버전은 버리고 설치본으로 켠다.
//   SEEDHACK_NO_HOT=1 — 새 코드 안 씀 · 개발 실행(설치본 아님)은 SEEDHACK_HOT=1 일 때만 씀
import { app } from "electron";
import fs from "node:fs";
import mod from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.dirname(here); // 설치본 앱 폴더(app.asar 또는 저장소)
let entry = pathToFileURL(path.join(here, "main", "main.js")).href;

try {
  const use = process.env.SEEDHACK_NO_HOT !== "1" && (app.isPackaged || process.env.SEEDHACK_HOT === "1");
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"));
  const base = (() => { try { return JSON.parse(fs.readFileSync(path.join(here, "hot-base.json"), "utf8")).seq || 0; } catch { return 0; } })();
  // app.getPath 는 ready 전에도 된다(userData 는 productName 기준). 하네스가 setPath 를 바꾸면 그걸 따른다
  const hotRoot = path.join(app.getPath("userData"), "hot"), stateF = path.join(hotRoot, "state.json");
  const st = use && fs.existsSync(stateF) ? JSON.parse(fs.readFileSync(stateF, "utf8")) : null;
  const cur = st?.current;
  if (cur && cur.seq > base && !(st.bad || []).includes(cur.seq) && (cur.minShell || 0) <= (pkg.seedhackShell || 0) && fs.existsSync(path.join(cur.dir, "src", "main", "main.js"))) {
    if (st.trying === cur.seq) { // 지난번 이 버전으로 켜다가 화면까지 못 감(켤 때마다 확인) → 버린다
      st.bad = [...new Set([...(st.bad || []), cur.seq])]; st.trying = null;
      fs.writeFileSync(stateF, JSON.stringify(st, null, 1));
    } else {
      st.trying = cur.seq;
      fs.writeFileSync(stateF, JSON.stringify(st, null, 1));
      const hotUrl = pathToFileURL(cur.dir + path.sep).href, appParent = pathToFileURL(path.join(appDir, "package.json")).href;
      mod.registerHooks({
        resolve(spec, ctx, next) { // 새 코드 안의 "exceljs" 같은 패키지 이름은 설치본 node_modules 에서 찾는다
          if (ctx.parentURL?.startsWith(hotUrl) && !/^(node:|electron$|\.|\/|[a-z]+:)/i.test(spec)) return next(spec, { ...ctx, parentURL: appParent });
          return next(spec, ctx);
        },
      });
      process.env.SEEDHACK_HOT_SEQ = String(cur.seq);
      process.env.SEEDHACK_HOT_LABEL = String(cur.label || cur.seq);
      entry = pathToFileURL(path.join(cur.dir, "src", "main", "main.js")).href;
    }
  }
} catch (e) { console.log("[hot] 새 코드 확인 실패 → 설치본으로", e?.message || e); }

// main.js 안에는 최상위 await 가 없다(whenReady 는 .then) — 그래서 여기서 기다려도 교착하지 않고, ready 전에 해야 하는 설정(setPath 등)도 제때 된다
await import(entry);
