import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = new URL('../../data/', import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1');
const OFFERS_FILE = path.join(DATA_DIR, 'offers.json'); // { [watchId]: Offer[] }
const BEST_PRICE_FILE = path.join(DATA_DIR, 'best_prices.json'); // { [dedupeKey]: number }
const PENDING_FILE = path.join(DATA_DIR, 'pending.json'); // Notification[]

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function saveJson(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function dedupeKey(offer) {
  return [offer.provider, offer.origin, offer.destination, offer.departureDate, offer.flightNumber || '']
    .join('|');
}

export function getWatchOffers(watchId) {
  const all = loadJson(OFFERS_FILE, {});
  return all[watchId] || [];
}

/**
 * Store the results of a fresh check for a watch. Compares against the best
 * price seen so far per (provider/origin/destination/date/flight) and returns
 * which offers are genuinely new or represent a price drop, queuing them as
 * pending notifications.
 */
export function recordCheckResults(watchId, offers) {
  const allOffers = loadJson(OFFERS_FILE, {});
  const bestPrices = loadJson(BEST_PRICE_FILE, {});
  const pending = loadJson(PENDING_FILE, []);

  const newOffers = [];
  const priceDrops = [];

  for (const offer of offers) {
    const key = dedupeKey(offer);
    const prevBest = bestPrices[key];

    if (prevBest === undefined) {
      newOffers.push(offer);
      bestPrices[key] = offer.price;
      pending.push({ watchId, offer, reason: 'new', foundAt: new Date().toISOString() });
    } else if (offer.price < prevBest) {
      priceDrops.push({ offer, previousPrice: prevBest });
      bestPrices[key] = offer.price;
      pending.push({
        watchId,
        offer,
        reason: 'price_drop',
        previousPrice: prevBest,
        foundAt: new Date().toISOString(),
      });
    }
  }

  allOffers[watchId] = offers;
  saveJson(OFFERS_FILE, allOffers);
  saveJson(BEST_PRICE_FILE, bestPrices);
  saveJson(PENDING_FILE, pending);

  return { newOffers, priceDrops };
}

export function popPendingNotifications() {
  const pending = loadJson(PENDING_FILE, []);
  saveJson(PENDING_FILE, []);
  return pending;
}

export function peekPendingCount() {
  return loadJson(PENDING_FILE, []).length;
}

export function clearWatchData(watchId) {
  const allOffers = loadJson(OFFERS_FILE, {});
  delete allOffers[watchId];
  saveJson(OFFERS_FILE, allOffers);
}
