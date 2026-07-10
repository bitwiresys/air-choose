# air_choose — technical API reference

This is the exhaustive reference: every MCP tool's exact input/output schema,
every data shape, error conventions, the resource/notification model, and the
provider adapter contract. If you're an agent being told "use the air_choose
MCP plugin," this document plus `list_providers`/`resolve_location` calls at
runtime is everything you need — you should not need to read the source.

For the narrative "what is this and why" version, see [README.md](README.md).

---

## 0. Mental model

1. A **watch** = one monitored route: an origin query, a destination query, a
   date range, and which providers to search. You create it with `add_watch`.
2. Every watch stores, per provider, the **resolved codes** for its origin and
   destination — resolution happens once, at `add_watch` time, not on every
   check. A provider with no matching codes for a query is simply dropped from
   that watch (it doesn't serve that place) — not an error.
3. A background scheduler re-checks every watch once an hour (configurable),
   independent of any tool call. `add_watch` and `force_check` also trigger an
   immediate check outside that cycle.
4. Every check diffs its results against the best price ever seen for each
   distinct (provider, origin, destination, date, flight) combination. A
   result that's either brand new or cheaper than the previous best gets
   queued as a **pending notification**. `poll_new_offers` drains that queue.
5. There is no push-to-agent mechanism that's guaranteed to work across hosts
   (see §5). Design your agent loop around calling `poll_new_offers` on a
   schedule.

---

## 1. Tools

All tools take a single JSON object as input (the fields below) and return
`{ content: [{ type: "text", text: "<JSON string>" }] }` — parse `content[0].text`
as JSON to get the structured result described under "Returns" for each tool.
None of these tools currently set `isError: true` except where noted.

### `list_providers`

No input.

**Returns** — `Provider[]`:
```jsonc
[
  { "id": "ryanair",   "name": "Ryanair",      "region": "Europe",             "requiresBrowserSession": false },
  { "id": "jetstar",   "name": "Jetstar Asia",  "region": "Asia-Pacific",       "requiresBrowserSession": true  },
  { "id": "kupibilet", "name": "Kupibilet",     "region": "Russia / worldwide", "requiresBrowserSession": false },
  { "id": "spicejet",  "name": "SpiceJet",      "region": "India",              "requiresBrowserSession": false }
]
```
`requiresBrowserSession: true` means this provider's fare-search endpoint is
gated by bot-detection (Akamai, in jetstar's case) that a plain HTTP client
can't pass — it will usually fail with an empty result. It's excluded from the
*default* provider set (see below) but can still be requested explicitly.

---

### `resolve_location`

Turn a place name into every provider's own codes. **Call this before
`add_watch`** for both origin and destination if you want to see what actually
got matched (`add_watch` does the same resolution internally and returns it in
its response too, so this is for inspection/debugging, not strictly required).

| Field | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Place name or code. Accepts: a 3-letter IATA code (`"BKK"`); a country name in Russian or English (`"Таиланд"`, `"Thailand"`); a handful of built-in city aliases (Moscow, St Petersburg, Sochi, London, Dublin, Singapore, Delhi, Mumbai — see `src/lib/cities.js`) |
| `providers` | string[] | no | Provider ids to resolve against. Default: providers with `requiresBrowserSession: false` (currently `["ryanair","kupibilet","spicejet"]`) |

**Returns** — `Record<providerId, LocationMatch[] | {error: string}>`:
```jsonc
{
  "kupibilet": [
    { "code": "TH", "label": "Таиланд (country TH)", "kind": "country" }
  ],
  "spicejet": [
    { "code": "BKK", "label": "Bangkok, Thailand", "kind": "airport" },
    { "code": "HKT", "label": "Phuket, Thailand", "kind": "airport" }
  ],
  "ryanair": []
}
```
An empty array for a provider means it genuinely has no match for that query —
either it doesn't serve that place at all, or (rarely) the query didn't match
anything in that provider's own airport/country list. `{"error": "..."}`
instead of an array means the provider's lookup itself failed (network error,
unexpected response shape) — distinguish this from "legitimately no match."

`LocationMatch` shape:
```ts
{ code: string; label: string; kind: 'airport' | 'city' | 'country' }
```
`code` is always what you'd pass as `originCode`/`destinationCode` to that
provider's `searchFares` — but you never call that directly; `add_watch`/the
scheduler does. `kind: 'country'` (Kupibilet only) means `code` is an ISO
3166-1 alpha-2 country code being passed straight through, not a single
airport — Kupibilet's own backend expands it.

---

### `add_watch`

Adds a route to monitor. Resolves locations for the requested providers
immediately, keeps only providers where *both* origin and destination
resolved to something, stores the watch, and runs an immediate first check —
so the response already contains real offers, you don't have to wait for the
hourly cycle.

| Field | Type | Required | Description |
|---|---|---|---|
| `originQuery` | string | yes | e.g. `"Москва"`, `"Moscow"`, `"MOW"` |
| `destinationQuery` | string | yes | e.g. `"Таиланд"`, `"Thailand"`, `"BKK"` |
| `dateFrom` | string | yes | `YYYY-MM-DD`, inclusive |
| `dateTo` | string | yes | `YYYY-MM-DD`, inclusive |
| `providers` | string[] | no | Default: `["ryanair","kupibilet","spicejet"]` (browser-session-free providers). Pass `["jetstar"]` explicitly to include it anyway |
| `maxPrice` | number | no | Drop offers priced above this (compared in each provider's own currency — see §4 caveat) |
| `currency` | string | no | Currency code hint, honored only by providers that support choosing one (Kupibilet, SpiceJet); ignored by the others. Every offer always carries its own actual `currency` field regardless — read that, don't assume |
| `label` | string | no | Free-text note to help a human/agent recognize this watch later |

**Returns**:
```ts
{
  watch: Watch;                    // the stored watch record, see §2
  unusableProviders: string[];     // requested providers that had no match for origin AND/OR destination
  firstCheck: CheckResult;         // see force_check's return shape, §1
  offers: Offer[];                 // up to 30, sorted by price ascending, from the immediate first check
}
```

Example call and response for the Moscow → Thailand case (abridged):
```jsonc
// call
{ "originQuery": "Москва", "destinationQuery": "Таиланд", "dateFrom": "2026-07-21", "dateTo": "2026-08-20" }

// response (abridged)
{
  "watch": {
    "id": "1f55fa3a-...", "providers": ["kupibilet"],
    "resolved": {
      "ryanair":   { "origin": [], "destination": [] },
      "kupibilet": { "origin": [{"code":"MOW", ...}], "destination": [{"code":"TH", "kind":"country", ...}] },
      "spicejet":  { "origin": [], "destination": [{"code":"BKK", ...}, {"code":"HKT", ...}] }
    }
  },
  "unusableProviders": ["ryanair", "spicejet"],
  "firstCheck": { "watchId": "1f55fa3a-...", "totalOffers": 100, "newCount": 57, "priceDropCount": 0, "truncated": false },
  "offers": [ { "provider": "kupibilet", "origin": "SVO", "destination": "BKK", "price": 23055, "currency": "RUB", ... } ]
}
```
Note `ryanair` and `spicejet` ended up in `unusableProviders` — Ryanair has no
Moscow routes at all (`resolved.ryanair.origin` is empty), and SpiceJet
resolved Thailand fine but had no match for `"Москва"` as an origin (SpiceJet
is India-focused; only `kupibilet.origin` matched). `watch.providers` (the
list actually *searched* going forward, including on future hourly checks)
only contains `"kupibilet"` as a result — this is the field the scheduler
reads, not the tool call's input `providers` array.

---

### `remove_watch`

| Field | Type | Required |
|---|---|---|
| `id` | string | yes |

**Returns**: `{ "removed": boolean }` — `false` if no watch had that id (not
an error, just a no-op).

---

### `list_watches`

No input.

**Returns** — `(Watch & { offerCount: number })[]` — every stored watch (see
§2 for the `Watch` shape) plus how many offers are currently known for it.

---

### `get_watch_offers`

| Field | Type | Required | Default |
|---|---|---|---|
| `id` | string | yes | — |
| `sortBy` | `"price"` \| `"date"` | no | `"price"` |
| `limit` | number | no | `50` |

**Returns**: `Offer[]` (see §3) — the current snapshot from the most recent
check for that watch (hourly, or forced). Empty array if the watch id doesn't
exist or has no offers yet.

---

### `poll_new_offers`

**The tool your agent's own wake-up loop should call.** No input.

**Returns** — `Notification[]`, and **clears the queue** as a side effect
(calling it twice in a row returns `[]` the second time):
```ts
{
  watchId: string;
  offer: Offer;
  reason: 'new' | 'price_drop';
  previousPrice?: number;  // only present when reason === 'price_drop'
  foundAt: string;         // ISO 8601 timestamp
}[]
```
"New" means this exact (provider, origin, destination, departureDate,
flightNumber) combination has never been seen before, on any watch. "Price
drop" means it has been seen before, at a higher price than this result.
Both are queued the moment a check finds them — from the hourly scheduler,
from `add_watch`'s immediate check, or from `force_check`. If you never call
this, the queue just grows in `data/pending.json` until you do.

---

### `force_check`

| Field | Type | Required |
|---|---|---|
| `id` | string | yes |

**Returns** on success — `CheckResult`:
```ts
{
  watchId: string;
  totalOffers: number;    // offers found this check, after maxPrice filtering
  newCount: number;       // of those, how many were queued as "new"
  priceDropCount: number; // of those, how many were queued as "price_drop"
  truncated: boolean;     // true if this watch had more than 12 origin×destination
                           // airport pairs to search and some were skipped (see §6)
}
```
**Returns** on failure (unknown id) — `isError: true` with
`content: [{ type: "text", text: '{"error":"watch not found"}' }]`. This is
the only tool that currently sets `isError`.

---

## 2. The `Watch` object

This is exactly what's persisted in `data/watches.json` and returned by
`add_watch`/`list_watches`:

```ts
{
  id: string;                    // UUID, assigned by add_watch
  createdAt: string;             // ISO 8601
  lastCheckedAt: string | null;  // ISO 8601, null until the first check completes
  originQuery: string;           // exactly what was passed to add_watch
  destinationQuery: string;
  dateFrom: string;              // YYYY-MM-DD
  dateTo: string;                // YYYY-MM-DD
  providers: string[];           // the SUBSET of requested providers that actually
                                   // resolved both origin and destination — this is
                                   // what future checks (hourly + force_check) search
  maxPrice: number | null;
  currency: string | null;
  label: string | null;
  resolved: {
    [providerId: string]: {
      origin: LocationMatch[];
      destination: LocationMatch[];
    }
  }                               // includes EVERY originally-requested provider,
                                   // even the unusable ones, so you can see why —
                                   // an empty origin or destination array there is
                                   // why that provider isn't in `providers` above
}
```

## 3. The `Offer` object

Every provider adapter's `searchFares()` returns offers in this exact shape —
it's the normalized common format across all four providers:

```ts
{
  provider: string;              // 'ryanair' | 'jetstar' | 'kupibilet' | 'spicejet'
  origin: string;                 // IATA airport code actually flown from
  destination: string;            // IATA airport code actually flown to
  departureDate: string;          // YYYY-MM-DD
  departureTime: string | null;   // ISO 8601 with offset, e.g. "2026-08-19T17:30:00+03:00"
                                    // null for spicejet (its calendar endpoint doesn't
                                    // return exact times — see §4)
  arrivalTime: string | null;
  price: number;                  // in `currency` below — NOT normalized across providers
  currency: string;                // ISO 4217, e.g. "RUB", "INR", "GBP", "SGD"
  airline: string | null;          // 2-letter carrier code where known
  flightNumber: string | null;
  stops: number | null;            // 0 = direct; null where the provider doesn't say (spicejet)
  transportKind: 'airplane' | 'train'; // Kupibilet can return trains for some routes — filter
                                          // on this if you only want flights
  extra: Record<string, unknown>;  // provider-specific extra fields — baggage allowance,
                                     // fare class, sold-out flag, full multi-leg breakdown
                                     // for connections, etc. Not part of the stable contract;
                                     // inspect per-provider if you need it, don't rely on
                                     // its shape being consistent across providers.
}
```

**Dedupe key** used internally for new/price-drop detection (not returned
anywhere, but useful to know): `` `${provider}|${origin}|${destination}|${departureDate}|${flightNumber||''}` ``.

## 4. Provider-specific caveats you need to know as a caller

- **Currency is never normalized.** A `maxPrice` filter on a watch searching
  both Kupibilet (RUB) and SpiceJet (INR) compares raw numbers in two
  different currencies — that's almost certainly not what you want if you mix
  those two providers on one watch with a `maxPrice`. Either watch one
  provider at a time when using `maxPrice`, or filter/convert client-side
  using each offer's own `currency`.
- **SpiceJet's `departureTime`/`arrivalTime`/`stops` are always `null`.** Its
  fare-search endpoint used here (`/api/v2/search/lowfare`) is a *calendar*
  view — cheapest fare per date, no specific flight/time attached. Getting
  exact times would need a follow-up call to `/api/v3/search/availability`
  per date, which isn't wired up (see `src/providers/spicejet.js`).
- **Kupibilet can return trains.** Its search backend is multi-modal; a
  Moscow-area origin especially can surface `transportKind: "train"` offers
  mixed in with flights. Filter on `transportKind` if you only want one kind.
- **Jetstar is excluded by default** (`requiresBrowserSession: true`) — its
  real fare-search endpoint is behind Akamai Bot Manager and returns HTTP 409
  with a fresh `_abck`/`bm_sz` cookie pair to any request without a
  browser-passed session. It's still registered and can be requested
  explicitly, but expect it to return nothing.
- **Ryanair can occasionally return `{"message":"Availability declined"}`
  (HTTP 409)** even with no auth issue at all — this looks like a soft
  rate-limit after many requests from the same IP in a short window (observed
  during this project's own testing). The adapter treats it as "no offers
  this check," not a crash, and `lib/http.js` retries once automatically on
  409/429/5xx. If it persists across many consecutive hourly checks, that's
  worth investigating (maybe space out watches more, or add a longer backoff).

## 5. Notifications — how "wake the agent" actually works

MCP is pull-based: a server cannot force an idle client/agent to act. This
server does two things, in order of how much you should rely on them:

1. **`poll_new_offers` (reliable, host-independent)** — call it on your own
   schedule. This is the load-bearing mechanism; design around it.
2. **Push notifications (best-effort, host-dependent)** — whenever a check
   finds something new, the server sends:
   - `notifications/message` (a logging notification, level `info`) via
     `server.sendLoggingMessage()`, with a human-readable summary string.
   - `notifications/resources/updated` for the resource URI
     `air-choose://offers/pending`, *if* a client has subscribed to it (via
     the standard MCP `resources/subscribe` request).

   Whether either of these actually reaches your agent's attention depends on
   whether the host wires MCP notifications through to the agent loop at all
   — that's entirely host-specific (Hermes/OpenClaw's implementation, not
   this server). Treat these as a nice-to-have, not the mechanism you build
   reliability on.

### Resource: `air-choose://offers/pending`

```ts
// GET (resources/read) response:
{ contents: [{ uri: "air-choose://offers/pending", mimeType: "application/json", text: '{"count": 3}' }] }
```
Only exposes a count, not the actual offers — read `poll_new_offers` for the
data. The resource's job is purely to be a subscribable thing that changes,
for hosts that support that.

## 6. Limits and internal behavior worth knowing

- **Origin × destination pairing**: when either side resolves to multiple
  codes (e.g. a country resolving to several airports), the watch searches
  every combination, capped at **12 pairs per provider per check**
  (`MAX_PAIRS_PER_PROVIDER` in `src/scheduler.js`). Beyond that, later pairs
  are silently dropped and `truncated: true` is set on the check result —
  check that field if you're watching a route where the destination resolved
  to a lot of airports.
- **Checks are serialized process-wide.** All calls that touch the shared
  offer/price-history files (`add_watch`'s immediate check, `force_check`,
  and every scheduler tick) go through a single in-process queue
  (`withLock` in `src/scheduler.js`) — they never run concurrently within
  one server process, so results can't clobber each other. Multiple watches
  within one check still run their provider calls sequentially, not in
  parallel — a watch covering many providers/airports can take a few seconds.
- **Scheduler runs once immediately on server startup**, then every
  `AIR_CHOOSE_INTERVAL_MS` (default 1 hour, env var override). On a cold
  start with existing watches from a previous session, you get fresh results
  right away rather than waiting an hour.
- **Persistence is plain JSON files** under `data/` — no database, no
  concurrent-writer protection beyond the in-process lock above. Fine for one
  server instance; don't run two instances against the same `data/` directory.

## 7. Provider adapter contract (for adding a 5th provider)

Each file in `src/providers/` must export:

```ts
export const id: string;                    // unique, used as the key everywhere
export const name: string;                  // display name
export const region: string;                // free text, shown in list_providers
export const requiresBrowserSession: boolean; // true excludes it from the default set

export function resolveLocation(query: string): Promise<LocationMatch[]>;
export function searchFares(params: {
  originCode: string;
  destinationCode: string;
  dateFrom: string;   // YYYY-MM-DD
  dateTo: string;     // YYYY-MM-DD
  currency?: string;  // only if this provider supports choosing one
}): Promise<Offer[]>;
```
Then add it to the `PROVIDERS` array in `src/providers/index.js`. See
`src/providers/kupibilet.js` for the most complete example (country-code
resolution, multi-leg offers) and `src/providers/spicejet.js` for an example
of a provider that needs an extra auth step (anonymous token) before search.
