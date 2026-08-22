import { randomBytes } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db';
import type { Driver } from '../contract/driver/types';
import type { ShopId } from '../contract/shop/types';
import { deletePushSubscriptionsForDriver } from './push';

/**
 * Sessão do Entregador: a credencial identifica QUAL motoboy, não apenas que é
 * um motoboy.
 *
 * O token de papel de `db.ts` prova só o papel — é o mesmo para a equipe inteira.
 * Enquanto o `driverId` chegava pelo corpo da requisição, aceitar corrida,
 * concluir entrega e mexer na presença eram ações que qualquer motoboy podia
 * fazer em nome de qualquer outro. Aqui a identidade sai da entrada e passa a
 * vir da credencial, num lugar só.
 *
 * Desativar ou apagar o motoboy revoga os tokens dele: o acesso morre junto com
 * o cadastro, em vez de sobreviver no localStorage de um ex-funcionário.
 */

const TOKEN_PREFIX = 'drv';

/** Campos do motoboy que podem sair do servidor. A senha nunca é um deles. */
export function publicDriver(driver: Driver): Driver {
  const { password: _password, ...safe } = driver;
  return safe as Driver;
}

export function issueDriverToken(shopId: ShopId, driverId: string): string {
  const token = `${TOKEN_PREFIX}-${randomBytes(32).toString('hex')}`;
  db.prepare(
    'INSERT INTO driver_tokens (token, shop_id, driver_id, created_at) VALUES (?, ?, ?, ?)'
  ).run(token, shopId, driverId, new Date().toISOString());
  return token;
}

export function revokeDriverTokens(shopId: ShopId, driverId: string): void {
  db.prepare('DELETE FROM driver_tokens WHERE shop_id = ? AND driver_id = ?').run(shopId, driverId);
  // A inscrição de push morre junto com a credencial, e morre AQUI para nenhuma
  // rota poder esquecer: com o token revogado mas a inscrição de pé, o celular
  // do ex-funcionário continuava recebendo cada corrida nova — bairro,
  // distância e taxa da operação inteira, na tela de bloqueio.
  deletePushSubscriptionsForDriver(shopId, driverId);
}

export function revokeDriverToken(token: string): void {
  if (!token) return;
  db.prepare('DELETE FROM driver_tokens WHERE token = ?').run(token);
}

/**
 * Resolve o motoboy dono do token. Um motoboy desativado não resolve: a
 * checagem de `active` mora aqui para não depender de cada rota lembrar dela.
 */
export function driverFromToken(shopId: ShopId, token: string): Driver | null {
  if (!token || typeof token !== 'string') return null;
  // A loja entra na consulta do TOKEN, não só na do motoboy: a credencial de um
  // motoboy da loja A não pode valer nada no host da loja B, nem por um
  // instante. Conferir a loja depois de resolver o motoboy já seria tarde — o
  // token teria sido aceito.
  const row = db
    .prepare('SELECT driver_id FROM driver_tokens WHERE shop_id = ? AND token = ?')
    .get(shopId, token) as { driver_id: string } | undefined;
  if (!row) return null;
  const driverRow = db
    .prepare('SELECT data FROM drivers WHERE shop_id = ? AND id = ?')
    .get(shopId, row.driver_id) as { data: string } | undefined;
  if (!driverRow) return null;
  const driver = JSON.parse(driverRow.data) as Driver;
  return driver.active ? driver : null;
}

export function tokenFromRequest(req: Request): string {
  const header = req.get('x-role-token');
  return typeof header === 'string' ? header.trim() : '';
}

export function driverFromRequest(shopId: ShopId, req: Request): Driver | null {
  return driverFromToken(shopId, tokenFromRequest(req));
}

/**
 * Middleware: só passa quem prova ser um motoboy específico. O motoboy resolvido
 * fica em `res.locals.driver` — as rotas leem de lá com `currentDriver(res)` em
 * vez de aceitarem um `driverId` do cliente.
 */
export function requireDriver(shopId: ShopId, req: Request, res: Response, next: NextFunction): void {
  const driver = driverFromRequest(shopId, req);
  if (!driver) {
    res.status(401).json({ error: 'Não autorizado.' });
    return;
  }
  res.locals.driver = driver;
  next();
}

export function currentDriver(res: Response): Driver {
  const driver = res.locals.driver as Driver | undefined;
  if (!driver) throw new Error('currentDriver chamado fora de uma rota com requireDriver');
  return driver;
}
