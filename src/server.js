#!/usr/bin/env node
// air_choose — MCP server that monitors flight prices across multiple airline
// provider APIs and lets an agent add/remove/inspect watched routes. Read-only
// information service: no ticket ordering, only available flight data.
// See README.md for the full design and how to wire this into an agent host.

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { listProviders, getProvider, defaultProviderIds } from './providers/index.js';
import * as watchesStore from './store/watches.js';
import * as offersStore from './store/offers.js';
import { resolveForProviders, checkWatch, startScheduler } from './scheduler.js';

const HOUR_MS = 60 * 60 * 1000;
const CHECK_INTERVAL_MS = Number(process.env.AIR_CHOOSE_INTERVAL_MS) || HOUR_MS;

const server = new McpServer(
  { name: 'air-choose', version: '0.1.0' },
  { capabilities: { logging: {}, resources: { subscribe: true } } }
);

function log(message) {
  // stderr, not stdout — stdout is the JSON-RPC channel for stdio transport.
  console.error(`[air-choose] ${message}`);
  server.sendLoggingMessage({ level: 'info', data: message }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

server.registerTool(
  'list_providers',
  {
    title: 'List airline providers',
    description:
      'List every airline provider air_choose can query, with its coverage region and whether it needs a live ' +
      'browser session (those are NOT included here — only providers that work with plain HTTP calls are).',
    inputSchema: {},
  },
  async () => ({
    content: [{ type: 'text', text: JSON.stringify(listProviders(), null, 2) }],
  })
);

server.registerTool(
  'resolve_location',
  {
    title: 'Resolve a place name to each provider’s own codes',
    description:
      'Every provider uses its own internal airport/city/country codes — you cannot just pass a Russian ' +
      'or English place name straight into a search. Call this FIRST for both the origin and the destination ' +
      'before add_watch, so you can see what each provider actually understood the place as. Accepts a country ' +
      'name (RU or EN, e.g. "Таиланд" / "Thailand"), a 3-letter IATA code (e.g. "BKK"), or ' +
      'a handful of built-in city aliases (Moscow, London, Singapore, Delhi, ...). Returns, per provider, the list ' +
      'of matched airports/cities/country codes — an empty list for a provider means that provider does not serve ' +
      'that place at all (e.g. Ryanair has no Moscow routes), which is normal, not an error.',
    inputSchema: {
      query: z.string().describe('Place name or code to resolve, e.g. "Москва", "Thailand", "BKK"'),
      providers: z
        .array(z.string())
        .optional()
        .describe(
          'Provider ids to resolve against; defaults to providers that work without a browser session ' +
            '(currently ryanair, kupibilet, spicejet). Pass ["jetstar"] explicitly to try it anyway — it usually ' +
            '409s without a browser-derived cookie, see list_providers.requiresBrowserSession.'
        ),
    },
  },
  async ({ query, providers }) => {
    const ids = providers?.length ? providers : defaultProviderIds();
    const resolved = {};
    for (const pid of ids) {
      const provider = getProvider(pid);
      if (!provider) continue;
      resolved[pid] = await provider.resolveLocation(query).catch((e) => ({ error: e.message }));
    }
    return { content: [{ type: 'text', text: JSON.stringify(resolved, null, 2) }] };
  }
);

server.registerTool(
  'add_watch',
  {
    title: 'Add a watched route',
    description:
      'Add a route to monitor. originQuery/destinationQuery go through the same resolution as resolve_location ' +
      'for every requested provider, immediately, and the watch stores each provider’s resolved codes — you ' +
      'get that resolution back in the response so you can sanity-check it before relying on the watch. An ' +
      'immediate first check runs right away (you do not have to wait for the hourly cycle to get initial results) ' +
      'and its offers are returned too.',
    inputSchema: {
      originQuery: z.string().describe('e.g. "Москва" / "Moscow" / "MOW"'),
      destinationQuery: z.string().describe('e.g. "Таиланд" / "Thailand" / "BKK"'),
      dateFrom: z.string().describe('YYYY-MM-DD'),
      dateTo: z.string().describe('YYYY-MM-DD'),
      providers: z
        .array(z.string())
        .optional()
        .describe(
          'Provider ids to search; defaults to providers that work without a browser session ' +
            '(currently ryanair, kupibilet, spicejet). Pass ["jetstar"] explicitly to try it anyway.'
        ),
      maxPrice: z.number().optional().describe('Ignore offers above this price (in each provider’s own currency)'),
      currency: z.string().optional().describe('Preferred currency code for providers that support choosing one (Kupibilet, SpiceJet). Providers ignore this if they don’t support it and return their own default currency instead — always read the currency field on each offer.'),
      label: z.string().optional().describe('Free-text label to help you recognize this watch later'),
    },
  },
  async ({ originQuery, destinationQuery, dateFrom, dateTo, providers, maxPrice, currency, label }) => {
    const ids = providers?.length ? providers : defaultProviderIds();
    const resolved = await resolveForProviders(originQuery, destinationQuery, ids);

    const usableProviders = ids.filter((pid) => resolved[pid]?.origin.length && resolved[pid]?.destination.length);
    const watch = watchesStore.addWatch({
      originQuery,
      destinationQuery,
      dateFrom,
      dateTo,
      providers: usableProviders,
      maxPrice: maxPrice ?? null,
      currency: currency ?? null,
      label: label ?? null,
      resolved,
    });

    const checkResult = await checkWatch(watch, { log });
    const offers = offersStore.getWatchOffers(watch.id);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              watch,
              unusableProviders: ids.filter((pid) => !usableProviders.includes(pid)),
              firstCheck: checkResult,
              offers: offers.sort((a, b) => a.price - b.price).slice(0, 30),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.registerTool(
  'remove_watch',
  {
    title: 'Remove a watched route',
    description: 'Stop monitoring a route and forget its price history.',
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const removed = watchesStore.removeWatch(id);
    if (removed) offersStore.clearWatchData(id);
    return { content: [{ type: 'text', text: JSON.stringify({ removed }) }] };
  }
);

server.registerTool(
  'list_watches',
  {
    title: 'List watched routes',
    description: 'List every currently watched route, with when it was last checked and how many offers it has.',
    inputSchema: {},
  },
  async () => {
    const watches = watchesStore.listWatches().map((w) => ({
      ...w,
      offerCount: offersStore.getWatchOffers(w.id).length,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(watches, null, 2) }] };
  }
);

server.registerTool(
  'get_watch_offers',
  {
    title: 'Get current offers for a watch',
    description: 'Return the latest known offers for a watch, from the most recent check (hourly, or forced).',
    inputSchema: {
      id: z.string(),
      sortBy: z.enum(['price', 'date']).optional().default('price'),
      limit: z.number().optional().default(50),
    },
  },
  async ({ id, sortBy, limit }) => {
    const offers = offersStore.getWatchOffers(id);
    const sorted = [...offers].sort((a, b) =>
      sortBy === 'date' ? a.departureDate.localeCompare(b.departureDate) : a.price - b.price
    );
    return { content: [{ type: 'text', text: JSON.stringify(sorted.slice(0, limit), null, 2) }] };
  }
);

server.registerTool(
  'poll_new_offers',
  {
    title: 'Poll for newly found offers (main wake-up tool)',
    description:
      'Return every offer discovered since the last time this was called — new routes/dates appearing, or a ' +
      'price drop below the previously-seen best price — across ALL watches, and clears the queue. This is the ' +
      'reliable way to find out "what changed": call it on your own schedule (e.g. once an hour) rather than ' +
      'relying on push notifications, since not every MCP host wakes an idle agent on server notifications.',
    inputSchema: {},
  },
  async () => {
    const pending = offersStore.popPendingNotifications();
    return { content: [{ type: 'text', text: JSON.stringify(pending, null, 2) }] };
  }
);

server.registerTool(
  'force_check',
  {
    title: 'Force an immediate check',
    description: 'Re-run the fare check for one watch right now, instead of waiting for the hourly cycle.',
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const watch = watchesStore.getWatch(id);
    if (!watch) return { content: [{ type: 'text', text: JSON.stringify({ error: 'watch not found' }) }], isError: true };
    const result = await checkWatch(watch, { log });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Resource: air-choose://offers/pending — subscribable, so hosts that support
// resource push notifications can react without polling poll_new_offers.
// ---------------------------------------------------------------------------

const subscriptions = new Set();

server.registerResource(
  'pending-offers',
  'air-choose://offers/pending',
  {
    title: 'Pending new offers',
    description: 'Offers found since the last poll_new_offers call (new routes/dates, or price drops).',
    mimeType: 'application/json',
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ count: offersStore.peekPendingCount() }) }],
  })
);

server.server.setRequestHandler(SubscribeRequestSchema, async (request) => {
  subscriptions.add(request.params.uri);
  return {};
});
server.server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
  subscriptions.delete(request.params.uri);
  return {};
});

// ---------------------------------------------------------------------------
// Scheduler wiring
// ---------------------------------------------------------------------------

startScheduler({
  intervalMs: CHECK_INTERVAL_MS,
  log,
  onTick(results) {
    const newTotal = results.reduce((s, r) => s + r.newCount, 0);
    const dropTotal = results.reduce((s, r) => s + r.priceDropCount, 0);
    if (newTotal || dropTotal) {
      log(`Found ${newTotal} new offer(s) and ${dropTotal} price drop(s) across ${results.length} watch(es).`);
      if (subscriptions.has('air-choose://offers/pending')) {
        server.server.sendResourceUpdated({ uri: 'air-choose://offers/pending' }).catch(() => {});
      }
    }
  },
});

const transport = new StdioServerTransport();
await server.connect(transport);
log(`air_choose MCP server started. Checking every ${Math.round(CHECK_INTERVAL_MS / 60000)} min.`);
