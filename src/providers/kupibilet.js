// Kupibilet adapter. Confirmed 2026-07-10: fully open, no auth/cookies needed,
// access-control-allow-origin: *, no CAPTCHA/WAF at all.
//   POST https://api-rs-lb.kupibilet.ru/frontend_search
//
// Accepts an ISO 3166-1 alpha-2 country code directly as origin/destination
// (confirmed live: {"arrival":"TH"} returns real Thailand results) as well as
// Kupibilet's own city codes (e.g. "MOW" for all Moscow airports). One call
// covers the *entire* requested date range. Train fares (transport_kind:
// "train") are filtered out — only airplane offers are returned.
//
// Coverage: Russia-market focused, but genuinely worldwide (any route Kupibilet
// itself sells).

import { postJson } from '../lib/http.js';
import { countryNameToIso2 } from '../lib/countries.js';
import { cityOverride } from '../lib/cities.js';

export const id = 'kupibilet';
export const name = 'Kupibilet';
export const requiresBrowserSession = false;
export const region = 'Russia / worldwide';

const HEADERS = {
  origin: 'https://www.kupibilet.ru',
  referer: 'https://www.kupibilet.ru/',
};

export async function resolveLocation(query) {
  const override = cityOverride(query, id);
  if (override) return [{ code: override, label: query, kind: 'city' }];

  const q = query.trim();
  if (/^[a-zA-Z]{3}$/.test(q)) {
    // Assume it's already a valid Kupibilet city/airport code (e.g. MOW, AER, BKK) —
    // there's no cheap way to validate this without a real typeahead endpoint, so
    // it's passed straight through.
    return [{ code: q.toUpperCase(), label: q.toUpperCase(), kind: 'city' }];
  }

  const iso2 = countryNameToIso2(query);
  if (iso2) {
    return [{ code: iso2, label: `${query} (country ${iso2})`, kind: 'country' }];
  }

  return [];
}

export async function searchFares({ originCode, destinationCode, dateFrom, dateTo, currency = 'RUB' }) {
  const body = {
    trips: [{ departure: originCode, arrival: destinationCode, date_range: { start: dateFrom, end: dateTo } }],
    travelers: { adult: 1, child: 0, infant: 0, childrenAges: [] },
    cabin: 'economy',
    agent: 'kup747',
    language: 'RU',
    currency,
    client_platform: 'web',
    filters: {},
    sort_by: 'price',
    short_response: true,
  };

  let data;
  try {
    data = await postJson('https://api-rs-lb.kupibilet.ru/frontend_search', body, { headers: HEADERS });
  } catch {
    return [];
  }

  const flights = data.flights || {};
  const offers = [];

  for (const variant of data.variants || []) {
    const flightIds = (variant.segments || []).flatMap((s) => s.flights || []);
    const legs = flightIds.map((fid) => flights[fid]).filter(Boolean);
    if (!legs.length) continue;

    // Skip train segments — only return airplane flights.
    if (legs.some((l) => l.transport_kind === 'train')) continue;

    legs.sort((a, b) => a.departure_datetime.localeCompare(b.departure_datetime));

    const first = legs[0];
    const last = legs[legs.length - 1];

    offers.push({
      provider: id,
      origin: first.departure,
      destination: last.arrival,
      departureDate: first.departure_datetime.slice(0, 10),
      departureTime: first.departure_datetime,
      arrivalTime: last.arrival_datetime,
      price: Number(variant.price.amount),
      currency: variant.price.currency,
      airline: first.marketing_carrier || first.operating_carrier || null,
      flightNumber: first.transport_number || String(first.number || ''),
      stops: legs.length - 1,
      extra: {
        baggage: variant.baggage,
        legCount: legs.length,
        allLegs: legs.map((l) => ({
          carrier: l.marketing_carrier,
          number: l.transport_number,
          from: l.departure,
          to: l.arrival,
          departure: l.departure_datetime,
          arrival: l.arrival_datetime,
        })),
      },
    });
  }

  return offers;
}
