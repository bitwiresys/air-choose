import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as watchesStore from '../../src/store/watches.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const WATCHES_FILE = path.join(DATA_DIR, 'watches.json');

function cleanFile() {
  if (fs.existsSync(WATCHES_FILE)) fs.unlinkSync(WATCHES_FILE);
}

describe('watches store', () => {
  before(() => cleanFile());
  after(() => cleanFile());

  describe('listWatches', () => {
    it('returns empty array when no data', () => {
      cleanFile();
      const watches = watchesStore.listWatches();
      assert.ok(Array.isArray(watches));
      assert.equal(watches.length, 0);
    });
  });

  describe('addWatch', () => {
    it('creates a watch with generated id and timestamps', () => {
      cleanFile();
      const watch = watchesStore.addWatch({
        originQuery: 'Moscow',
        destinationQuery: 'Thailand',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-30',
        providers: ['kupibilet'],
        maxPrice: null,
        currency: null,
        label: 'test watch',
        resolved: {},
      });

      assert.ok(watch.id, 'should have an id');
      assert.ok(watch.createdAt, 'should have createdAt');
      assert.equal(watch.lastCheckedAt, null, 'lastCheckedAt should be null initially');
      assert.equal(watch.originQuery, 'Moscow');
      assert.equal(watch.destinationQuery, 'Thailand');
      assert.equal(watch.dateFrom, '2026-08-01');
      assert.equal(watch.dateTo, '2026-08-30');
      assert.deepEqual(watch.providers, ['kupibilet']);
      assert.equal(watch.maxPrice, null);
      assert.equal(watch.currency, null);
      assert.equal(watch.label, 'test watch');
      assert.deepEqual(watch.resolved, {});
    });

    it('persists to disk', () => {
      const watches = watchesStore.listWatches();
      assert.equal(watches.length, 1);
      assert.ok(watches[0].id);
    });

    it('can create multiple watches', () => {
      watchesStore.addWatch({
        originQuery: 'London',
        destinationQuery: 'Dublin',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-15',
        providers: ['ryanair'],
        resolved: {},
      });
      const watches = watchesStore.listWatches();
      assert.equal(watches.length, 2);
    });
  });

  describe('getWatch', () => {
    it('returns the correct watch by id', () => {
      const all = watchesStore.listWatches();
      const first = all[0];
      const found = watchesStore.getWatch(first.id);
      assert.deepEqual(found, first);
    });

    it('returns null for non-existent id', () => {
      const found = watchesStore.getWatch('non-existent-id');
      assert.equal(found, null);
    });
  });

  describe('updateWatch', () => {
    it('updates a watch and returns patched version', () => {
      const all = watchesStore.listWatches();
      const first = all[0];
      const updated = watchesStore.updateWatch(first.id, {
        lastCheckedAt: '2026-07-10T12:00:00.000Z',
        label: 'updated label',
      });

      assert.ok(updated, 'should return updated watch');
      assert.equal(updated.lastCheckedAt, '2026-07-10T12:00:00.000Z');
      assert.equal(updated.label, 'updated label');
      assert.equal(updated.originQuery, first.originQuery, 'other fields preserved');
    });

    it('returns null for non-existent id', () => {
      const result = watchesStore.updateWatch('non-existent-id', { label: 'nope' });
      assert.equal(result, null);
    });

    it('persists the update', () => {
      const all = watchesStore.listWatches();
      const first = all[0];
      const found = watchesStore.getWatch(first.id);
      assert.equal(found.label, 'updated label');
    });
  });

  describe('removeWatch', () => {
    it('removes a watch and returns true', () => {
      const all = watchesStore.listWatches();
      const toRemove = all[0];
      const result = watchesStore.removeWatch(toRemove.id);
      assert.equal(result, true);
    });

    it('returns false for non-existent id', () => {
      const result = watchesStore.removeWatch('non-existent-id');
      assert.equal(result, false);
    });

    it('watch is gone after removal', () => {
      const all = watchesStore.listWatches();
      assert.equal(all.length, 1, 'should have 1 watch remaining');
    });
  });
});
