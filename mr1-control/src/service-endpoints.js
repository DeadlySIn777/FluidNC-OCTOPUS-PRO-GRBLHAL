export const COMPANION_TOKEN_STORAGE_KEY = "mr1-control.companion-token.v1";

const COMPANION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

function storageGet(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function storageSet(storage, key, value) {
  try {
    storage?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function validCompanionToken(value) {
  return COMPANION_TOKEN_PATTERN.test(String(value ?? ""));
}

export function serviceHostname(locationLike = globalThis.location) {
  const hostname = String(locationLike?.hostname ?? "").trim();
  if (!hostname || hostname === "0.0.0.0") return "127.0.0.1";
  return hostname;
}

export function serviceOrigin(locationLike = globalThis.location, port = 8787) {
  if (locationLike?.search && new URLSearchParams(locationLike.search).get('native') === '1') {
    const origin = String(locationLike.origin ?? '');
    if (/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) return origin;
  }
  const hostname = serviceHostname(locationLike);
  const host = hostname.includes(":") ? `[${hostname}]` : hostname;
  return `http://${host}:${Number(port)}`;
}

export function loadCompanionToken(storage = globalThis.localStorage) {
  const token = storageGet(storage, COMPANION_TOKEN_STORAGE_KEY);
  return validCompanionToken(token) ? token : null;
}

export function captureCompanionToken(options = {}) {
  const locationLike = options.location ?? globalThis.location;
  const historyLike = options.history ?? globalThis.history;
  const storage = options.storage ?? globalThis.localStorage;
  if (!locationLike?.href) return loadCompanionToken(storage);

  let url;
  try {
    url = new URL(locationLike.href);
  } catch {
    return loadCompanionToken(storage);
  }
  const candidate = url.searchParams.get("pair");
  if (!validCompanionToken(candidate)) return loadCompanionToken(storage);

  storageSet(storage, COMPANION_TOKEN_STORAGE_KEY, candidate);
  url.searchParams.delete("pair");
  try {
    historyLike?.replaceState?.(historyLike.state ?? null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Pairing still succeeds when embedded browsers do not expose replaceState.
  }
  return candidate;
}

export function serviceEndpoint(path, options = {}) {
  const locationLike = options.location ?? globalThis.location;
  const storage = options.storage ?? globalThis.localStorage;
  const endpoint = new URL(path, `${serviceOrigin(locationLike, options.port ?? 8787)}/`);
  const token = options.token ?? loadCompanionToken(storage);
  if (validCompanionToken(token)) endpoint.searchParams.set("pair", token);
  return endpoint.href;
}

export function companionMode(locationLike = globalThis.location, matchMedia = globalThis.matchMedia) {
  try {
    if (new URLSearchParams(locationLike?.search ?? "").get("companion") === "1") return true;
  } catch {
    // A malformed ambient location simply falls back to display-mode detection.
  }
  try {
    return Boolean(matchMedia?.("(display-mode: standalone)")?.matches);
  } catch {
    return false;
  }
}
