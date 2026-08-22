import { Router } from 'express';
import type { Server } from 'socket.io';
import { appShellRouter } from './http/routers/appShell';
import { authRouter } from './http/routers/auth';
import { catalogRouter } from './http/routers/catalog';
import { chatRouter } from './http/routers/chat';
import { couponsRouter } from './http/routers/coupons';
import { driversRouter } from './http/routers/drivers';
import { geoRouter } from './http/routers/geo';
import { loyaltyRouter } from './http/routers/loyalty';
import { orderActionsRouter } from './http/routers/orderActions';
import { ordersRouter } from './http/routers/orders';
import { paymentsRouter } from './http/routers/payments';
import { promotionsRouter } from './http/routers/promotions';
import { pushRouter } from './http/routers/push';
import { reportsRouter } from './http/routers/reports';
import { settingsRouter } from './http/routers/settings';
import { storeRouter } from './http/routers/store';
import { uploadsRouter } from './http/routers/uploads';

export { errorHandler } from './http/middleware/errors';
export { emitOrder, orderEventContext } from './orderEvents';

/**
 * O índice da API: quem atende o quê.
 *
 * Isto era um arquivo de 1.209 linhas com sessenta e poucas rotas, os
 * middlewares de autenticação, o freio de login, o tratador de erros e a
 * persistência de motoboy e chat, tudo junto. Uma rota nova nascia no meio de
 * outras trinta e herdava o que houvesse por perto.
 *
 * Hoje nenhum par de routers compartilha um mesmo caminho — o Express casa
 * caminho inteiro, então a ordem entre eles não muda o roteamento. A ordem
 * fica por leitura (fluxo do pedido junto), não por necessidade. Se um dia
 * entrar um curinga como `/orders/:id`, aí sim o mais específico
 * (`/orders/:id/chat`) precisa ser registrado ANTES dele.
 *
 * A LOJA já foi resolvida antes daqui, por `middleware/tenant.ts` — nenhum
 * router chama a resolução por conta própria.
 */
export function createRoutes(io: Server): Router {
  const router = Router();

  router.use(appShellRouter());
  router.use(pushRouter());
  router.use(authRouter());
  router.use(uploadsRouter());
  router.use(geoRouter());
  router.use(catalogRouter(io));

  router.use(ordersRouter(io));
  router.use(orderActionsRouter(io));
  router.use(chatRouter(io));

  router.use(reportsRouter());
  router.use(loyaltyRouter(io));
  router.use(settingsRouter(io));
  router.use(paymentsRouter(io));
  router.use(storeRouter(io));
  router.use(couponsRouter(io));
  router.use(promotionsRouter(io));
  router.use(driversRouter(io));

  return router;
}
