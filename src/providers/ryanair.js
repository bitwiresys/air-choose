// Ryanair adapter. Confirmed 2026-07-09: fully open, no auth needed.
//   GET https://www.ryanair.com/api/booking/v4/en-gb/availability
//   GET https://www.ryanair.com/api/views/locate/5/airports/en/active  (public airport list, no auth)
//
// Coverage: Europe only. Searching a route Ryanair doesn't fly just returns
// an empty result — that's normal, not an error.

import { getJson, cached } from '../lib/http.js';
import { countryNameToIso2 } from '../lib/countries.js';
import { cityOverride } from '../lib/cities.js';

export const id = 'ryanair';
export const name = 'Ryanair';
export const requiresBrowserSession = false;
export const region = 'Europe';

const AIRPORTS_URL = 'https://www.ryanair.com/api/views/locate/5/airports/en/active';

async function getAirports() {
  return cached('ryanair:airports', 6 * 60 * 60 * 1000, () => getJson(AIRPORTS_URL));
}

export async function resolveLocation(query) {
  const override = cityOverride(query, id);
  if (override) return [{ code: override, label: query, kind: 'airport' }];

  const airports = await getAirports();
  const q = query.trim().toUpperCase();

  if (/^[A-Z]{3}$/.test(q)) {
    const match = airports.find((a) => a.code === q);
    if (match) return [{ code: match.code, label: `${match.name} (${match.code})`, kind: 'airport' }];
  }

  const iso2 = countryNameToIso2(query);
  if (iso2) {
    const matches = airports.filter((a) => a.country.code.toUpperCase() === iso2);
    return matches.map((a) => ({ code: a.code, label: `${a.name}, ${a.country.name}`, kind: 'airport' }));
  }

  return [];
}

function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

/** Step through [dateFrom, dateTo] in 4-day strides, each call covers a ±2 day flex window. */
function buildSearchDates(dateFrom, dateTo) {
  const dates = [];
  let cur = new Date(dateFrom + 'T00:00:00Z');
  const end = new Date(dateTo + 'T00:00:00Z');
  while (cur <= end) {
    dates.push(dateStr(cur));
    cur = new Date(cur.getTime() + 4 * 24 * 60 * 60 * 1000);
  }
  return dates;
}

export async function searchFares({ originCode, destinationCode, dateFrom, dateTo }) {
  const offers = [];
  const seenFlightKeys = new Set();

  for (const dateOut of buildSearchDates(dateFrom, dateTo)) {
    const url =
      `https://www.ryanair.com/api/booking/v4/en-gb/availability` +
      `?ADT=1&TEEN=0&CHD=0&INF=0&Origin=${originCode}&Destination=${destinationCode}` +
      `&promoCode=&IncludeConnectingFlights=false&DateOut=${dateOut}&DateIn=` +
      `&FlexDaysBeforeOut=2&FlexDaysOut=2&FlexDaysBeforeIn=2&FlexDaysIn=2` +
      `&RoundTrip=false&IncludePrimeFares=false&ToUs=AGREED`;

    let data;
    try {
      data = await getJson(url);
    } catch {
      continue; // route/date genuinely has nothing, or a transient error — skip
    }

    const currency = data.currency;
    for (const trip of data.trips || []) {
      for (const dateEntry of trip.dates || []) {
        for (const flight of dateEntry.flights || []) {
          if (seenFlightKeys.has(flight.flightKey)) continue;
          seenFlightKeys.add(flight.flightKey);

          const fare = flight.regularFare?.fares?.find((f) => f.type === 'ADT');
          if (!fare) continue;
          const segment = flight.segments?.[0];

          offers.push({
            provider: id,
            origin: segment?.origin || originCode,
            destination: segment?.destination || destinationCode,
            departureDate: (segment?.time?.[0] || dateEntry.dateOut).slice(0, 10),
            departureTime: segment?.time?.[0] || null,
            arrivalTime: segment?.time?.[1] || null,
            price: fare.amount,
            currency,
            airline: 'FR',
            flightNumber: segment?.flightNumber || null,
            stops: (flight.segments?.length || 1) - 1,
            transportKind: 'airplane',
            extra: { faresLeft: flight.faresLeft, duration: segment?.duration },
          });
        }
      }
    }
  }

  return offers;
}
