# air_choose — technical API reference

This is the exhaustive reference: every MCP tool's exact input/output schema,
every data shape, error conventions, the resource/notification model, and the
provider adapter contract. If you're an agent being told "use the air_choose
MCP plugin," this document plus `list_providers`/`resolve_location` calls at
runtime is everything you need — you should not need to read the source.

For the narrative "what is this and why" version, see [README.md](README.md).

---

## 0. Mental model

1. A **watch** = one monitored flight route: an origin query, a destination
   query, a date range, and which providers to search. You create it with
   `add_watch`.
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
6. **Flights only** — trains and other non-air transport are filtered out.
   This is a read-only information service — no ticket ordering.

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
gated by bot-detection that a plain HTTP client can't pass — it will usually
fail with an empty result. It's excluded from the *default* provider set but
can still be requested explicitly.

---

### `resolve_location`

Turn a place name into every provider's own codes. **Call this before
`add_watch`** for both origin and destination if you want to see what actually
got matched (`add_watch` does the same resolution internally and returns it in
its response too, so this is for inspection/debugging, not strictly required).

| Field | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Place name or code: IATA code (`"BKK"`), country name RU/EN (`"Таиланд"`, `"Thailand"`), or built-in city alias (Moscow, London, Singapore, Delhi, ...) |
| `providers` | string[] | no | Provider ids to resolve against. Default: `["ryanair","kupibilet","spicejet"]` |

**Returns** — `Record<providerId, LocationMatch[] | {error: string}>`:
```jsonc
{
  "kupibilet": [
    { "code": "TH", "label": "Таиланд (country TH)", "kind": "country" }
  ],
  "spicejet": [
    { "code": "BKK", "label": "Bangkok, Thailand", "kind": "airport" }
  ],
  "ryanair": []
}
```

`LocationMatch` shape:
```ts
{ code: string; label: string; kind: 'airport' | 'city' | 'country' }
```

---

### `add_watch`

Adds a flight route to monitor. Resolves locations for the requested providers
immediately, keeps only providers where *both* origin and destination resolved
to something, stores the watch, and runs an immediate first check — so the
response already contains real flight offers.

| Field | Type | Required | Description |
|---|---|---|---|
| `originQuery` | string | yes | e.g. `"Москва"`, `"Moscow"`, `"MOW"` |
| `destinationQuery` | string | yes | e.g. `"Таиланд"`, `"Thailand"`, `"BKK"` |
| `dateFrom` | string | yes | `YYYY-MM-DD`, inclusive |
| `dateTo` | string | yes | `YYYY-MM-DD`, inclusive |
| `providers` | string[] | no | Default: `["ryanair","kupibilet","spicejet"]` |
| `maxPrice` | number | no | Ignore offers above this price (in each provider's own currency) |
| `currency` | string | no | Preferred currency code for providers that support choosing one |
| `label` | string | no | Free-text note to help recognize this watch later |

**Returns**:
```ts
{
  watch: Watch;
  unusableProviders: string[];
  firstCheck: CheckResult;
  offers: Offer[];  // up to 30, sorted by price ascending
}
```

---

### `remove_watch`

| Field | Type | Required |
|---|---|---|
| `id` | string | yes |

**Returns**: `{ "removed": boolean }` — `false` if no watch had that id.

---

### `list_watches`

No input.

**Returns** — `(Watch & { offerCount: number })[]`

---

### `get_watch_offers`

| Field | Type | Required | Default |
|---|---|---|---|
| `id` | string | yes | — |
| `sortBy` | `"price"` \| `"date"` | no | `"price"` |
| `limit` | number | no | `50` |

**Returns**: `Offer[]`

---

### `poll_new_offers`

**The tool your agent's wake-up loop should call.** No input.

**Returns** — `Notification[]`, and **clears the queue** as a side effect:
```ts
{
  watchId: string;
  offer: Offer;
  reason: 'new' | 'price_drop';
  previousPrice?: number;
  foundAt: string;
}[]
```

---

### `force_check`

| Field | Type | Required |
|---|---|---|
| `id` | string | yes |

**Returns** on success — `CheckResult`:
```ts
{
  watchId: string;
  totalOffers: number;
  newCount: number;
  priceDropCount: number;
  truncated: boolean;
}
```
**Returns** on failure — `isError: true` with `{ "error": "watch not found" }`.

---

## 2. The `Watch` object

```ts
{
  id: string;
  createdAt: string;
  lastCheckedAt: string | null;
  originQuery: string;
  destinationQuery: string;
  dateFrom: string;
  dateTo: string;
  providers: string[];
  maxPrice: number | null;
  currency: string | null;
  label: string | null;
  resolved: {
    [providerId: string]: {
      origin: LocationMatch[];
      destination: LocationMatch[];
    }
  }
}
```

## 3. The `Offer` object

```ts
{
  provider: string;
  origin: string;
  destination: string;
  departureDate: string;
  departureTime: string | null;
  arrivalTime: string | null;
  price: number;
  currency: string;
  airline: string | null;
  flightNumber: string | null;
  stops: number | null;
  extra: Record<string, unknown>;
}
```

## 4. Provider-specific caveats

- **Currency is never normalized.** `maxPrice` on a multi-provider watch
  compares raw numbers in different currencies.
- **SpiceJet's `departureTime`/`arrivalTime`/`stops` are always `null`.**
  Its fare endpoint is a calendar view.
- **Jetstar is excluded by default** — its fare-search endpoint is behind
  Akamai Bot Manager.
- **Ryanair can occasionally return HTTP 409** — transient rate-limit,
  auto-retried once.

## 5. Notifications

MCP is pull-based. The reliable design is polling via `poll_new_offers`.

## 6. Limits

- **12 origin x destination pairs per provider per check** (cap)
- **Checks are serialized process-wide** via in-process lock
- **Scheduler runs once immediately on startup**, then every hour
- **Persistence: plain JSON files** under `data/`

## 7. Provider adapter contract

Each file in `src/providers/` must export:

```ts
export const id: string;
export const name: string;
export const region: string;
export const requiresBrowserSession: boolean;

export function resolveLocation(query: string): Promise<LocationMatch[]>;
export function searchFares(params: {
  originCode: string;
  destinationCode: string;
  dateFrom: string;
  dateTo: string;
  currency?: string;
}): Promise<Offer[]>;
```
