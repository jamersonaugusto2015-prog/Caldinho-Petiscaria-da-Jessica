import { useEffect, useState } from 'react';
import { api, readRoleTokens, writeRoleTokens, UNAUTHORIZED_EVENT } from './api';
import type { ApiRole } from './api';
import { Driver } from '../types';

type AuthRole = ApiRole;
const PROFILE_KEY = 'ce_driver_profile';

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
    const tokens = readRoleTokens();
    tokens[role] = res.token;
    writeRoleTokens(tokens);
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

export function saveDriverProfile(driver: Driver): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(driver));
}

export function getDriverProfile(): Driver | null {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null') as Driver | null;
  } catch {
    return null;
  }
}

export function getStoredRoleToken(role: AuthRole): string {
  return readRoleTokens()[role] || '';
}

export function isAuthenticated(role: AuthRole): boolean {
  return Boolean(readRoleTokens()[role]);
}

export function logout(role: AuthRole): void {
  const tokens = readRoleTokens();
  delete tokens[role];
  writeRoleTokens(tokens);
  if (role === 'driver') localStorage.removeItem(PROFILE_KEY);
}

/**
 * Tracks the role session, including expiry detected by the api adapter on a 401,
 * so a stale token drops the app back to the login gate instead of looping errors.
 */
export function useRoleSession(role: AuthRole): { authenticated: boolean; expired: boolean; refresh: () => void } {
  const [authenticated, setAuthenticated] = useState(() => isAuthenticated(role));
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const onUnauthorized = (event: Event) => {
      const detail = (event as CustomEvent<{ role: AuthRole }>).detail;
      if (detail?.role !== role) return;
      if (role === 'driver') localStorage.removeItem(PROFILE_KEY);
      setAuthenticated(false);
      setExpired(true);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [role]);

  return {
    authenticated,
    expired,
    refresh: () => {
      setAuthenticated(isAuthenticated(role));
      setExpired(false);
    },
  };
}
