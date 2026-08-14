import { api } from './api';
import { Driver } from '../types';

type AuthRole = 'kitchen' | 'driver';
const STORAGE_KEY = 'ce_role_token';
const PROFILE_KEY = 'ce_driver_profile';

function readTokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function writeTokens(tokens: Record<string, string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export async function login(
  role: AuthRole,
  pin: string,
  name?: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await api.post<{ token: string; role: string; driver?: Driver }>('/auth/login', {
      role,
      pin,
      name,
    });
    const tokens = readTokens();
    tokens[role] = res.token;
    writeTokens(tokens);
    if (role === 'driver' && res.driver) {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(res.driver));
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Servidor indisponível. Tente novamente.',
    };
  }
}

export function getDriverProfile(): Driver | null {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null') as Driver | null;
  } catch {
    return null;
  }
}

export function isAuthenticated(role: AuthRole): boolean {
  const tokens = readTokens();
  return Boolean(tokens[role]);
}

export function logout(role: AuthRole): void {
  const tokens = readTokens();
  delete tokens[role];
  writeTokens(tokens);
  if (role === 'driver') localStorage.removeItem(PROFILE_KEY);
}