import { useEffect, useState } from 'react';
import {
  PLATFORM_UNAUTHORIZED_EVENT,
  clearPlatformToken,
  platformApi,
  readPlatformToken,
  writePlatformToken,
} from './platformApi';

/** O administrador da plataforma, como o servidor devolve. */
export interface PlatformAdmin {
  id: number;
  email: string;
  name: string;
  active: boolean;
  createdAt: string;
}

export async function platformLogin(
  email: string,
  password: string
): Promise<{ ok: true; admin: PlatformAdmin } | { ok: false; error: string }> {
  try {
    const res = await platformApi.post<{ token: string; admin: PlatformAdmin }>('/login', { email, password });
    writePlatformToken(res.token);
    return { ok: true, admin: res.admin };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Servidor indisponível. Tente de novo.' };
  }
}

export function platformLogout(): void {
  // A saída acontece no navegador na hora: o admin não pode ficar preso na
  // tela porque a rede caiu. Revogar o token no servidor é só limpeza — se
  // falhar, o token ainda expira sozinho em 7 dias.
  void platformApi.post('/logout').catch(() => undefined);
  clearPlatformToken();
}

export function usePlatformSession(): {
  admin: PlatformAdmin | null;
  authenticated: boolean;
  expired: boolean;
  setAdmin: (admin: PlatformAdmin) => void;
  logout: () => void;
} {
  const [admin, setAdminState] = useState<PlatformAdmin | null>(null);
  const [authenticated, setAuthenticated] = useState(() => Boolean(readPlatformToken()));
  const [expired, setExpired] = useState(false);

  // Ao montar com um token guardado, CONFIRMA a sessão no servidor via `/me` e
  // carrega o admin. Antes o painel confiava só na presença do token: um token
  // adulterado ou vencido renderizava a casca inteira e só era barrado no
  // primeiro fetch de dados. Um 401 aqui dispara o mesmo evento que limpa tudo.
  useEffect(() => {
    if (!readPlatformToken() || admin) return;
    let vivo = true;
    void platformApi
      .get<PlatformAdmin>('/me')
      .then((me) => {
        if (vivo) {
          setAdminState(me);
          setAuthenticated(true);
        }
      })
      .catch(() => {
        /* 401 já disparou PLATFORM_UNAUTHORIZED_EVENT no platformApi */
      });
    return () => {
      vivo = false;
    };
  }, [admin]);

  useEffect(() => {
    const onUnauthorized = () => {
      setAuthenticated(false);
      setAdminState(null);
      setExpired(true);
    };
    window.addEventListener(PLATFORM_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(PLATFORM_UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  return {
    admin,
    authenticated,
    expired,
    setAdmin: (next) => {
      setAdminState(next);
      setAuthenticated(true);
      setExpired(false);
    },
    logout: () => {
      platformLogout();
      setAuthenticated(false);
      setAdminState(null);
      setExpired(false);
    },
  };
}
