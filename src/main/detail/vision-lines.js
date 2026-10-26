// Google Cloud Vision DOCUMENT_TEXT_DETECTION 결과(fullTextAnnotation) → 앱 OCR 상자 { x,y,w,h,text,conf,quad,angle,vertical? }
// 대시보드 web/src/lib/signal-relay.mjs visionLines 와 같은 코드(서버 중계·수강생 구글 직접 호출이 같은 상자를 내게) — 한쪽을 고치면 같이 고친다
const HAN = /[㐀-鿿豈-﫿぀-ヿ가-힯]/;
const BRK_LINE = new Set(['EOL_SURE_SPACE', 'LINE_BREAK']);
const BRK_SPACE = new Set(['SPACE', 'SURE_SPACE']);
const vxy = (v) => [Math.round(v?.x || 0), Math.round(v?.y || 0)];
// fullTextAnnotation → 줄 상자. 단어 사이 detectedBreak 로 줄을 나누고, 줄마다 네 꼭짓점(quad)·기울기(angle)·세로쓰기 여부를 낸다.
export function visionLines(fta) {
  const lines = [];
  for (const page of fta?.pages || []) for (const block of page.blocks || []) for (const para of block.paragraphs || []) {
    let cur = null;
    const flush = () => { if (cur && cur.text.trim()) lines.push(cur); cur = null; };
    for (const word of para.words || []) {
      const syms = word.symbols || [];
      if (!syms.length) continue;
      if (!cur) cur = { text: '', words: [], conf: [] };
      for (const s of syms) {
        cur.text += s.text || '';
        const br = s.property?.detectedBreak?.type;
        if (br && BRK_SPACE.has(br)) cur.text += ' ';
      }
      cur.words.push(word);
      cur.conf.push(Number(word.confidence ?? para.confidence ?? 1));
      const lastBr = syms[syms.length - 1]?.property?.detectedBreak?.type;
      if (lastBr && BRK_LINE.has(lastBr)) flush();
      else if (lastBr === 'HYPHEN') { cur.text += '-'; flush(); }
    }
    flush();
  }
  return lines.map((ln) => {
    const pts = ln.words.flatMap((w) => (w.boundingBox?.vertices || []).map(vxy));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
    const fw = ln.words[0].boundingBox?.vertices || [], lw = ln.words[ln.words.length - 1].boundingBox?.vertices || [];
    // 꼭짓점 순서: 글 방향 기준 왼위·오위·오아래·왼아래(Vision 규약) → 첫 단어의 0·3, 마지막 단어의 1·2
    const tl = vxy(fw[0]), bl = vxy(fw[3]), tr = vxy(lw[1]), br = vxy(lw[2]);
    let angle = (Math.atan2(tr[1] - tl[1], tr[0] - tl[0]) * 180) / Math.PI;
    const text = ln.text.replace(/\s+/g, ' ').trim();
    const nHan = Array.from(text).filter((c) => HAN.test(c)).length;
    const vertical = nHan >= 2 && (y1 - y0) > (x1 - x0) * 1.8; // 위→아래로 쌓인 글(세로쓰기)
    const box = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0), text, conf: Math.round((ln.conf.reduce((a, b) => a + b, 0) / ln.conf.length) * 1000) / 1000 };
    if (vertical) { box.vertical = true; box.text = text.replace(/\s/g, ''); }
    else if (Math.abs(angle) > 0.3 && Math.abs(angle) < 45) { box.quad = [tl[0], tl[1], tr[0], tr[1], br[0], br[1], bl[0], bl[1]]; box.angle = Math.round(angle * 10) / 10; }
    else { box.quad = [x0, y0, x1, y0, x1, y1, x0, y1]; box.angle = 0; }
    return box;
  });
}
