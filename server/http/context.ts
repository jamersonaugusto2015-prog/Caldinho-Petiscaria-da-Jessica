import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'socket.io';
import type { Order } from '../../contract/order/types';
import type { ShopId } from '../../contract/shop/types';
import { createOrderIntake, type OrderIntake } from '../orderIntake';
import { orderIntakeDeps } from '../domain/deps';
import { getOrder } from '../orderStore';
import { requireDriver } from '../driverSession';
import { shopIdOf } from './middleware/tenant';

/**
 * O que todo router precisa e nenhum deles deveria montar sozinho.
 *
 * `routes.ts` tinha 1.209 linhas e sessenta e poucas rotas, com os ajudantes
 * (`driverGuard`, `getOrderOr404`, o intake) declarados no meio delas. Quebrar
 * o arquivo sem isto significaria copiar esses ajudantes em cada pedaço — e
 * cópia é onde a mesma regra passa a ter duas versões.
 *
 * Nada aqui tem regra de negócio: são fios.
 */
export interface RouterContext {
  io: Server;
}

/**
 * O guarda do motoboy, montado com a loja do `Host`.
 *
 * `requireDriver` confere que o token é DAQUELA loja: a credencial de um
 * motoboy da loja A não pode valer nada no host da loja B.
 */
export const driverGuard = (req: Request, res: Response, next: NextFunction): void =>
  requireDriver(shopIdOf(req), req, res, next);

/**
 * O intake é montado POR REQUISIÇÃO, e não uma vez no boot: ele carrega o
 * cardápio, os cupons e as promoções DAQUELA loja. Um intake montado no boot
 * atenderia todo mundo com o catálogo de uma loja só.
 */
export const intakeFor = (shopId: ShopId): OrderIntake => createOrderIntake(orderIntakeDeps(shopId));

/** O pedido da loja do `Host`, ou `null`. Nunca alcança pedido de outra loja. */
export const orderOr404 = (req: Request, id: string): Order | null => getOrder(shopIdOf(req), id);
