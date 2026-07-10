// Static city-name -> per-provider airport/city code overrides, for the common
// cases where a live lookup isn't available or a specific well-known hub is meant.
// This is intentionally small and curated, not a universal geocoder — extend as
// real usage surfaces gaps (agents should fall back to passing an explicit IATA
// code, e.g. "MOW" or "BKK", when a name isn't covered here).

export const CITY_OVERRIDES = {
  // query (lowercase RU/EN) -> { provider: code }
  'москва': { kupibilet: 'MOW' },
  'moscow': { kupibilet: 'MOW' },
  'санкт-петербург': { kupibilet: 'LED' },
  'питер': { kupibilet: 'LED' },
  'saint petersburg': { kupibilet: 'LED' },
  'st petersburg': { kupibilet: 'LED' },
  'сочи': { kupibilet: 'AER' },
  'адлер': { kupibilet: 'AER' },
  'sochi': { kupibilet: 'AER' },
  'лондон': { ryanair: 'STN' },
  'london': { ryanair: 'STN' },
  'дублин': { ryanair: 'DUB' },
  'dublin': { ryanair: 'DUB' },
  'сингапур': { jetstar: 'SIN' },
  'singapore': { jetstar: 'SIN' },
  'дели': { spicejet: 'DEL' },
  'delhi': { spicejet: 'DEL' },
  'мумбаи': { spicejet: 'BOM' },
  'mumbai': { spicejet: 'BOM' },
};

export function cityOverride(query, providerId) {
  const q = query.trim().toLowerCase();
  return CITY_OVERRIDES[q]?.[providerId] || null;
}
