// 🌐 쿠팡 클린/숨은 세션용 프록시 파싱 · 로테이션 · 차단 쿨다운 관리 (순수 로직)
// 지원 형식:
//   - 1.2.3.4:8080
//   - http://1.2.3.4:8080 / https://1.2.3.4:8080 / socks5://1.2.3.4:1080
//   - http://user:pass@1.2.3.4:8080 / user:pass@1.2.3.4:8080
//   - 1.2.3.4:8080:user:pass / http://1.2.3.4:8080:user:pass

export const DEFAULT_COOLDOWN_MIN = 45;

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function normalizeScheme(raw) {
  const s = String(raw || "http").toLowerCase();
  if (s === "socks5h") return "socks5";
  if (s === "socks4a") return "socks4";
  if (s === "http" || s === "https" || s === "socks5" || s === "socks4") return s;
  return null;
}

function validPort(p) {
  const n = Number(p);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

function stripBrackets(h) {
  return h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
}

/**
 * 한 줄의 프록시 문자열을 파싱한다. 유효하지 않으면 null 반환.
 */
export function parseProxyLine(raw) {
  const line = String(raw || "").trim();
  if (!line || line.startsWith("#") || line.startsWith("//")) return null;

  let scheme = "http";
  let rest = line;
  const schemeMatch = rest.match(/^([a-z0-9]+):\/\/(.+)$/i);
  if (schemeMatch) {
    const norm = normalizeScheme(schemeMatch[1]);
    if (!norm) return null;
    scheme = norm;
    rest = schemeMatch[2].trim();
  }

  // 뒤쪽 슬래시/경로 제거 (단, 아이디/비밀번호가 포함된 경우 호스트 뒤쪽만 처리)
  let username = "";
  let password = "";
  let hostPort = rest;

  const atIdx = rest.lastIndexOf("@");
  if (atIdx > 0) {
    const authPart = rest.slice(0, atIdx);
    hostPort = rest.slice(atIdx + 1);
    const colonIdx = authPart.indexOf(":");
    if (colonIdx >= 0) {
      username = safeDecode(authPart.slice(0, colonIdx));
      password = safeDecode(authPart.slice(colonIdx + 1));
    } else {
      username = safeDecode(authPart);
    }
  } else {
    // host:port:user:pass 형식 지원 (비밀번호에 ':'가 들어갈 수 있으므로 앞 3개만 분리)
    const four = rest.match(/^(\[[^\]]+\]|[^:\s/]+):(\d{1,5}):([^:\s]+):(.+)$/);
    if (four) {
      hostPort = `${four[1]}:${four[2]}`;
      username = four[3];
      password = four[4];
    }
  }

  hostPort = hostPort.replace(/\/.*$/, "").trim();
  const hp = hostPort.match(/^(\[[^\]]+\]|[^:\s/]+):(\d{1,5})$/);
  if (!hp) return null;

  const hostRaw = hp[1];
  const host = stripBrackets(hostRaw);
  const port = validPort(hp[2]);
  if (!host || !port) return null;

  const formattedHost = host.includes(":") ? `[${host}]` : host;
  const proxyRules = `${scheme}://${formattedHost}:${port}`;
  const hasAuth = Boolean(username || password);
  const id = `${proxyRules}${username ? `#${username}` : ""}`;
  const label = `${scheme === "http" ? "" : `${scheme}://`}${formattedHost}:${port}${hasAuth ? " (인증)" : ""}`;

  return {
    id,
    label,
    scheme,
    host,
    port,
    username,
    password,
    hasAuth,
    proxyRules,
    socksAuthWarn: (scheme === "socks5" || scheme === "socks4") && hasAuth,
  };
}

/**
 * 여러 줄/쉼표/세미콜론으로 구분된 프록시 목록 문자열을 파싱한다.
 */
export function parseProxyList(text) {
  const rawLines = String(text || "").split(/[\r\n,;]+/);
  const proxies = [];
  const invalid = [];
  const seen = new Set();

  for (const r of rawLines) {
    const trimmed = r.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    const p = parseProxyLine(trimmed);
    if (!p) {
      invalid.push(trimmed);
      continue;
    }
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    proxies.push(p);
  }
  return { proxies, invalid };
}

/**
 * 설정 객체에서 정규화된 프록시 설정을 꺼낸다.
 */
export function normalizeProxySettings(st = {}) {
  const { proxies, invalid } = parseProxyList(st.proxyList || "");
  const cooldownMin = Math.max(1, Math.min(1440, Math.round(Number(st.proxyCooldownMin) || DEFAULT_COOLDOWN_MIN)));
  return {
    enabled: Boolean(st.proxyEnabled),
    applyBg: st.proxyApplyBg !== false,
    noDirectFallback: st.proxyNoDirectFallback !== false,
    cooldownMin,
    cooldownMs: cooldownMin * 60 * 1000,
    rawList: String(st.proxyList || ""),
    proxies,
    invalid,
  };
}

/**
 * 만료된 차단 항목을 정리하고 현재 유효한 차단 맵을 반환한다.
 */
export function pruneBanned(bannedMap = {}, now = Date.now()) {
  const out = {};
  for (const [id, until] of Object.entries(bannedMap || {})) {
    if (typeof until === "number" && until > now) out[id] = until;
  }
  return out;
}

/**
 * 사용 가능한 프록시 중 다음 항목을 라운드 로빈으로 선택한다.
 * - 단일 프록시(1개)인 경우: 차단 상태여도 직결 폴백 대신 그 프록시를 유지하거나, 명시적 쿨다운 정보와 함께 반환.
 * - 다수 프록시(2개 이상)인 경우: 현재 차단되지 않은 프록시만 순환.
 */
export function selectNextProxy(settings, bannedMap = {}, cursor = 0, now = Date.now()) {
  const { enabled, proxies, noDirectFallback } = settings;
  if (!enabled) return { mode: "direct", proxy: null, nextCursor: cursor, reason: "disabled" };
  if (!proxies.length) {
    return noDirectFallback
      ? { mode: "blocked", proxy: null, nextCursor: cursor, reason: "empty" }
      : { mode: "direct", proxy: null, nextCursor: cursor, reason: "empty_fallback" };
  }

  const activeBans = pruneBanned(bannedMap, now);
  const available = proxies.filter((p) => !activeBans[p.id]);

  if (!available.length) {
    const soonestUntil = Math.min(...proxies.map((p) => activeBans[p.id] || now));
    const waitMs = Math.max(0, soonestUntil - now);
    if (noDirectFallback) {
      return { mode: "blocked", proxy: null, nextCursor: cursor, reason: "all_banned", waitMs };
    }
    return { mode: "direct", proxy: null, nextCursor: cursor, reason: "all_banned_fallback", waitMs };
  }

  const safeCursor = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0;
  // 전체 목록 기준 커서로 다음 사용 가능한 항목을 찾아야 밴 목록이 바뀌어도 편향되지 않는다
  for (let offset = 0; offset < proxies.length; offset++) {
    const idx = (safeCursor + offset) % proxies.length;
    const cand = proxies[idx];
    if (!activeBans[cand.id]) {
      return {
        mode: "proxy",
        proxy: cand,
        nextCursor: (idx + 1) % proxies.length,
        reason: "ok",
        availableCount: available.length,
        totalCount: proxies.length,
      };
    }
  }

  return { mode: "proxy", proxy: available[0], nextCursor: 1, reason: "ok", availableCount: available.length, totalCount: proxies.length };
}

/**
 * 현재 프록시 요약 상태(UI 표시용, 비밀번호 제외)를 생성한다.
 */
export function buildProxySummary(settings, bannedMap = {}, activeCleanProxy = null, now = Date.now()) {
  const activeBans = pruneBanned(bannedMap, now);
  const bannedList = settings.proxies
    .filter((p) => activeBans[p.id])
    .map((p) => ({
      id: p.id,
      label: p.label,
      until: activeBans[p.id],
      remainMin: Math.max(1, Math.ceil((activeBans[p.id] - now) / 60000)),
    }));
  const availableCount = settings.proxies.length - bannedList.length;
  return {
    enabled: settings.enabled,
    applyBg: settings.applyBg,
    noDirectFallback: settings.noDirectFallback,
    cooldownMin: settings.cooldownMin,
    totalCount: settings.proxies.length,
    availableCount,
    invalidCount: settings.invalid.length,
    invalidLines: settings.invalid.slice(0, 5),
    socksAuthWarnCount: settings.proxies.filter((p) => p.socksAuthWarn).length,
    banned: bannedList,
    activeLabel: activeCleanProxy?.label || null,
    activeId: activeCleanProxy?.id || null,
  };
}
