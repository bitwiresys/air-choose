// Jetstar (Asia-Pacific) adapter.
//   GET https://digitalapi.jetstar.com/v1/farecache/flights/batch/availability-with-fareclasses
//   GET https://digitalapi.jetstar.com/v1/resource/airports-and-terminals  (public, no cookies needed)
//
// CORRECTION (2026-07-10, later the same day): earlier recon via a real Chrome
// session (https_sniffer) saw clean 200s and concluded this needed no auth at
// all. Re-tested with a bare HTTP client (no browser, no cookies) and the
// farecache endpoint now 409s with `{"errorCode":"...Conflict"}`, and the
// response sets an `_abck`/`bm_sz` cookie pair — that's Akamai Bot Manager.
// It DOES gate this endpoint; the first test only worked because a real
// browser had already passed Akamai's JS challenge. The airports-and-terminals
// lookup still works fine without cookies (used for resolveLocation), but
// actual fare search needs a browser-derived session, same as AirAsia/IndiGo.
// Left wired up (still useful for one-off browser-assisted lookups / future
// improvement) but excluded from the default provider set for unattended
// hourly polling — see providers/index.js.

import { getJson, cached } from '../lib/http.js';
import { countryNameToIso2 } from '../lib/countries.js';
import { cityOverride } from '../lib/cities.js';

export const id = 'jetstar';
export const name = 'Jetstar Asia';
export const requiresBrowserSession = true;
export const region = 'Asia-Pacific';

const AIRPORTS_URL = 'https://digitalapi.jetstar.com/v1/resource/airports-and-terminals';
// digitalapi.jetstar.com requires this custom header on every call or it 400s — reverse-engineered
// from a real browser session, not documented anywhere public.
const JETSTAR_HEADERS = { culture: 'en-SG', origin: 'https://www.jetstar.com', referer: 'https://www.jetstar.com/' };

async function getAirports() {
  return cached('jetstar:airports', 6 * 60 * 60 * 1000, () => getJson(AIRPORTS_URL, { headers: JETSTAR_HEADERS }));
}

export async function resolveLocation(query) {
  const override = cityOverride(query, id);
  if (override) return [{ code: override, label: query, kind: 'airport' }];

  const airports = await getAirports();
  const q = query.trim().toUpperCase();

  if (/^[A-Z]{3}$/.test(q)) {
    const match = airports.find((a) => a.key === q);
    if (match) return [{ code: match.key, label: `${match.airportName} (${match.key})`, kind: 'airport' }];
  }

  const iso2 = countryNameToIso2(query);
  if (iso2) {
    const matches = airports.filter((a) => a.countryCode === iso2);
    return matches.map((a) => ({ code: a.key, label: `${a.airportName}, ${a.cityName}`, kind: 'airport' }));
  }

  return [];
}

/** First-of-month strings covering [dateFrom, dateTo], e.g. ["2026-07-01","2026-08-01"]. */
function monthStarts(dateFrom, dateTo) {
  const starts = [];
  const cur = new Date(dateFrom + 'T00:00:00Z');
  cur.setUTCDate(1);
  const end = new Date(dateTo + 'T00:00:00Z');
  while (cur <= end) {
    starts.push(cur.toISOString().slice(0, 10));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return starts;
}

export async function searchFares({ originCode, destinationCode, dateFrom, dateTo }) {
  const offers = [];
  const months = monthStarts(dateFrom, dateTo);

  for (const monthStart of months) {
    const monthEnd = new Date(monthStart + 'T00:00:00Z');
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    const end = monthEnd.toISOString().slice(0, 10);

    const url =
      `https://digitalapi.jetstar.com/v1/farecache/flights/batch/availability-with-fareclasses` +
      `?flightCount=1&includeSoldOut=true&requestType=StarterOnly&from=${monthStart}&end=${end}` +
      `&departures=${originCode}&arrivals=${destinationCode}&direction=outbound&paxCount=1&includeFees=true`;

    let data;
    try {
      data = await getJson(url, { headers: JETSTAR_HEADERS });
    } catch {
      continue; // 409 (route not flown) or transient error
    }

    for (const batch of Array.isArray(data) ? data : [data]) {
      const currency = batch.currencyCode;
      for (const flights of Object.values(batch.routes || {})) {
        for (const [dateKey, entries] of Object.entries(flights.flights || {})) {
          const departureDate = `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
          if (departureDate < dateFrom || departureDate > dateTo) continue;

          for (const flight of entries) {
            if (flight.price == null) continue; // no flight that day
            offers.push({
              provider: id,
              origin: originCode,
              destination: destinationCode,
              departureDate,
              departureTime: flight.departureTime || null,
              arrivalTime: flight.arrivalTime || null,
              price: flight.price,
              currency,
              airline: 'JQ',
              flightNumber: String(flight.flightId),
              stops: flight.stopCount ?? 0,
              extra: { soldOut: flight.soldOut, fareClasses: flight.fareClasses, member: flight.member },
            });
          }
        }
      }
    }
  }

  return offers;
}
