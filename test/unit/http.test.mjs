import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cached } from '../../src/lib/http.js';

describe('cached', () => {
  it('executes loader on first call', async () => {
    let callCount = 0;
    const result = await cached('test-first', 10000, async () => {
      callCount++;
      return 'value';
    });
    assert.equal(result, 'value');
    assert.equal(callCount, 1);
  });

  it('returns cached value on second call within TTL', async () => {
    let callCount = 0;
    const key = 'test-ttl-' + Date.now();
    await cached(key, 10000, async () => {
      callCount++;
      return 'cached';
    });
    await cached(key, 10000, async () => {
      callCount++;
      return 'different';
    });
    assert.equal(callCount, 1, 'loader should only be called once');
  });

  it('re-executes loader after TTL expires', async () => {
    let callCount = 0;
    const key = 'test-expire-' + Date.now();
    await cached(key, 50, async () => {
      callCount++;
      return 'first';
    });
    assert.equal(callCount, 1);

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 80));

    const result = await cached(key, 50, async () => {
      callCount++;
      return 'second';
    });
    assert.equal(callCount, 2, 'loader should be called again after TTL');
    assert.equal(result, 'second');
  });

  it('different keys are cached separately', async () => {
    let callCount = 0;
    await cached('key-a', 10000, async () => {
      callCount++;
      return 'a';
    });
    await cached('key-b', 10000, async () => {
      callCount++;
      return 'b';
    });
    assert.equal(callCount, 2, 'each key should call loader independently');
  });

  it('handles async loaders', async () => {
    const result = await cached('test-async-' + Date.now(), 10000, async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 42;
    });
    assert.equal(result, 42);
  });

  it('propagates loader errors', async () => {
    await assert.rejects(
      () => cached('test-error-' + Date.now(), 10000, async () => {
        throw new Error('loader failed');
      }),
      { message: 'loader failed' }
    );
  });

  it('caches successful result even if previous call errored', async () => {
    const key = 'test-recover-' + Date.now();
    // First call errors
    await cached(key, 10000, async () => {
      throw new Error('fail');
    }).catch(() => {});

    // Second call succeeds — should re-execute (error wasn't cached)
    let callCount = 0;
    const result = await cached(key, 10000, async () => {
      callCount++;
      return 'recovered';
    });
    assert.equal(result, 'recovered');
    assert.equal(callCount, 1, 'loader should be called since error was not cached');
  });

  it('caches complex objects', async () => {
    const key = 'test-obj-' + Date.now();
    const obj = { nested: { array: [1, 2, 3] } };
    const result = await cached(key, 10000, async () => obj);
    assert.deepEqual(result, obj);
    // Second call returns same reference
    const result2 = await cached(key, 10000, async () => ({ different: true }));
    assert.deepEqual(result2, obj);
  });
});
