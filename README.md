<p align="center">
  <h1 align="center">Air Choose</h1>
  <p align="center">
    <strong>MCP server for monitoring flight prices across multiple airline providers</strong>
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/MCP-1.29+-365DFF?logo=modelcontextprotocol&logoColor=white" alt="MCP">
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License">
</p>

---

Read-only MCP server that monitors flight prices across multiple airline providers. An AI agent (Hermes, OpenClaw, Claude, etc.) adds, removes, and inspects watched routes through MCP tools; a background scheduler re-checks every watch hourly and queues new/cheaper offers for the agent to pick up. **No ticket ordering** — only available flight data.

## Features

- **Multi-provider** — Kupibilet (worldwide), Ryanair (Europe), SpiceJet (India), Jetstar Asia (Asia-Pacific)
- **Flights only** — trains and other transport types are filtered out automatically
- **Smart resolution** — turn `"Moscow → Thailand"` into provider-specific airport/country codes
- **Price drop detection** — tracks best-ever prices per route, queues notifications when fares drop
- **MCP-native** — works with any MCP-compatible agent host

## Quick Start

### Local

```bash
git clone https://github.com/yourusername/air-choose.git
cd air-choose
npm install
node src/server.js
```

### Docker

```bash
docker compose up -d
```

### Wire into your agent

```json
{
  "mcpServers": {
    "air-choose": {
      "command": "node",
      "args": ["/absolute/path/to/air-choose/src/server.js"]
    }
  }
}
```

### Configuration

| Env Variable | Default | Description |
|---|---|---|
| `AIR_CHOOSE_INTERVAL_MS` | `3600000` (1 hour) | Scheduler re-check interval |

## Tools

| Tool | Purpose |
|---|---|
| `list_providers` | See airline providers, coverage, browser requirements |
| `resolve_location` | Turn a place name into each provider's own codes |
| `add_watch` | Add a route to monitor (resolves + runs first check immediately) |
| `remove_watch` | Stop watching a route |
| `list_watches` | See everything currently watched |
| `get_watch_offers` | Current offers for one watch, sorted by price or date |
| `poll_new_offers` | Return + clear everything new since last call |
| `force_check` | Re-run a watch's check right now |

## Providers

| Provider | Coverage | Auth | Notes |
|---|---|---|---|
| **Kupibilet** | Worldwide | No | Accepts ISO2 country codes directly |
| **Ryanair** | Europe | No | Can rate-limit (409) under heavy use |
| **SpiceJet** | India | Auto token | Calendar view, no exact departure times |
| **Jetstar Asia** | Asia-Pacific | Browser session | Excluded by default (Akamai) |

## Architecture

```
MCP Client (Hermes / Claude / ...)
        | JSON-RPC (stdio)
air-choose server
  |-- Tools (8)
  |-- Scheduler (hourly)
  |-- Provider Adapters (Kupibilet | Ryanair | SpiceJet | Jetstar)
  |-- JSON Store (watches | offers | pending)
```

## Example Flow

```
Agent -> resolve_location({ query: "Moscow" })
Agent -> resolve_location({ query: "Thailand" })
Agent -> add_watch({
           originQuery: "Moscow",
           destinationQuery: "Thailand",
           dateFrom: "2026-07-21",
           dateTo: "2026-08-20"
         })
        -> Server resolves, runs check, returns offers sorted by price

... one hour later, scheduler re-checks ...

Agent -> poll_new_offers()
        -> Returns new or cheaper offers found since last poll
```

## Testing

```bash
npm test           # unit tests
npm run test:e2e   # end-to-end (hits live APIs)
npm run test:all   # all tests
```

## Legal

Reverse-engineered consumer-facing endpoints, not published partner APIs. Keep the hourly interval reasonable.

## License

MIT
