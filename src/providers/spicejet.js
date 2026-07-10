// SpiceJet adapter. Runs on Navitaire dotREZ (confirmed via response
// metadata.documentation_url pointing at developer.navitaire.com). No login
// needed, but the reverse-proxy in front of spicejet.com requires a
// browser-shaped header set (sec-ch-ua*, sec-fetch-*, a Cookie header, matching
// User-Agent) or it 403s bare requests — confirmed live 2026-07-10. Flow:
//   1. POST /api/v1/token {} -> { data: { token } }, used as a raw Authorization
//      header value (no "Bearer " prefix — that's what the site itself sends).
//   2. POST /api/v2/search/lowfare -> ~7-day fare calendar per call, step
//      centerDate to cover the full requested range.
//   GET /api/v1/search/getStationDetails?getAllCities=true&getPopular=true for airports.
//
// Coverage: India-focused (SpiceJet's home market), some international routes.

import { getJson, postJson, cached } from '../lib/http.js';
import { countryNameToIso2 } from '../lib/countries.js';
import { cityOverride } from '../lib/cities.js';

export const id = 'spicejet';
export const name = 'SpiceJet';
export const requiresBrowserSession = false;
export const region = 'India';

const BASE = 'https://www.spicejet.com';

// Headers a bare HTTP client needs to send to avoid the 403 from SpiceJet's
// front-end proxy — reverse-engineered from a real browser session's request headers.
const BROWSER_LIKE_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  accept: '*/*',
  origin: BASE,
  referer: `${BASE}/`,
  os: 'desktop',
  'sec-ch-ua-platform': '"Windows"',
  'sec-ch-ua': '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
  'sec-ch-ua-mobile': '?0',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
  'accept-language': 'en-US,en;q=0.9',
  cookie: 'at_check=true',
};

async function getToken() {
  return cached('spicejet:token', 10 * 60 * 1000, async () => {
    const res = await postJson(`${BASE}/api/v1/token`, {}, { headers: BROWSER_LIKE_HEADERS });
    return res.data.token;
  });
}

async function getStations() {
  return cached('spicejet:stations', 6 * 60 * 60 * 1000, async () => {
    const res = await getJson(`${BASE}/api/v1/search/getStationDetails?getAllCities=true&getPopular=true`, {
      headers: BROWSER_LIKE_HEADERS,
    });
    // Response shape varies (popularStations, allStations, etc.) — walk the whole
    // tree and collect anything that looks like a station record.
    const found = [];
    (function walk(node) {
      if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (node && typeof node === 'object') {
        if (node.stationCode && node.locationDetails?.countryCode) {
          found.push({
            code: node.stationCode,
            name: node.fullName || node.shortName || node.stationCode,
            countryCode: node.locationDetails.countryCode,
            country: node.locationDetails.country,
          });
        } else {
          Object.values(node).forEach(walk);
        }
      }
    })(res);
    // dedupe by code
    const byCode = new Map(found.map((s) => [s.code, s]));
    return [...byCode.values()];
  });
}

export async function resolveLocation(query) {
  const override = cityOverride(query, id);
  if (override) return [{ code: override, label: query, kind: 'airport' }];

  const stations = await getStations();
  const q = query.trim().toUpperCase();

  if (/^[A-Z]{3}$/.test(q)) {
    const match = stations.find((s) => s.code === q);
    if (match) return [{ code: match.code, label: `${match.name} (${match.code})`, kind: 'airport' }];
  }

  const iso2 = countryNameToIso2(query);
  if (iso2) {
    const matches = stations.filter((s) => s.countryCode === iso2);
    return matches.map((s) => ({ code: s.code, label: `${s.name}, ${s.country}`, kind: 'airport' }));
  }

  return [];
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function searchFares({ originCode, destinationCode, dateFrom, dateTo, currency = 'INR' }) {
  const token = await getToken();
  const headers = { ...BROWSER_LIKE_HEADERS, authorization: token };
  const offers = [];
  const seenDates = new Set();

  let center = dateFrom;
  while (center <= dateTo) {
    let data;
    try {
      data = await postJson(
        `${BASE}/api/v2/search/lowfare`,
        {
          pax: { journeyClass: 'ff', adult: 1, child: 0, infant: 0, srCitizen: 0 },
          codes: { currency },
          origin: originCode,
          destination: destinationCode,
          centerDate: center,
        },
        { headers }
      );
    } catch {
      break; // route doesn't exist / transient error
    }

    for (const entry of data.data?.lowFareDateMarkets || []) {
      const departureDate = entry.departureDate.slice(0, 10);
      if (departureDate < dateFrom || departureDate > dateTo) continue;
      if (seenDates.has(departureDate)) continue;
      seenDates.add(departureDate);

      if (entry.lowestFareAmount?.fareAmount == null) continue; // no flight that day
      offers.push({
        provider: id,
        origin: entry.origin,
        destination: entry.destination,
        departureDate,
        departureTime: null, // lowfare is a calendar view; exact times need a follow-up availability call
        arrivalTime: null,
        price: entry.lowestFareAmount.fareAmount + (entry.lowestFareAmount.taxesAndFeesAmount || 0),
        currency: data.data.currencyCode || currency,
        airline: 'SG',
        flightNumber: null,
        stops: null,
        extra: {
          fareAmount: entry.lowestFareAmount.fareAmount,
          taxesAndFeesAmount: entry.lowestFareAmount.taxesAndFeesAmount,
        },
      });
    }

    center = addDays(center, 7);
  }

  return offers;
}
