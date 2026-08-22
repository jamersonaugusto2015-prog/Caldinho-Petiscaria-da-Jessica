import type { NextFunction, Request, Response } from 'express';
import type { PlatformAdmin } from '../../domain/platform/admins';
import { platformAdminFromToken } from '../../domain/platform/admins';

/**
 * O guarda da plataforma.
 *
 * Nada aqui olha `req.shop`: as rotas de plataforma vivem FORA de qualquer
 * loja, e é justamente esse o ponto. O header é outro (`x-platform-token`) para
 * que um token de loja mandado por engano no lugar errado não seja nem lido.
 */
declare module 'express-serve-static-core' {
  interface Request {
    /** O administrador de plataforma desta requisição. */
    platformAdmin?: PlatformAdmin;
  }
}

export function platformTokenFromRequest(req: Request): string {
  const header = req.get('x-platform-token');
  return typeof header === 'string' ? header.trim() : '';
}

export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  const admin = platformAdminFromToken(platformTokenFromRequest(req));
  if (!admin) {
    res.status(401).json({ error: 'Não autorizado.' });
    return;
  }
  req.platformAdmin = admin;
  next();
}

export function currentPlatformAdmin(req: Request): PlatformAdmin {
  if (!req.platformAdmin) {
    throw new Error('currentPlatformAdmin chamado fora de uma rota com requirePlatformAdmin');
  }
  return req.platformAdmin;
}
