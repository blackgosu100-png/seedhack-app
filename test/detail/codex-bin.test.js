import test from "node:test"; import assert from "node:assert/strict";
import { codexCandidates, codexBin, codexSpawnPlan } from "../../src/main/detail/codex-bin.js";
test("윈도우: PATH 와 npm 전역 폴더에서 codex 를 찾는다", () => {
  const env = { PATH: "C:\\Windows;C:\\tools", APPDATA: "C:\\Users\\u\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" };
  const c = codexCandidates({ platform: "win32", env, home: "C:\\Users\\u" });
  assert.ok(c.includes("C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd")); assert.ok(c.includes("C:\\tools\\codex.exe"));
  assert.equal(codexBin({ platform: "win32", env, home: "C:\\Users\\u", isFile: (f) => f === "C:\\tools\\codex.cmd" }), "C:\\tools\\codex.cmd");
  assert.equal(codexBin({ platform: "win32", env, home: "C:\\Users\\u", isFile: () => false }), null);
});
test("맥: ChatGPT 앱 안의 codex 가 후보에 있다", () => { assert.ok(codexCandidates({ platform: "darwin", env: { PATH: "/usr/bin" }, home: "/Users/u" }).includes("/Applications/ChatGPT.app/Contents/Resources/codex")); });
test("윈도우 .cmd 는 셸로, 인자는 따옴표로 감싼다(빈칸 든 경로)", () => {
  const p = codexSpawnPlan("C:\\Users\\my name\\npm\\codex.cmd", ["exec", "-C", "C:\\tmp dir\\x"], { platform: "win32" });
  assert.equal(p.opts.shell, true); assert.equal(p.cmd, '"C:\\Users\\my name\\npm\\codex.cmd"'); assert.equal(p.args[2], '"C:\\tmp dir\\x"');
  assert.equal(codexSpawnPlan("C:\\x\\codex.exe", ["exec"], { platform: "win32" }).opts.shell, undefined);
  assert.equal(codexSpawnPlan("/a/codex", ["exec"], { platform: "darwin" }).cmd, "/a/codex");
});
