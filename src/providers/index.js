import * as ryanair from './ryanair.js';
import * as jetstar from './jetstar.js';
import * as spicejet from './spicejet.js';
import * as kupibilet from './kupibilet.js';

// All wired-up providers. jetstar is registered but requiresBrowserSession is
// true (its fare-search endpoint is Akamai-gated — see providers/jetstar.js
// for how that was discovered) — it will usually 409 without a browser-derived
// cookie, so it's excluded from the *default* provider set (see
// defaultProviderIds()) but can still be requested explicitly if you're
// prepared to feed it a session, or just to see it fail informatively.
// AirAsia and IndiGo need the same kind of browser session and aren't wired up
// at all yet — see D:\projects\flight-recon-tool\sites.json for their confirmed
// endpoints if you want to add them following the jetstar.js pattern.
export const PROVIDERS = [ryanair, jetstar, kupibilet, spicejet];

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id);
}

export function listProviders() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    region: p.region,
    requiresBrowserSession: p.requiresBrowserSession,
  }));
}

/** Providers used when a tool call doesn't specify an explicit provider list. */
export function defaultProviderIds() {
  return PROVIDERS.filter((p) => !p.requiresBrowserSession).map((p) => p.id);
}
