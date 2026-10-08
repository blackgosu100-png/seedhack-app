// 🖐 사람처럼 입력하기 — 페이지 안에 코드를 심어 누르지 않고, 크롬에 실제 마우스·키보드 입력을 보낸다(webContents.sendInputEvent).
// 페이지는 이 입력을 사람 입력과 똑같이(isTrusted) 받는다. 화면의 진짜 커서는 움직이지 않으므로 그동안 다른 작업을 해도 된다.
// 마우스는 곡선·들쭉날쭉한 속도로, 글자는 중국어 입력기처럼 몇 글자씩 끊어 넣는다.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const pos = new WeakMap(); // 화면별 마지막 마우스 위치

export const pause = (a, b) => sleep(Math.round(rnd(a, b)));

// 사각형 {x,y,w,h}(CSS px) 안쪽 가운데 60% 중 아무 점
export function pointIn(r) {
  return { x: r.x + r.w * rnd(0.3, 0.7), y: r.y + r.h * rnd(0.3, 0.7) };
}

export async function moveTo(wc, to) {
  const z = wc.getZoomFactor() || 1;
  const from = pos.get(wc) || { x: rnd(40, 300), y: rnd(40, 200) };
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(8, Math.min(40, Math.round(dist / rnd(14, 24))));
  // 2차 베지어: 직선에서 옆으로 살짝 휜 곡선
  const bend = rnd(-0.25, 0.25) * dist;
  const nx = -(to.y - from.y) / (dist || 1), ny = (to.x - from.x) / (dist || 1);
  const c = { x: (from.x + to.x) / 2 + nx * bend, y: (from.y + to.y) / 2 + ny * bend };
  for (let i = 1; i <= steps; i++) {
    const t0 = i / steps, t = t0 < 0.5 ? 2 * t0 * t0 : 1 - (-2 * t0 + 2) ** 2 / 2; // 천천히-빨리-천천히
    const x = (1 - t) ** 2 * from.x + 2 * (1 - t) * t * c.x + t ** 2 * to.x + rnd(-0.8, 0.8);
    const y = (1 - t) ** 2 * from.y + 2 * (1 - t) * t * c.y + t ** 2 * to.y + rnd(-0.8, 0.8);
    wc.sendInputEvent({ type: "mouseMove", x: Math.round(x * z), y: Math.round(y * z) });
    await sleep(rnd(6, 18));
  }
  pos.set(wc, to);
}

export async function click(wc, rect) {
  const p = pointIn(rect);
  await moveTo(wc, p);
  await pause(80, 260);
  const z = wc.getZoomFactor() || 1, x = Math.round(p.x * z), y = Math.round(p.y * z);
  wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  await pause(50, 130);
  wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
}

// 중국어 입력기처럼: 1~4글자씩 확정(문장부호에서 끊김), 사이사이 병음 치는 시간만큼 쉼
export async function typeText(wc, text) {
  const chunks = [];
  let buf = "";
  for (const ch of String(text)) {
    buf += ch;
    if (/[，。！？、；：,.!?]/.test(ch) || buf.length >= Math.round(rnd(1, 4))) { chunks.push(buf); buf = ""; }
  }
  if (buf) chunks.push(buf);
  for (const c of chunks) {
    await pause(180 * c.length, 380 * c.length + 200);
    wc.insertText(c);
    if (/[，。！？,.!?]$/.test(c) && Math.random() < 0.5) await pause(400, 1100); // 문장 끝에서 잠깐 생각
  }
}

export async function pressEnter(wc) {
  wc.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
  wc.sendInputEvent({ type: "char", keyCode: "\r" });
  await pause(40, 110);
  wc.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
}

// 마우스 휠: 한 번에 100px 안팎씩 여러 번(사람이 휠 돌리듯)
export async function wheel(wc, dy, at) {
  const z = wc.getZoomFactor() || 1;
  if (at) await moveTo(wc, at);
  const p = pos.get(wc) || at || { x: 400, y: 300 };
  let left = dy;
  while (Math.abs(left) > 20) {
    const step = Math.sign(left) * Math.min(Math.abs(left), rnd(80, 125));
    wc.sendInputEvent({ type: "mouseWheel", x: Math.round(p.x * z), y: Math.round(p.y * z), deltaX: 0, deltaY: -step, canScroll: true });
    left -= step;
    await sleep(rnd(30, 90));
  }
}
