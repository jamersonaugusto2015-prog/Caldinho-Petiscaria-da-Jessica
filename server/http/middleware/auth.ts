import type { NextFunction, Request, Response } from 'express';
import type { Driver } from '../../../contract/driver/types';
import type { ShopId } from '../../../contract/shop/types';
import { driverFromRequest, tokenFromRequest } from '../../driverSession';
import { getRoleToken } from '../../infra/secrets';
import { shopIdOf } from './tenant';

export type StaffRole = 'kitchen' | 'driver';

/**
 * Quem está falando, e de qual loja.
 *
 * As duas perguntas são UMA só, e é por isso que a resposta é um par. A
 * credencial não prova só o papel — ela prova o papel NAQUELA loja. Um token de
 * cozinha da loja A chegando no host da loja B tem que ser tão inútil quanto um
 * token inventado, e a única forma de garantir isso é a comparação já sair da
 * loja do `Host`: `getRoleToken(shopIdOf(req), 'kitchen')`.
 *
 * O header vazio nunca autentica: `getRoleToken` devolve `''` enquanto o papel
 * não tem token gravado, e a comparação `'' === ''` liberava a rota para
 * qualquer requisição sem header nenhum.
 */
export interface Staff {
  role: StaffRole;
  shopId: ShopId;
  /** Presente só quando o papel é `driver`: a identidade sai da credencial. */
  driver?: Driver;
}

export function staffOf(req: Request): Staff | null {
  const shopId = shopIdOf(req);
  const token = tokenFromRequest(req);

  if (token && token === getRoleToken(shopId, 'kitchen')) {
    return { role: 'kitchen', shopId };
  }

  const driver = driverFromRequest(shopId, req);
  if (driver) return { role: 'driver', shopId, driver };

  return null;
}

/** Só o papel. Para rotas que mudam de comportamento conforme quem chama. */
export function roleOf(req: Request): StaffRole | null {
  return staffOf(req)?.role ?? null;
}

/**
 * Exige um dos papéis. O motoboy resolvido fica em `res.locals.driver` — as
 * rotas leem de lá com `currentDriver(res)` em vez de aceitarem um `driverId`
 * vindo do cliente (ADR-0009).
 */
export function requireStaff(roles: StaffRole | StaffRole[]) {
  const aceitos = Array.isArray(roles) ? roles : [roles];

  return (req: Request, res: Response, next: NextFunction): void => {
    const staff = staffOf(req);
    if (!staff || !aceitos.includes(staff.role)) {
      res.status(401).json({ error: 'Não autorizado. Faça login com o PIN correto.' });
      return;
    }
    if (staff.driver) res.locals.driver = staff.driver;
    res.locals.staff = staff;
    next();
  };
}

// ---------------------------------------------------------------------------
// Freio de login
// ---------------------------------------------------------------------------

type Tentativa = { count: number; firstAt: number; lockedUntil: number; lockStrikes: number };

const JANELA_MS = 10 * 60 * 1000;
const MAX_TENTATIVAS = 5;
const BLOQUEIO_BASE_MS = 30 * 1000;
const BLOQUEIO_MAX_MS = 15 * 60 * 1000;

const tentativas = new Map<string, Tentativa>();

/**
 * A chave do freio inclui a LOJA.
 *
 * Sem ela, cinco tentativas erradas contra a loja A trancariam o login da loja
 * B para o mesmo IP — e um wi-fi de prédio ou uma operadora móvel põe centenas
 * de pessoas atrás do mesmo endereço. Seria uma loja capaz de derrubar o acesso
 * da outra sem querer.
 */
export function loginKey(shopId: ShopId, ip: string | undefined, papel: string): string {
  return `${shopId}:${ip || 'desconhecido'}:${papel}`;
}

function podar(): void {
  if (tentativas.size < 5000) return;
  const agora = Date.now();
  for (const [chave, t] of tentativas) {
    if (t.lockedUntil < agora && agora - t.firstAt > JANELA_MS) tentativas.delete(chave);
  }
}

/** Quanto falta do bloqueio, em milissegundos. `0` = pode tentar. */
export function loginBlockedMs(chave: string): number {
  const t = tentativas.get(chave);
  if (!t) return 0;
  const agora = Date.now();
  return t.lockedUntil > agora ? t.lockedUntil - agora : 0;
}

/** O bloqueio dobra a cada rodada de erros, até o teto. */
export function registerLoginFailure(chave: string): void {
  const agora = Date.now();
  let t = tentativas.get(chave);
  if (!t || agora - t.firstAt > JANELA_MS) {
    t = { count: 0, firstAt: agora, lockedUntil: 0, lockStrikes: 0 };
  }
  t.count += 1;
  if (t.count >= MAX_TENTATIVAS) {
    t.lockStrikes += 1;
    t.lockedUntil = agora + Math.min(BLOQUEIO_BASE_MS * 2 ** (t.lockStrikes - 1), BLOQUEIO_MAX_MS);
    t.count = 0;
    t.firstAt = agora;
  }
  tentativas.set(chave, t);
  podar();
}

export function registerLoginSuccess(chave: string): void {
  tentativas.delete(chave);
}

/** Só para os testes: zera o estado entre casos. */
export function resetLoginAttempts(): void {
  tentativas.clear();
}
