// 설치 파일을 만들 때 src/hot-base.json 에 지금 시각(seq)을 적는다 — 이보다 오래된 "화면만 바로 업데이트"는 이 설치본에서 쓰지 않는다(boot.js · hot.js)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const f = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "hot-base.json");
fs.writeFileSync(f, JSON.stringify({ seq: Math.floor(Date.now() / 1000), at: new Date().toISOString() }) + "\n");
console.log("hot-base", fs.readFileSync(f, "utf8").trim());
