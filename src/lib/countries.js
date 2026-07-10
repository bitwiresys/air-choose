// Static country-name -> ISO 3166-1 alpha-2 lookup. Covers Russian and English
// names/aliases for the countries most relevant to the providers wired up here
// (Europe for Ryanair, Asia-Pacific for Jetstar, India for SpiceJet, worldwide
// for Kupibilet). Not exhaustive — extend as needed.
//
// Kupibilet accepts the ISO2 code directly as origin/destination (confirmed live:
// {"arrival":"TH"} returns real Thailand results). The other providers don't
// support country-level search directly, so resolveLocation() for them filters
// a live airport/station list by country code instead — see providers/*.js.

const NAME_TO_ISO2 = {
  // Russian names
  'таиланд': 'TH', 'тайланд': 'TH',
  'россия': 'RU',
  'турция': 'TR',
  'оаэ': 'AE', 'эмираты': 'AE',
  'индия': 'IN',
  'индонезия': 'ID',
  'вьетнам': 'VN',
  'малайзия': 'MY',
  'сингапур': 'SG',
  'филиппины': 'PH',
  'китай': 'CN',
  'япония': 'JP',
  'южная корея': 'KR', 'корея': 'KR',
  'великобритания': 'GB', 'англия': 'GB',
  'ирландия': 'IE',
  'франция': 'FR',
  'германия': 'DE',
  'испания': 'ES',
  'италия': 'IT',
  'португалия': 'PT',
  'греция': 'GR',
  'кипр': 'CY',
  'египет': 'EG',
  'грузия': 'GE',
  'армения': 'AM',
  'азербайджан': 'AZ',
  'узбекистан': 'UZ',
  'казахстан': 'KZ',
  'киргизия': 'KG', 'кыргызстан': 'KG',
  'таджикистан': 'TJ',
  'сербия': 'RS',
  'черногория': 'ME',
  'абхазия': 'AB',
  'мальдивы': 'MV',
  'шри-ланка': 'LK', 'шриланка': 'LK',
  'непал': 'NP',
  'австралия': 'AU',
  'новая зеландия': 'NZ',
  'сша': 'US', 'америка': 'US',
  'канада': 'CA',
  'бразилия': 'BR',
  'мексика': 'MX',
  'таити': 'PF',
  'бали': 'ID', // Bali is part of Indonesia, common shorthand

  // English names
  'thailand': 'TH',
  'russia': 'RU',
  'turkey': 'TR', 'turkiye': 'TR',
  'uae': 'AE', 'united arab emirates': 'AE',
  'india': 'IN',
  'indonesia': 'ID',
  'vietnam': 'VN',
  'malaysia': 'MY',
  'singapore': 'SG',
  'philippines': 'PH',
  'china': 'CN',
  'japan': 'JP',
  'south korea': 'KR', 'korea': 'KR',
  'united kingdom': 'GB', 'uk': 'GB', 'england': 'GB',
  'ireland': 'IE',
  'france': 'FR',
  'germany': 'DE',
  'spain': 'ES',
  'italy': 'IT',
  'portugal': 'PT',
  'greece': 'GR',
  'cyprus': 'CY',
  'egypt': 'EG',
  'georgia': 'GE',
  'armenia': 'AM',
  'azerbaijan': 'AZ',
  'uzbekistan': 'UZ',
  'kazakhstan': 'KZ',
  'kyrgyzstan': 'KG',
  'tajikistan': 'TJ',
  'serbia': 'RS',
  'montenegro': 'ME',
  'maldives': 'MV',
  'sri lanka': 'LK',
  'nepal': 'NP',
  'australia': 'AU',
  'new zealand': 'NZ',
  'usa': 'US', 'united states': 'US',
  'canada': 'CA',
  'brazil': 'BR',
  'mexico': 'MX',
};

/** Resolve a free-text country name/alias (RU or EN) to an ISO 3166-1 alpha-2 code, or null. */
export function countryNameToIso2(query) {
  const q = query.trim().toLowerCase();
  // Check the name map first — "uk" maps to "GB", which is the real ISO2 code,
  // so a naive 2-letter passthrough would return the wrong code.
  const fromMap = NAME_TO_ISO2[q];
  if (fromMap) return fromMap;
  if (/^[a-z]{2}$/i.test(q)) return q.toUpperCase(); // already a valid ISO2 code
  return null;
}
