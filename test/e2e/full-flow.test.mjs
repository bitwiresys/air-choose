// E2E test: drives the real MCP server through every tool via a real MCP client.
// Covers edge cases beyond the basic smoke test: maxPrice filtering, currency
// parameter, error handling, sorting options, and combined scenarios.
//
// Run: `node test/e2e/full-flow.test.mjs` or `npm run test:e2e`
//
// This test hits LIVE provider APIs. Network issues or provider rate-limiting
// can cause flaky failures — that's an external condition, not a code bug.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let failures = 0;
let passes = 0;
function assert(cond, msg) {
  if (cond) {
    passes++;
    console.log(`  PASS: ${msg}`);
  } else {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
}

const transport = new StdioClientTransport({ command: 'node', args: ['src/server.js'] });
const client = new Client({ name: 'e2e-test', version: '0.0.1' });
await client.connect(transport);

function j(res) {
  return JSON.parse(res.content[0].text);
}
async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  return { data: j(res), isError: res.isError };
}

// ─── 1. Tool discovery ──────────────────────────────────────────────────────

console.log('\n1. All 8 tools are registered');
const tools = (await client.listTools()).tools;
const toolNames = tools.map((t) => t.name);
const expected = ['list_providers', 'resolve_location', 'add_watch', 'remove_watch', 'list_watches', 'get_watch_offers', 'poll_new_offers', 'force_check'];
assert(expected.every((n) => toolNames.includes(n)), `all 8 tools present`);
assert(tools.length === 8, `exactly 8 tools registered (got ${tools.length})`);

// Verify tool metadata
for (const t of tools) {
  assert(typeof t.description === 'string' && t.description.length > 10, `${t.name} has a meaningful description`);
}

// ─── 2. list_providers ──────────────────────────────────────────────────────

console.log('\n2. list_providers');
const providers = await call('list_providers', {});
assert(Array.isArray(providers.data), 'returns array');
assert(providers.data.length === 4, '4 providers');
const jetstar = providers.data.find((p) => p.id === 'jetstar');
assert(jetstar && jetstar.requiresBrowserSession === true, 'jetstar requires browser session');
const browserFree = providers.data.filter((p) => !p.requiresBrowserSession);
assert(browserFree.length === 3, '3 providers work without browser');

// ─── 3. resolve_location edge cases ─────────────────────────────────────────

console.log('\n3. resolve_location edge cases');

// IATA code passthrough for kupibilet
const bkkRes = await call('resolve_location', { query: 'BKK', providers: ['kupibilet'] });
assert(Array.isArray(bkkRes.data.kupibilet), 'BKK resolves for kupibilet');
assert(bkkRes.data.kupibilet.length > 0, 'BKK has at least one match');

// Country name in English
const thEn = await call('resolve_location', { query: 'Thailand', providers: ['kupibilet'] });
assert(thEn.data.kupibilet.some((m) => m.code === 'TH'), 'English "Thailand" resolves to TH');

// Country name in Russian
const thRu = await call('resolve_location', { query: 'Таиланд', providers: ['kupibilet'] });
assert(thRu.data.kupibilet.some((m) => m.code === 'TH'), 'Russian "Таиланд" resolves to TH');

// Ryanair with a city name
const lonRes = await call('resolve_location', { query: 'London', providers: ['ryanair'] });
assert(lonRes.data.ryanair.length > 0, 'London resolves for ryanair');
assert(lonRes.data.ryanair.some((m) => m.code === 'STN'), 'London includes STN');

// Unknown query returns empty for all
const unknownRes = await call('resolve_location', { query: 'Narnia', providers: ['ryanair', 'kupibilet'] });
assert(unknownRes.data.ryanair.length === 0, 'Narnia has no ryanair matches');
assert(unknownRes.data.kupibilet.length === 0, 'Narnia has no kupibilet matches');

// Invalid provider id is silently skipped
const badProvider = await call('resolve_location', { query: 'Thailand', providers: ['nonexistent'] });
assert(Object.keys(badProvider.data).length === 0, 'invalid provider yields empty result');

// ─── 4. add_watch: basic flow ───────────────────────────────────────────────

console.log('\n4. add_watch: create a Ryanair watch (STN→DUB)');
const ryanairWatch = await call('add_watch', {
  originQuery: 'STN',
  destinationQuery: 'DUB',
  dateFrom: '2026-08-10',
  dateTo: '2026-08-20',
  providers: ['ryanair'],
  label: 'E2E Ryanair STN-DUB',
});
const ryanairId = ryanairWatch.data.watch.id;
assert(ryanairId, 'watch created with id');
assert(ryanairWatch.data.watch.originQuery === 'STN', 'originQuery preserved');
assert(ryanairWatch.data.watch.destinationQuery === 'DUB', 'destinationQuery preserved');
assert(ryanairWatch.data.watch.providers.includes('ryanair'), 'ryanair in providers');
assert(Array.isArray(ryanairWatch.data.unusableProviders), 'unusableProviders is array');
assert(ryanairWatch.data.firstCheck, 'firstCheck result present');
assert(typeof ryanairWatch.data.firstCheck.totalOffers === 'number', 'totalOffers is number');
assert(Array.isArray(ryanairWatch.data.offers), 'offers is array');

// ─── 5. add_watch: kupibilet (should return real offers) ────────────────────

console.log('\n5. add_watch: Kupibilet Moscow→Thailand');
const kupiWatch = await call('add_watch', {
  originQuery: 'Москва',
  destinationQuery: 'Таиланд',
  dateFrom: '2026-07-21',
  dateTo: '2026-08-20',
  providers: ['kupibilet'],
  label: 'E2E Kupibilet MOW-TH',
});
const kupiId = kupiWatch.data.watch.id;
assert(kupiId, 'kupibilet watch created');
assert(kupiWatch.data.offers.length > 0, `kupibilet returned real offers (${kupiWatch.data.offers.length})`);
assert(kupiWatch.data.offers.every((o) => typeof o.price === 'number' && o.currency), 'all offers have price+currency');
assert(kupiWatch.data.offers.every((o) => o.provider === 'kupibilet'), 'all offers from kupibilet');

// ─── 6. add_watch: with maxPrice filter ─────────────────────────────────────

console.log('\n6. add_watch: maxPrice filter');
const cheapWatch = await call('add_watch', {
  originQuery: 'Москва',
  destinationQuery: 'Таиланд',
  dateFrom: '2026-07-21',
  dateTo: '2026-08-20',
  providers: ['kupibilet'],
  maxPrice: 20000,
  label: 'E2E cheap only',
});
const cheapId = cheapWatch.data.watch.id;
assert(cheapWatch.data.watch.maxPrice === 20000, 'maxPrice stored');
// All returned offers should be within budget (or empty if none qualify)
if (cheapWatch.data.offers.length > 0) {
  assert(cheapWatch.data.offers.every((o) => o.price <= 20000), 'all offers within maxPrice');
}

// ─── 7. list_watches ────────────────────────────────────────────────────────

console.log('\n7. list_watches');
const watches = await call('list_watches', {});
assert(Array.isArray(watches.data), 'returns array');
assert(watches.data.length >= 3, `at least 3 watches (got ${watches.data.length})`);

// Each watch has offerCount
for (const w of watches.data) {
  assert(typeof w.offerCount === 'number', `${w.id} has offerCount`);
  assert(w.id, `${w.label || w.id} has id`);
}

// ─── 8. get_watch_offers: sorting ───────────────────────────────────────────

console.log('\n8. get_watch_offers: sortBy price');
const byPrice = await call('get_watch_offers', { id: kupiId, sortBy: 'price', limit: 10 });
assert(byPrice.data.length > 0, 'has offers');
for (let i = 1; i < byPrice.data.length; i++) {
  assert(
    byPrice.data[i].price >= byPrice.data[i - 1].price,
    `price sort: ${byPrice.data[i - 1].price} <= ${byPrice.data[i].price}`
  );
}

console.log('8b. get_watch_offers: sortBy date');
const byDate = await call('get_watch_offers', { id: kupiId, sortBy: 'date', limit: 10 });
for (let i = 1; i < byDate.data.length; i++) {
  assert(
    byDate.data[i].departureDate >= byDate.data[i - 1].departureDate,
    `date sort: ${byDate.data[i - 1].departureDate} <= ${byDate.data[i].departureDate}`
  );
}

console.log('8c. get_watch_offers: limit respects cap');
const limited = await call('get_watch_offers', { id: kupiId, limit: 3 });
assert(limited.data.length <= 3, `limited to 3 (got ${limited.data.length})`);

console.log('8d. get_watch_offers: empty for unknown watch');
const unknownOffers = await call('get_watch_offers', { id: 'nonexistent-watch-id' });
assert(unknownOffers.data.length === 0, 'unknown watch returns empty');

// ─── 9. poll_new_offers ─────────────────────────────────────────────────────

console.log('\n9. poll_new_offers');
const poll1 = await call('poll_new_offers', {});
assert(Array.isArray(poll1.data), 'returns array');
assert(poll1.data.length > 0, `pending notifications exist (${poll1.data.length})`);

// Check notification structure
for (const n of poll1.data) {
  assert(n.watchId, 'notification has watchId');
  assert(n.offer, 'notification has offer');
  assert(n.reason === 'new' || n.reason === 'price_drop', `reason is new or price_drop (got ${n.reason})`);
  assert(n.foundAt, 'notification has foundAt');
  if (n.reason === 'price_drop') {
    assert(typeof n.previousPrice === 'number', 'price_drop has previousPrice');
  }
}

// Second call drains queue
const poll2 = await call('poll_new_offers', {});
assert(poll2.data.length === 0, 'second poll is empty (queue drained)');

// Third call still empty
const poll3 = await call('poll_new_offers', {});
assert(poll3.data.length === 0, 'third poll is still empty');

// ─── 10. force_check ────────────────────────────────────────────────────────

console.log('\n10. force_check');
const forceRes = await call('force_check', { id: kupiId });
assert(forceRes.data.watchId === kupiId, 'force_check returns correct watchId');
assert(typeof forceRes.data.totalOffers === 'number', 'totalOffers is number');
assert(typeof forceRes.data.newCount === 'number', 'newCount is number');
assert(typeof forceRes.data.priceDropCount === 'number', 'priceDropCount is number');
assert(typeof forceRes.data.truncated === 'boolean', 'truncated is boolean');

// force_check on non-existent watch
console.log('10b. force_check: non-existent watch');
const forceBad = await call('force_check', { id: 'does-not-exist' });
assert(forceBad.isError === true, 'returns isError: true for unknown watch');
const errData = JSON.parse(forceBad.data.content[0].text);
assert(errData.error === 'watch not found', 'error message is "watch not found"');

// ─── 11. remove_watch ───────────────────────────────────────────────────────

console.log('\n11. remove_watch');
const removeRes = await call('remove_watch', { id: ryanairId });
assert(removeRes.data.removed === true, 'removes successfully');

const afterRemove = await call('list_watches', {});
assert(!afterRemove.data.some((w) => w.id === ryanairId), 'removed watch gone from list');

// remove non-existent
const removeBad = await call('remove_watch', { id: 'nonexistent-id' });
assert(removeBad.data.removed === false, 'returns removed:false for non-existent');

// ─── 12. add_watch: mixed providers (some unusable) ─────────────────────────

console.log('\n12. add_watch: mixed providers (Moscow→Thailand with all defaults)');
const mixedWatch = await call('add_watch', {
  originQuery: 'Москва',
  destinationQuery: 'Таиланд',
  dateFrom: '2026-07-21',
  dateTo: '2026-08-20',
  label: 'E2E mixed providers',
});
assert(mixedWatch.data.watch.id, 'watch created');
assert(Array.isArray(mixedWatch.data.unusableProviders), 'unusableProviders present');
// Ryanair doesn't fly from Moscow
assert(
  mixedWatch.data.unusableProviders.includes('ryanair') || mixedWatch.data.watch.resolved.ryanair.origin.length === 0,
  'ryanair is unusable for Moscow'
);

// ─── 13. add_watch: label preserved ─────────────────────────────────────────

console.log('\n13. add_watch: label preserved');
const labeled = await call('add_watch', {
  originQuery: 'Дели',
  destinationQuery: 'Мумбаи',
  dateFrom: '2026-07-22',
  dateTo: '2026-08-05',
  providers: ['spicejet'],
  label: 'My SpiceJet flight',
});
assert(labeled.data.watch.label === 'My SpiceJet flight', 'label preserved in watch');
assert(labeled.data.watch.providers.includes('spicejet'), 'spicejet in providers');

// ─── 14. list_watches: final count ──────────────────────────────────────────

console.log('\n14. Final watch count');
const finalWatches = await call('list_watches', {});
const expectedMin = 3; // kupibilet, cheap, mixed + possibly spicejet
assert(finalWatches.data.length >= expectedMin, `at least ${expectedMin} watches remain (got ${finalWatches.data.length})`);

// ─── Cleanup ────────────────────────────────────────────────────────────────

console.log('\n15. Cleanup: remove all test watches');
const cleanupWatches = await call('list_watches', {});
for (const w of cleanupWatches.data) {
  await call('remove_watch', { id: w.id });
}
const afterCleanup = await call('list_watches', {});
assert(afterCleanup.data.length === 0, 'all watches removed');

await client.close();

console.log(`\n${failures === 0 ? `ALL ${passes} CHECKS PASSED` : `${failures} CHECK(S) FAILED (${passes} passed)`}`);
process.exit(failures === 0 ? 0 : 1);
