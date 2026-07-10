import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listProviders, getProvider, defaultProviderIds, PROVIDERS } from '../../src/providers/index.js';

describe('providers index', () => {
  describe('PROVIDERS', () => {
    it('contains 4 providers', () => {
      assert.equal(PROVIDERS.length, 4);
    });

    it('each provider has required fields', () => {
      for (const p of PROVIDERS) {
        assert.ok(p.id, `${p.id} has id`);
        assert.ok(p.name, `${p.id} has name`);
        assert.ok(p.region, `${p.id} has region`);
        assert.equal(typeof p.requiresBrowserSession, 'boolean', `${p.id} has requiresBrowserSession boolean`);
        assert.equal(typeof p.resolveLocation, 'function', `${p.id} has resolveLocation function`);
        assert.equal(typeof p.searchFares, 'function', `${p.id} has searchFares function`);
      }
    });
  });

  describe('listProviders', () => {
    it('returns metadata for all 4 providers', () => {
      const list = listProviders();
      assert.equal(list.length, 4);
    });

    it('each entry has id, name, region, requiresBrowserSession', () => {
      const list = listProviders();
      for (const p of list) {
        assert.ok(p.id);
        assert.ok(p.name);
        assert.ok(p.region);
        assert.equal(typeof p.requiresBrowserSession, 'boolean');
      }
    });

    it('does not expose internal methods (resolveLocation, searchFares)', () => {
      const list = listProviders();
      for (const p of list) {
        assert.equal(p.resolveLocation, undefined);
        assert.equal(p.searchFares, undefined);
      }
    });

    it('includes all expected providers', () => {
      const list = listProviders();
      const ids = list.map((p) => p.id);
      assert.ok(ids.includes('ryanair'));
      assert.ok(ids.includes('jetstar'));
      assert.ok(ids.includes('kupibilet'));
      assert.ok(ids.includes('spicejet'));
    });
  });

  describe('getProvider', () => {
    it('returns the correct provider by id', () => {
      const ryanair = getProvider('ryanair');
      assert.ok(ryanair);
      assert.equal(ryanair.id, 'ryanair');
      assert.equal(ryanair.name, 'Ryanair');
      assert.equal(ryanair.region, 'Europe');
    });

    it('returns kupibilet', () => {
      const p = getProvider('kupibilet');
      assert.ok(p);
      assert.equal(p.id, 'kupibilet');
      assert.equal(p.name, 'Kupibilet');
    });

    it('returns spicejet', () => {
      const p = getProvider('spicejet');
      assert.ok(p);
      assert.equal(p.id, 'spicejet');
    });

    it('returns jetstar', () => {
      const p = getProvider('jetstar');
      assert.ok(p);
      assert.equal(p.id, 'jetstar');
      assert.equal(p.requiresBrowserSession, true);
    });

    it('returns undefined for unknown id', () => {
      assert.equal(getProvider('nonexistent'), undefined);
    });

    it('returns undefined for empty string', () => {
      assert.equal(getProvider(''), undefined);
    });
  });

  describe('defaultProviderIds', () => {
    it('returns 3 providers (excludes jetstar)', () => {
      const ids = defaultProviderIds();
      assert.equal(ids.length, 3);
    });

    it('includes ryanair, kupibilet, spicejet', () => {
      const ids = defaultProviderIds();
      assert.ok(ids.includes('ryanair'));
      assert.ok(ids.includes('kupibilet'));
      assert.ok(ids.includes('spicejet'));
    });

    it('excludes jetstar (requiresBrowserSession)', () => {
      const ids = defaultProviderIds();
      assert.ok(!ids.includes('jetstar'));
    });

    it('all returned ids have requiresBrowserSession: false', () => {
      const ids = defaultProviderIds();
      for (const id of ids) {
        const p = getProvider(id);
        assert.equal(p.requiresBrowserSession, false, `${id} should not require browser session`);
      }
    });
  });
});
