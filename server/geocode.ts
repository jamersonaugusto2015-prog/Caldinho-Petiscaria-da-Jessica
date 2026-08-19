import { db } from './db';

// ---------- Limite de requisições por IP ----------
export interface IpThrottle {
  shouldThrottle(ip: string, limit: number, windowMs: number): boolean;
}

export function createIpThrottle(now: () => number = Date.now): IpThrottle {
  const hits = new Map<string, number[]>();
  return {
    shouldThrottle(ip, limit, windowMs) {
      const t = now();
      const arr = (hits.get(ip) || []).filter((x) => t - x < windowMs);
      if (arr.length >= limit) return true;
      arr.push(t);
      hits.set(ip, arr);
      return false;
    },
  };
}

/**
 * Uma única instância compartilhada entre /geocode e /cep: as duas rotas contam para o
 * mesmo limite por IP, como no código original.
 */
export const geoThrottle = createIpThrottle();

// ---------- Busca de endereço (Nominatim) com cache ----------
export interface GeoResult {
  lat: number;
  lng: number;
  label: string;
}

export interface GeoCacheStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

function dbGeoCacheStore(): GeoCacheStore {
  return {
    get(key) {
      const cached = db.prepare('SELECT value FROM geo_cache WHERE query = ?').get(key) as
        | { value: string }
        | undefined;
      return cached?.value;
    },
    set(key, value) {
      db.prepare(
        'INSERT INTO geo_cache (query, value) VALUES (?, ?) ON CONFLICT(query) DO UPDATE SET value = excluded.value'
      ).run(key, value);
    },
  };
}

export interface NominatimSearchDeps {
  cache?: GeoCacheStore;
  fetchImpl?: typeof fetch;
}

export async function nominatimSearch(
  query: string,
  deps: NominatimSearchDeps = {}
): Promise<GeoResult | null> {
  const cache = deps.cache ?? dbGeoCacheStore();
  const fetchImpl = deps.fetchImpl ?? fetch;

  const key = 'geo:' + query.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);

  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=' +
    encodeURIComponent(query);
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': 'CaldinhoExpress/1.0 (app de delivery)' },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (!data.length) return null;
  const result: GeoResult = {
    lat: Number(data[0].lat),
    lng: Number(data[0].lon),
    label: data[0].display_name,
  };
  cache.set(key, JSON.stringify(result));
  return result;
}

// ---------- CEP (ViaCEP) ----------
export interface CepResult {
  cep: string;
  street: string;
  neighborhood: string;
  city: string;
}

export async function viaCepLookup(cep: string, fetchImpl: typeof fetch = fetch): Promise<CepResult | null> {
  const viacep = await fetchImpl(`https://viacep.com.br/ws/${cep}/json/`);
  const data = await viacep.json();
  if (data.erro) return null;
  return {
    cep: data.cep,
    street: data.logradouro || '',
    neighborhood: data.bairro || '',
    city: `${data.localidade} - ${data.uf}`,
  };
}
