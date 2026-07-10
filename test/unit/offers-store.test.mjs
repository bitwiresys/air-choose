import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as offersStore from '../../src/store/offers.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const OFFERS_FILE = path.join(DATA_DIR, 'offers.json');
const BEST_PRICES_FILE = path.join(DATA_DIR, 'best_prices.json');
const PENDING_FILE = path.join(DATA_DIR, 'pending.json');

function cleanFiles() {
  for (const f of [OFFERS_FILE, BEST_PRICES_FILE, PENDING_FILE]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

function makeOffer(overrides = {}) {
  return {
    provider: 'kupibilet',
    origin: 'MOW',
    destination: 'BKK',
    departureDate: '2026-08-15',
    departureTime: '2026-08-15T10:00:00+03:00',
    arrivalTime: '2026-08-15T18:00:00+07:00',
    price: 25000,
    currency: 'RUB',
    airline: 'SU',
    flightNumber: 'SU1234',
    stops: 0,
    extra: {},
    ...overrides,
  };
}

describe('offers store', () => {
  before(() => cleanFiles());
  after(() => cleanFiles());

  describe('getWatchOffers', () => {
    it('returns empty array for unknown watch', () => {
      cleanFiles();
      const offers = offersStore.getWatchOffers('non-existent');
      assert.ok(Array.isArray(offers));
      assert.equal(offers.length, 0);
    });
  });

  describe('recordCheckResults', () => {
    it('detects all offers as new on first check', () => {
      cleanFiles();
      const offers = [
        makeOffer({ price: 25000 }),
        makeOffer({ flightNumber: 'SU5678', price: 30000 }),
      ];

      const result = offersStore.recordCheckResults('test-watch-1', offers);
      assert.equal(result.newOffers.length, 2, 'both offers should be new');
      assert.equal(result.priceDrops.length, 0, 'no price drops on first check');
    });

    it('stores offers per watch', () => {
      const offers = offersStore.getWatchOffers('test-watch-1');
      assert.equal(offers.length, 2);
    });

    it('queues new offers as pending notifications', () => {
      const pending = offersStore.popPendingNotifications();
      assert.equal(pending.length, 2, 'should have 2 pending notifications');
      assert.ok(pending.every((n) => n.reason === 'new'), 'all should be reason "new"');
      assert.ok(pending.every((n) => n.watchId === 'test-watch-1'), 'all for correct watch');
      assert.ok(pending.every((n) => n.foundAt), 'all should have foundAt timestamp');
    });

    it('detects price drops', () => {
      const offers = [
        makeOffer({ price: 20000 }), // was 25000, now cheaper
        makeOffer({ flightNumber: 'SU5678', price: 30000 }), // same price, no drop
      ];

      const result = offersStore.recordCheckResults('test-watch-1', offers);
      assert.equal(result.newOffers.length, 0, 'no new offers');
      assert.equal(result.priceDrops.length, 1, 'one price drop');
      assert.equal(result.priceDrops[0].offer.price, 20000);
      assert.equal(result.priceDrops[0].previousPrice, 25000);
    });

    it('ignores same or higher prices', () => {
      cleanFiles();
      const offers = [makeOffer({ price: 25000 })];

      offersStore.recordCheckResults('test-watch-2', offers);
      offersStore.popPendingNotifications();

      const result = offersStore.recordCheckResults('test-watch-2', [makeOffer({ price: 25000 })]);
      assert.equal(result.newOffers.length, 0);
      assert.equal(result.priceDrops.length, 0);

      const result2 = offersStore.recordCheckResults('test-watch-2', [makeOffer({ price: 30000 })]);
      assert.equal(result2.newOffers.length, 0);
      assert.equal(result2.priceDrops.length, 0);
    });

    it('overwrites offers on re-check', () => {
      cleanFiles();
      offersStore.recordCheckResults('test-watch-3', [makeOffer({ price: 10000 })]);
      offersStore.recordCheckResults('test-watch-3', [makeOffer({ price: 11000 }), makeOffer({ price: 12000, flightNumber: 'XX9999' })]);
      const offers = offersStore.getWatchOffers('test-watch-3');
      assert.equal(offers.length, 2, 'should have latest 2 offers');
    });
  });

  describe('popPendingNotifications', () => {
    it('drains the queue and returns all pending', () => {
      cleanFiles();
      offersStore.recordCheckResults('drain-test', [makeOffer({ price: 100 })]);
      const pending = offersStore.popPendingNotifications();
      assert.ok(Array.isArray(pending));
      assert.equal(pending.length, 1);
    });

    it('returns empty array on second call', () => {
      const pending = offersStore.popPendingNotifications();
      assert.equal(pending.length, 0);
    });
  });

  describe('peekPendingCount', () => {
    it('returns 0 when queue is empty', () => {
      cleanFiles();
      assert.equal(offersStore.peekPendingCount(), 0);
    });

    it('returns correct count after recording new offers', () => {
      cleanFiles();
      offersStore.recordCheckResults('test-count', [
        makeOffer({ price: 100 }),
        makeOffer({ price: 200, flightNumber: 'AA1111' }),
        makeOffer({ price: 300, flightNumber: 'AA2222' }),
      ]);
      assert.equal(offersStore.peekPendingCount(), 3);
      offersStore.popPendingNotifications();
    });
  });

  describe('clearWatchData', () => {
    it('removes offers for a specific watch', () => {
      cleanFiles();
      offersStore.recordCheckResults('test-clear', [makeOffer({ price: 500 })]);
      assert.equal(offersStore.getWatchOffers('test-clear').length, 1);
      offersStore.clearWatchData('test-clear');
      assert.equal(offersStore.getWatchOffers('test-clear').length, 0);
    });

    it('does not affect other watches', () => {
      cleanFiles();
      offersStore.recordCheckResults('test-other', [makeOffer({ price: 600 })]);
      offersStore.clearWatchData('test-clear');
      assert.equal(offersStore.getWatchOffers('test-other').length, 1);
    });
  });

  describe('deduplication logic', () => {
    it('uses correct dedupe key format', () => {
      cleanFiles();
      const offer = makeOffer({ provider: 'ryanair', origin: 'STN', destination: 'DUB', departureDate: '2026-09-01', flightNumber: 'FR100' });
      offersStore.recordCheckResults('test-dedup', [offer]);
      offersStore.popPendingNotifications();

      const result = offersStore.recordCheckResults('test-dedup', [offer]);
      assert.equal(result.newOffers.length, 0);
      assert.equal(result.priceDrops.length, 0);
    });

    it('treats different flight numbers as different offers', () => {
      cleanFiles();
      offersStore.recordCheckResults('test-dedup2', [makeOffer({ flightNumber: 'FR100' })]);
      offersStore.popPendingNotifications();

      const result = offersStore.recordCheckResults('test-dedup2', [makeOffer({ flightNumber: 'FR200' })]);
      assert.equal(result.newOffers.length, 1);
    });

    it('treats null flightNumber as empty string in key', () => {
      cleanFiles();
      offersStore.recordCheckResults('test-dedup3', [makeOffer({ flightNumber: null })]);
      offersStore.popPendingNotifications();

      const result = offersStore.recordCheckResults('test-dedup3', [makeOffer({ flightNumber: null })]);
      assert.equal(result.newOffers.length, 0);
    });
  });
});
