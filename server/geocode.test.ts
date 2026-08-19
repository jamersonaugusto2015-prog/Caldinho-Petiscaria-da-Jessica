import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// server/geocode.ts's default cache store opens the real sqlite file at DATA_DIR (via ./db) the
// moment it is imported. This override MUST run before ./geocode is loaded (hence the dynamic
// import below), or these tests would run against real data. The tests below never exercise the
// default store anyway — they always inject a fake cache and a fake fetch — but the import chain
// still touches ./db, so the override is required regardless.
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'caldinho-geocode-test-'));

const { createIpThrottle, nominatimSearch, viaCepLookup } = await import('./geocode');

function fakeCache() {
  const store = new Map<string, string>();
  return {
    get: (key: string) => store.get(key),
    set: (key: string, value: string) => {
      store.set(key, value);
    },
    store,
  };
}

function fakeFetchJson(status: number, body: unknown): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response) as typeof fetch;
}

function fakeFetchNever(): typeof fetch {
  return (async () => {
    throw new Error('a rede não deveria ser chamada neste teste');
  }) as typeof fetch;
}

// ---------- throttle ----------

test('shouldThrottle allows requests under the limit and blocks the one that exceeds it', () => {
  let now = 0;
  const throttle = createIpThrottle(() => now);
  assert.equal(throttle.shouldThrottle('1.1.1.1', 3, 10000), false);
  assert.equal(throttle.shouldThrottle('1.1.1.1', 3, 10000), false);
  assert.equal(throttle.shouldThrottle('1.1.1.1', 3, 10000), false);
  assert.equal(throttle.shouldThrottle('1.1.1.1', 3, 10000), true);
});

test('shouldThrottle tracks each ip independently', () => {
  let now = 0;
  const throttle = createIpThrottle(() => now);
  throttle.shouldThrottle('1.1.1.1', 1, 10000);
  assert.equal(throttle.shouldThrottle('1.1.1.1', 1, 10000), true);
  assert.equal(throttle.shouldThrottle('2.2.2.2', 1, 10000), false);
});

test('shouldThrottle forgets hits once they fall outside the window', () => {
  let now = 0;
  const throttle = createIpThrottle(() => now);
  throttle.shouldThrottle('1.1.1.1', 1, 10000);
  assert.equal(throttle.shouldThrottle('1.1.1.1', 1, 10000), true);
  now += 10001;
  assert.equal(throttle.shouldThrottle('1.1.1.1', 1, 10000), false);
});

test('shouldThrottle lets two different limits share one throttle instance, as /geocode and /cep do', () => {
  // Mirrors the production wiring: one instance, two routes with different limits, same ip
  // counts against both.
  let now = 0;
  const throttle = createIpThrottle(() => now);
  for (let i = 0; i < 6; i++) assert.equal(throttle.shouldThrottle('1.1.1.1', 6, 10000), false);
  // The 6 hits above already count toward the /cep-style limit of 10 for the same ip.
  for (let i = 0; i < 4; i++) assert.equal(throttle.shouldThrottle('1.1.1.1', 10, 10000), false);
  assert.equal(throttle.shouldThrottle('1.1.1.1', 10, 10000), true);
});

// ---------- nominatimSearch ----------

test('nominatimSearch returns null without hitting the network when the cache has a value', async () => {
  const cache = fakeCache();
  cache.store.set('geo:rua teste, recife', JSON.stringify({ lat: -8.05, lng: -34.9, label: 'Rua Teste' }));
  const result = await nominatimSearch('Rua Teste, Recife', { cache, fetchImpl: fakeFetchNever() });
  assert.deepEqual(result, { lat: -8.05, lng: -34.9, label: 'Rua Teste' });
});

test('nominatimSearch normalizes the cache key by trimming and lowercasing the query', async () => {
  const cache = fakeCache();
  cache.store.set('geo:rua teste', JSON.stringify({ lat: 1, lng: 2, label: 'X' }));
  const result = await nominatimSearch('  Rua Teste  ', { cache, fetchImpl: fakeFetchNever() });
  assert.ok(result);
});

test('nominatimSearch fetches, shapes and caches the first Nominatim result on a miss', async () => {
  const cache = fakeCache();
  const fetchImpl = fakeFetchJson(200, [{ lat: '-8.05', lon: '-34.90', display_name: 'Rua Teste, Recife' }]);
  const result = await nominatimSearch('Rua Teste', { cache, fetchImpl });
  assert.deepEqual(result, { lat: -8.05, lng: -34.9, label: 'Rua Teste, Recife' });
  assert.equal(cache.store.get('geo:rua teste'), JSON.stringify(result));
});

test('nominatimSearch returns null for an empty Nominatim result and does not cache it', async () => {
  const cache = fakeCache();
  const fetchImpl = fakeFetchJson(200, []);
  const result = await nominatimSearch('endereço inexistente', { cache, fetchImpl });
  assert.equal(result, null);
  assert.equal(cache.store.size, 0);
});

test('nominatimSearch returns null when the upstream request is not ok', async () => {
  const cache = fakeCache();
  const fetchImpl = fakeFetchJson(500, {});
  const result = await nominatimSearch('qualquer coisa', { cache, fetchImpl });
  assert.equal(result, null);
});

test('nominatimSearch propagates a network failure so the route can turn it into a 502', async () => {
  const cache = fakeCache();
  await assert.rejects(() => nominatimSearch('qualquer coisa', { cache, fetchImpl: fakeFetchNever() }));
});

// ---------- viaCepLookup ----------

test('viaCepLookup shapes a found address', async () => {
  const fetchImpl = fakeFetchJson(200, {
    cep: '50000-000',
    logradouro: 'Rua Teste',
    bairro: 'Centro',
    localidade: 'Recife',
    uf: 'PE',
  });
  const result = await viaCepLookup('50000000', fetchImpl);
  assert.deepEqual(result, { cep: '50000-000', street: 'Rua Teste', neighborhood: 'Centro', city: 'Recife - PE' });
});

test('viaCepLookup returns null when ViaCEP reports the CEP does not exist', async () => {
  const fetchImpl = fakeFetchJson(200, { erro: true });
  const result = await viaCepLookup('00000000', fetchImpl);
  assert.equal(result, null);
});

test('viaCepLookup fills missing street/neighborhood with an empty string', async () => {
  const fetchImpl = fakeFetchJson(200, { cep: '50000-000', localidade: 'Recife', uf: 'PE' });
  const result = await viaCepLookup('50000000', fetchImpl);
  assert.equal(result?.street, '');
  assert.equal(result?.neighborhood, '');
});

test('viaCepLookup propagates a network failure so the route can turn it into a 502', async () => {
  await assert.rejects(() => viaCepLookup('50000000', fakeFetchNever()));
});
