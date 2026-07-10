# air_choose

MCP server that watches flight (and, for Kupibilet, train) fares across several
provider APIs found during recon at [`D:\projects\flight-recon-tool`](../flight-recon-tool)
and [`D:\projects\https_sniffer`](../https_sniffer). An agent (Hermes, OpenClaw,
Claude, etc.) adds/removes/inspects watched routes through MCP tools; a background
scheduler inside this process re-checks every watch hourly and keeps a queue of
"what's new" for the agent to pick up.

**For the full technical/API reference — every tool's exact input/output
schema, every data shape, error conventions — see [API.md](API.md).** This
file is the narrative "what is this and why" version.

## Why this exists

Each provider's website has its own internal codes for airports/cities/countries —
you can't pass "Тайланд" into a search box API call, the site itself resolved that
through its own autocomplete first. `resolve_location` does that resolution for
every wired-up provider at once, so an agent can build one logical search
("Moscow → Thailand") into several provider-specific requests at once.

## Providers wired up

| Provider | Coverage | Works via plain HTTP? |
|---|---|---|
| **Kupibilet** | Russia-market, but genuinely worldwide | ✅ Yes — no auth, accepts ISO2 country codes directly (`"TH"`), one call covers the whole date range, returns trains mixed with flights (`transportKind`) |
| **Ryanair** | Europe only | ✅ Yes — no auth. Can occasionally soft-rate-limit ("Availability declined", HTTP 409) after heavy use from one IP — retried once automatically, see [API.md §4](API.md#4-provider-specific-caveats-you-need-to-know-as-a-caller) |
| **SpiceJet** | India-focused | ✅ Yes, but needs an anonymous token (`POST /api/v1/token`) plus a browser-shaped header set, or the front proxy 403s. Its fare endpoint is a calendar view — no exact departure times, see API.md |
| **Jetstar Asia** | Asia-Pacific | ❌ No — its real fare-search endpoint is behind Akamai Bot Manager (confirmed live: bare requests get HTTP 409 + a fresh `_abck` cookie). Registered but excluded from the default provider set |

**Not included at all**: AirAsia and IndiGo were also confirmed during recon
but need Cloudflare/Akamai cookies from a *live browser session*, same
situation as Jetstar — see `flight-recon-tool/sites.json` for their confirmed
endpoints if you want to add them following the Jetstar adapter as a template.

**Important**: a route a provider doesn't serve (e.g. Ryanair for a Moscow
origin — they don't fly there) resolves to an empty location list and is
simply dropped for that watch. That's normal, not a bug — `add_watch`'s
response tells you exactly which providers ended up usable for a given query.

## Install & run standalone

```bash
cd D:\projects\air_choose
npm install
node src/server.js
```

It's a stdio MCP server — it does nothing visible on its own, it just waits
for an MCP client to speak JSON-RPC over stdin/stdout.

## Run the tests

```bash
npm test
```

`test/smoke.mjs` spawns the real server as a child process (exactly like a
host would) and drives every tool through a real MCP client against the live
provider APIs — no mocks. See the comment at the top of that file for what
counts as pass/warn/fail per provider (Ryanair rate-limiting and Jetstar's
browser-session requirement are expected, not failures).

## Wiring into an agent host (Hermes / OpenClaw / any MCP-capable host)

Most MCP hosts use a config shape like this (adjust the exact file/key names
to whatever Hermes/OpenClaw expects — this is the de-facto standard shape used
by Claude Desktop and most other stdio-based MCP hosts):

```json
{
  "mcpServers": {
    "air-choose": {
      "command": "node",
      "args": ["D:/projects/air_choose/src/server.js"]
    }
  }
}
```

Optional env var: `AIR_CHOOSE_INTERVAL_MS` overrides the hourly check interval
(default `3600000` = 1 hour) — useful for testing with something short.

## Tools (summary — see [API.md](API.md#1-tools) for exact schemas)

| Tool | Purpose |
|---|---|
| `list_providers` | See what's wired up, coverage, and which need a browser session |
| `resolve_location` | Turn a place name/code into every provider's own codes |
| `add_watch` | Add a route (originQuery, destinationQuery, dateFrom, dateTo). Resolves + runs a first check immediately |
| `remove_watch` | Stop watching a route |
| `list_watches` | See everything currently watched |
| `get_watch_offers` | Current known offers for one watch, sorted by price or date |
| `poll_new_offers` | **The main "what changed" tool** — returns and clears everything found since the last call |
| `force_check` | Re-run a watch's check immediately instead of waiting for the hourly cycle |

## How "waking the agent" actually works

MCP is fundamentally pull-based — a server can't reach out and force an idle
agent to do something. This server sends push notifications (a
`notifications/message` log line, and a `resources/updated` event for
`air-choose://offers/pending`) whenever a check finds something new, but
whether that actually reaches your agent depends entirely on whether the host
wires MCP notifications through to it — host-specific, outside this server's
control. **The reliable design is polling**: call `poll_new_offers` on the
agent's own schedule (same pattern this very session uses for its own
`/loop`-style wake-ups — don't rely on being pushed to, come back and check).

## Example flow (the "Moscow → Thailand" use case)

```
agent -> resolve_location({query: "Москва"})
agent -> resolve_location({query: "Таиланд"})
       (agent sees Kupibilet resolved both; Ryanair/SpiceJet returned empty
        for Moscow — expected, neither flies there)
agent -> add_watch({
           originQuery: "Москва", destinationQuery: "Таиланд",
           dateFrom: "2026-07-21", dateTo: "2026-08-20"
         })
       (server resolves per-provider, runs an immediate check, returns offers
        sorted by price — in this example only kupibilet had usable results)

... an hour later, the scheduler re-checks automatically ...

agent -> poll_new_offers()
       (returns any new/cheaper offers found since the last poll; agent decides
        whether to notify the user)
```

## Data & state

Plain JSON files under `data/` (local state, not committed anywhere):
- `watches.json` — watched routes
- `offers.json` — latest known offers per watch
- `best_prices.json` — best price ever seen per (provider, route, date, flight) — used to detect drops
- `pending.json` — queue drained by `poll_new_offers`

## Adding a provider

See [API.md §7](API.md#7-provider-adapter-contract-for-adding-a-5th-provider)
for the exact adapter interface — `src/providers/kupibilet.js` is the most
complete example, `src/providers/spicejet.js` shows a provider needing an
extra auth step.

## Legal note

These are all reverse-engineered consumer-facing endpoints, not published
partner APIs (see `flight-recon-tool/README.md` for the fuller caveat). Keep
the hourly interval reasonable — this already isn't hammering anyone (a
handful of requests per watch per hour), but don't add dozens of watches
without thinking about it.
