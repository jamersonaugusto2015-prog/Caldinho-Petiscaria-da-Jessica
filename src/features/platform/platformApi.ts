const BASE = '/api/platform';
const TIMEOUT_MS = 15000;
const TOKEN_KEY = 'ce_platform_token';

/**
 * Cliente HTTP próprio do painel de plataforma.
 *
 * `src/lib/api.ts` manda `x-role-token`, que é a credencial de UMA loja
 * (cozinha ou entregador). Um token de plataforma abre TODAS as lojas — não
 * pode viajar no mesmo header nem morar na mesma chave do `localStorage`, ou
 * um logout de cozinha apagaria também a sessão do dono da plataforma.
 */

export const PLATFORM_UNAUTHORIZED_EVENT = 'ce:platform-unauthorized';

export class PlatformApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'PlatformApiError';
    this.status = status;
  }
}

export function readPlatformToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function writePlatformToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearPlatformToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = readPlatformToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers['x-platform-token'] = token;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, { ...options, headers, signal: controller.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      // Só um token que EXISTIA pode ter expirado. Sem esta checagem, a
      // própria tela de login dispararia o evento de "sessão expirada" a
      // cada senha digitada errada.
      if (res.status === 401 && token) {
        clearPlatformToken();
        window.dispatchEvent(new CustomEvent(PLATFORM_UNAUTHORIZED_EVENT));
      }
      throw new PlatformApiError(body?.error || `Erro na requisição (${res.status})`, res.status);
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

export const platformApi = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
};
