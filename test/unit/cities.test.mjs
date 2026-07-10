import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cityOverride, CITY_OVERRIDES } from '../../src/lib/cities.js';

describe('cityOverride', () => {
  it('resolves Moscow for kupibilet (Russian)', () => {
    assert.equal(cityOverride('москва', 'kupibilet'), 'MOW');
  });

  it('resolves Moscow for kupibilet (English)', () => {
    assert.equal(cityOverride('moscow', 'kupibilet'), 'MOW');
  });

  it('resolves Saint Petersburg for kupibilet (Russian full)', () => {
    assert.equal(cityOverride('санкт-петербург', 'kupibilet'), 'LED');
  });

  it('resolves Saint Petersburg for kupibilet (Питер)', () => {
    assert.equal(cityOverride('питер', 'kupibilet'), 'LED');
  });

  it('resolves Saint Petersburg for kupibilet (English)', () => {
    assert.equal(cityOverride('st petersburg', 'kupibilet'), 'LED');
  });

  it('resolves Sochi for kupibilet (Russian)', () => {
    assert.equal(cityOverride('сочи', 'kupibilet'), 'AER');
  });

  it('resolves Adler for kupibilet', () => {
    assert.equal(cityOverride('адлер', 'kupibilet'), 'AER');
  });

  it('resolves Sochi for kupibilet (English)', () => {
    assert.equal(cityOverride('sochi', 'kupibilet'), 'AER');
  });

  it('resolves London for ryanair (Russian)', () => {
    assert.equal(cityOverride('лондон', 'ryanair'), 'STN');
  });

  it('resolves London for ryanair (English)', () => {
    assert.equal(cityOverride('london', 'ryanair'), 'STN');
  });

  it('resolves Dublin for ryanair (Russian)', () => {
    assert.equal(cityOverride('дублин', 'ryanair'), 'DUB');
  });

  it('resolves Dublin for ryanair (English)', () => {
    assert.equal(cityOverride('dublin', 'ryanair'), 'DUB');
  });

  it('resolves Singapore for jetstar (Russian)', () => {
    assert.equal(cityOverride('сингапур', 'jetstar'), 'SIN');
  });

  it('resolves Singapore for jetstar (English)', () => {
    assert.equal(cityOverride('singapore', 'jetstar'), 'SIN');
  });

  it('resolves Delhi for spicejet (Russian)', () => {
    assert.equal(cityOverride('дели', 'spicejet'), 'DEL');
  });

  it('resolves Delhi for spicejet (English)', () => {
    assert.equal(cityOverride('delhi', 'spicejet'), 'DEL');
  });

  it('resolves Mumbai for spicejet (Russian)', () => {
    assert.equal(cityOverride('мумбаи', 'spicejet'), 'BOM');
  });

  it('resolves Mumbai for spicejet (English)', () => {
    assert.equal(cityOverride('mumbai', 'spicejet'), 'BOM');
  });

  it('returns null for wrong provider (Moscow on ryanair)', () => {
    assert.equal(cityOverride('москва', 'ryanair'), null);
  });

  it('returns null for unknown city', () => {
    assert.equal(cityOverride('unknown city', 'kupibilet'), null);
  });

  it('returns null for unknown provider', () => {
    assert.equal(cityOverride('москва', 'nonexistent'), null);
  });

  it('trims whitespace from query', () => {
    assert.equal(cityOverride('  Москва  ', 'kupibilet'), 'MOW');
  });

  it('is case-insensitive', () => {
    assert.equal(cityOverride('Moscow', 'kupibilet'), 'MOW');
    assert.equal(cityOverride('MOSCOW', 'kupibilet'), 'MOW');
  });
});

describe('CITY_OVERRIDES structure', () => {
  it('has entries for all 4 providers', () => {
    const providers = new Set();
    for (const overrides of Object.values(CITY_OVERRIDES)) {
      for (const pid of Object.keys(overrides)) {
        providers.add(pid);
      }
    }
    assert.ok(providers.has('kupibilet'), 'has kupibilet entries');
    assert.ok(providers.has('ryanair'), 'has ryanair entries');
    assert.ok(providers.has('jetstar'), 'has jetstar entries');
    assert.ok(providers.has('spicejet'), 'has spicejet entries');
  });

  it('has Russian and English variants for major cities', () => {
    assert.ok(CITY_OVERRIDES['москва']);
    assert.ok(CITY_OVERRIDES['moscow']);
    assert.ok(CITY_OVERRIDES['лондон']);
    assert.ok(CITY_OVERRIDES['london']);
    assert.ok(CITY_OVERRIDES['сингапур']);
    assert.ok(CITY_OVERRIDES['singapore']);
  });
});
