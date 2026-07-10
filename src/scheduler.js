import { getProvider } from './providers/index.js';
import { listWatches, updateWatch } from './store/watches.js';
import { recordCheckResults } from './store/offers.js';

const MAX_PAIRS_PER_PROVIDER = 12; // cap origin x destination combinations per check, per provider

/**
 * Resolve origin/destination queries against every requested provider.
 * Returns { [providerId]: { origin: LocationMatch[], destination: LocationMatch[] } }.
 * A provider with an empty origin or destination list simply doesn't serve
 * that query (e.g. Ryanair for a Moscow origin) — not an error.
 */
export async function resolveForProviders(originQuery, destinationQuery, providerIds) {
  const resolved = {};
  for (const pid of providerIds) {
    const provider = getProvider(pid);
    if (!provider) continue;
    const [origin, destination] = await Promise.all([
      provider.resolveLocation(originQuery).catch(() => []),
      provider.resolveLocation(destinationQuery).catch(() => []),
    ]);
    resolved[pid] = { origin, destination };
  }
  return resolved;
}

// checkWatch reads-modifies-writes the shared offers/best_prices/pending JSON
// files (store/offers.js). Two checks running concurrently — e.g. the
// scheduler's background tick overlapping with an add_watch/force_check call —
// can race on those files and silently lose each other's writes. Everything
// that touches those files goes through this single process-wide queue so
// checks never interleave.
let lock = Promise.resolve();
function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
}

export async function checkWatch(watch, { log = () => {} } = {}) {
  return withLock(() => runCheck(watch, log));
}

async function runCheck(watch, log) {
  const allOffers = [];
  let truncatedAny = false;

  for (const pid of watch.providers) {
    const provider = getProvider(pid);
    const res = watch.resolved?.[pid];
    if (!provider || !res || !res.origin.length || !res.destination.length) continue;

    let pairs = [];
    for (const o of res.origin) for (const d of res.destination) pairs.push([o.code, d.code]);
    if (pairs.length > MAX_PAIRS_PER_PROVIDER) {
      truncatedAny = true;
      pairs = pairs.slice(0, MAX_PAIRS_PER_PROVIDER);
    }

    for (const [originCode, destinationCode] of pairs) {
      try {
        // Only pass currency when actually set — destructuring defaults like
        // `currency = 'RUB'` in the provider adapters only kick in for
        // `undefined`, not `null`, so an explicit `currency: null` here would
        // silently defeat every adapter's default and break the request.
        const params = { originCode, destinationCode, dateFrom: watch.dateFrom, dateTo: watch.dateTo };
        if (watch.currency) params.currency = watch.currency;

        const offers = await provider.searchFares(params);
        allOffers.push(...offers);
      } catch (err) {
        log(`[${pid}] ${originCode}->${destinationCode} failed: ${err.message}`);
      }
    }
  }

  const filtered = watch.maxPrice ? allOffers.filter((o) => o.price <= watch.maxPrice) : allOffers;
  const { newOffers, priceDrops } = recordCheckResults(watch.id, filtered);

  updateWatch(watch.id, { lastCheckedAt: new Date().toISOString() });

  return {
    watchId: watch.id,
    totalOffers: filtered.length,
    newCount: newOffers.length,
    priceDropCount: priceDrops.length,
    truncated: truncatedAny,
  };
}

export async function runAllWatches({ log = () => {} } = {}) {
  const watches = listWatches();
  const results = [];
  for (const watch of watches) {
    try {
      results.push(await checkWatch(watch, { log }));
    } catch (err) {
      log(`Watch ${watch.id} check failed: ${err.message}`);
    }
  }
  return results;
}

let timer = null;

export function startScheduler({ intervalMs = 60 * 60 * 1000, onTick = () => {}, log = () => {} } = {}) {
  if (timer) return;
  const tick = async () => {
    log(`Scheduler tick: checking ${listWatches().length} watch(es)...`);
    const results = await runAllWatches({ log });
    onTick(results);
  };
  // run once immediately, then on the interval
  tick();
  timer = setInterval(tick, intervalMs);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
