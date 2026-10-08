// 🌐 중국어 → 한글 번역 (1688 채팅 동시 번역용)
// DeepL 키가 있으면 DeepL(설정 deeplKey 또는 환경변수 DEEPL_KEY), 없으면 구글 번역 무료 주소를 쓴다.
// 같은 문장은 저장해 두고 다시 묻지 않는다(채팅 화면을 몇 초마다 다시 읽어도 요청이 늘지 않게).
import { net } from "electron";

const MAX_CACHE = 3000;
// 1688 용어집: 번역기가 자주 틀리는 말은 번역 전에 한글로 바꿔 둔다(번역기는 한글을 그대로 둔다)
// 예) 回头率 → 구글은 "반품률"로 오역 — 실제 뜻은 재구매율
const GLOSSARY = [
  ["回头率", "재구매율"], ["复购率", "재구매율"], ["实力商家", "실력상가"], ["源头工厂", "제조사 직영"], ["源头厂家", "제조사 직영"], ["严选", "엄선"],
  ["超级工厂", "슈퍼 공장"], ["深度验厂", "심층 공장 인증"], ["诚信通", "청신통(1688 유료 회원)"], ["一件代发", "1개 위탁배송"], ["起批", "최소 주문"],
  ["混批", "혼합 주문"], ["包邮", "무료배송"], ["现货", "재고 있음"], ["已售", "판매"], ["成交", "거래"], ["揽收率", "집하율"], ["响应率", "응답률"],
  ["旺旺", "왕왕(채팅)"], ["外箱", "외박스"], ["箱规", "박스 규격"], ["装箱数", "박스 입수량"], ["一箱", "한 박스"],
];
const prep = (t) => GLOSSARY.reduce((s, [zh, ko]) => s.split(zh).join(ko), t);

export function initTranslate({ store, log }) {
  const cache = new Map(Object.entries(store.get("trCache") || {}));
  let saveTimer = null, warned = false;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const e = [...cache.entries()];
      store.set("trCache", Object.fromEntries(e.slice(Math.max(0, e.length - MAX_CACHE))));
    }, 2000);
  };
  const key = () => (store.get("settings") || {}).deeplKey || process.env.DEEPL_KEY || "";

  async function deepl(texts) {
    const k = key();
    const host = /:fx$/.test(k) ? "https://api-free.deepl.com" : "https://api.deepl.com";
    const r = await net.fetch(`${host}/v2/translate`, {
      method: "POST", headers: { Authorization: `DeepL-Auth-Key ${k}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: texts.map(prep), source_lang: "ZH", target_lang: "KO" }),
    });
    if (!r.ok) throw new Error(`DeepL 응답 ${r.status}`);
    const j = await r.json();
    return (j.translations || []).map((t) => t.text);
  }
  async function google(text) {
    const u = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=ko&dt=t&q=${encodeURIComponent(prep(text))}`;
    const r = await net.fetch(u);
    if (!r.ok) throw new Error(`구글 번역 응답 ${r.status}`);
    const j = await r.json();
    return (j?.[0] || []).map((x) => x?.[0] || "").join("");
  }

  // texts → 같은 순서의 한글(실패한 것은 "")
  async function translate(texts) {
    const src = [...new Set((texts || []).map((t) => String(t || "").trim()).filter((t) => t && t.length <= 600))];
    // 용어집만으로 다 바뀌는 짧은 말(배지 등)은 번역기에 보내지 않는다 — 번역기가 한글을 다시 바꿔 버림(실력상가→기술상가)
    src.forEach((t) => { if (!cache.has(t)) { const p = prep(t); if (!/[\u4e00-\u9fff]/.test(p)) cache.set(t, p); } });
    const todo = src.filter((t) => !cache.has(t)).slice(0, 40);
    if (todo.length) {
      try {
        if (key()) (await deepl(todo)).forEach((ko, i) => ko && cache.set(todo[i], ko));
        else for (let i = 0; i < todo.length; i += 4) { // 구글: 4개씩 동시에
          const part = todo.slice(i, i + 4);
          (await Promise.all(part.map((t) => google(t).catch(() => "")))).forEach((ko, j) => ko && cache.set(part[j], ko));
        }
        save();
      } catch (e) { if (!warned) { warned = true; log("dim", `  🌐 번역 실패: ${e?.message || e}`); } }
    }
    return (texts || []).map((t) => cache.get(String(t || "").trim()) || "");
  }
  return { translate, engine: () => (key() ? "DeepL" : "구글 번역") };
}
