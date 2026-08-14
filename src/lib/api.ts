const BASE = '/api';
const TIMEOUT_MS = 15000;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  const token = localStorage.getItem('ce_role_token');
  if (token) {
    try {
      const parsed = JSON.parse(token);
      const role = Object.keys(parsed)[0];
      if (parsed[role]) headers['x-role-token'] = parsed[role];
    } catch {
      /* token inválido, ignora */
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, { ...options, headers, signal: controller.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || `Erro na requisição (${res.status})`);
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

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
