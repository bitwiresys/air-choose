// Shared fetch helper. Node 22+ has global fetch built in.

const DEFAULT_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  accept: 'application/json',
};

// Status codes worth one retry: 409 shows up as a *transient* rate-limit-style
// response on at least Ryanair ("Availability declined") and Jetstar
// ("...Conflict") when hit too often in a short window — as opposed to some
// providers' *permanent* per-route 409 (route not flown), which a retry won't
// fix either way, so retrying costs one extra request at worst.
const RETRYABLE_STATUS = new Set([409, 429, 500, 502, 503, 504]);
const RETRY_DELAY_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function doFetch(url, options, { retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        const err = new Error(`${options.method || 'GET'} ${url} -> ${res.status}`);
        err.status = res.status;
        if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw err;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (err.name === 'AbortError' || attempt >= retries) throw err;
    }
  }
  throw lastErr;
}

export async function getJson(url, { headers = {}, timeoutMs = 15000, retries = 1 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await doFetch(url, { headers: { ...DEFAULT_HEADERS, ...headers }, signal: ctrl.signal }, { retries });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function postJson(url, body, { headers = {}, timeoutMs = 20000, retries = 1 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await doFetch(
      url,
      {
        method: 'POST',
        headers: { ...DEFAULT_HEADERS, 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      },
      { retries }
    );
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Simple in-memory TTL cache, used for provider airport/station reference lists
// (fetched once, reused across many resolveLocation calls instead of hitting the
// provider on every lookup).
const cache = new Map();

export async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await loader();
  cache.set(key, { value, at: Date.now() });
  return value;
}
