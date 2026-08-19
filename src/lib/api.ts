const BASE = '/api';
const TIMEOUT_MS = 15000;
const ROLE_TOKEN_KEY = 'ce_role_token';

export type ApiRole = 'kitchen' | 'driver';

export const UNAUTHORIZED_EVENT = 'ce:unauthorized';

export function readRoleTokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(ROLE_TOKEN_KEY) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function writeRoleTokens(tokens: Record<string, string>): void {
  localStorage.setItem(ROLE_TOKEN_KEY, JSON.stringify(tokens));
}

export function clearRoleToken(role: ApiRole): void {
  const tokens = readRoleTokens();
  delete tokens[role];
  writeRoleTokens(tokens);
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function expireSession(role: ApiRole): void {
  clearRoleToken(role);
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { role } }));
}

async function request<T>(path: string, options: RequestInit = {}, role?: ApiRole): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (role) {
    const token = readRoleTokens()[role];
    if (token) headers['x-role-token'] = token;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, { ...options, headers, signal: controller.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (res.status === 401 && role) expireSession(role);
      throw new ApiError(body?.error || `Erro na requisição (${res.status})`, res.status);
    }
    return res.json() as Promise<T>;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('O servidor demorou demais para responder. Tente novamente.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface ApiClient {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
  patch: <T>(path: string, body?: unknown) => Promise<T>;
  delete: <T>(path: string) => Promise<T>;
}

/**
 * Each app states its credential up front: guessing the role from storage order
 * sends the wrong token when kitchen and driver are logged in on the same browser.
 */
export function createApi(role?: ApiRole): ApiClient {
  return {
    get: <T>(path: string) => request<T>(path, {}, role),
    post: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }, role),
    patch: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }, role),
    delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }, role),
  };
}

export const api = createApi();
export const kitchenApi = createApi('kitchen');
export const driverApi = createApi('driver');
