import { Router } from 'express';
import type { Request } from 'express';
import type { Server } from 'socket.io';
import type { Driver } from '../../../contract/driver/types';
import type { Order, OrderStatus } from '../../../contract/order/types';
import type { OrderIntakeInput } from '../../orderIntake';
import { orderForDriver } from '../../../contract/order/views';
import { customerRoom } from '../../../contract/shop/rooms';
import { orderLifecycleDeps } from '../../domain/deps';
import { currentDriver, driverFromRequest } from '../../driverSession';
import { DomainError } from '../../errors';
import { errorHandler } from '../../http/middleware/errors';
import { publicBaseUrl } from '../../mercadopago';
import { emitOrder, orderEventContext } from '../../orderEvents';
import { applyOrderEvent } from '../../orderLifecycle';
import { getOrder, listOrders } from '../../orderStore';
import { settlePayment } from '../../payment';
import { driverGuard } from '../context';
import { requireStaff, roleOf } from '../middleware/auth';
import { asyncRoute } from '../middleware/errors';
import { createIpThrottle, throttleKey } from '../../geocode';
import { intakeFor, orderOr404 } from '../context';
import { shopIdOf } from '../middleware/tenant';

/**
 * O pedido: criação, listagem e avanço de status.
 *
 * Router: traduz, autentica e delega. Zero regra de negócio.
 */
/**
 * Freio de criação de pedido, separado do freio de geocodificação: são custos
 * diferentes (um bate no Nominatim, o outro cria cobrança no Mercado Pago) e
 * não devem dividir a mesma cota.
 */
const orderThrottle = createIpThrottle();

export function ordersRouter(io: Server): Router {
  const router = Router();

  // ---------- Orders ----------
  router.get('/orders', (req, res) => {
    const customerId = typeof req.query.customerId === 'string' ? req.query.customerId.trim() : '';

    if (roleOf(req) === 'kitchen') {
      return res.json(listOrders(shopIdOf(req)));
    }

    // O motoboy é avaliado antes do ramo do cliente: senão bastaria mandar um
    // `customerId` na query para sair pela rota do cliente e receber o pedido
    // inteiro, sem redação.
    const driver = driverFromRequest(shopIdOf(req), req);
    if (driver) {
      // O `driverId` da query é ignorado de propósito: a identidade vem da
      // credencial, nunca da entrada.
      const orders = listOrders(shopIdOf(req))
        .filter(
          (o) =>
            (o.status === 'pronto' && !o.driverId && o.fulfillment !== 'pickup') ||
            o.driverId === driver.id
        )
        .map((o) => orderForDriver(o, driver.id));
      return res.json(orders);
    }

    // O `customerId` é um UUID aleatório do dispositivo: funciona como
    // capability, quem não o tem não chega aos pedidos.
    if (customerId && customerId !== 'anon') {
      return res.json(listOrders(shopIdOf(req), { customerId }));
    }

    return res.status(401).json({ error: 'Não autorizado.' });
  });

  router.post('/orders', asyncRoute(async (req, res) => {
    // Cada pedido pode disparar uma cobrança no Mercado Pago. Sem freio, um
    // laço no navegador vira uma enxurrada de cobranças e de pedidos falsos na
    // cozinha. 5 pedidos por minuto por IP é folgado para uma pessoa real
    // (inclusive numa família dividindo o mesmo wi-fi) e mata o laço.
    if (orderThrottle.shouldThrottle(throttleKey(shopIdOf(req), req.ip), 5, 60_000)) {
      return res.status(429).json({ error: 'Muitos pedidos seguidos. Espere um minuto e tente de novo.' });
    }
    const host = req.get('host') || undefined;
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const notificationUrl = `${publicBaseUrl(host, proto)}/api/mercadopago/webhook`;
    try {
      const result = await intakeFor(shopIdOf(req)).placeOrder({
        ...((req.body ?? {}) as OrderIntakeInput),
        notificationUrl,
      });
      emitOrder(io, shopIdOf(req), 'order:new', result.order);
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof DomainError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error('[orders] falha inesperada ao criar pedido:', err);
      res.status(500).json({ error: 'Não foi possível criar o pedido.' });
    }
  }));


  router.patch('/orders/:id/status', requireStaff(['kitchen', 'driver']), (req, res) => {
    const order = orderOr404(req, req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    // `requireRole` já resolveu o motoboy: se há um em `res.locals`, quem
    // chama é ele. O `driverId` do corpo é ignorado.
    const driver = (res.locals.driver as Driver | undefined) ?? null;
    const actor = driver ? 'driver' : 'kitchen';
    try {
      const result = applyOrderEvent(
        order,
        {
          type: 'advance',
          status: req.body?.status as OrderStatus,
          actor,
          driverId: driver?.id,
        },
        orderLifecycleDeps(shopIdOf(req))
      );
      if (result.loyaltyPoints !== undefined && result.order.customerId) {
        io.to(customerRoom(shopIdOf(req), result.order.customerId)).emit('loyalty:updated', {
          customerId: result.order.customerId,
          points: result.loyaltyPoints,
        });
      }
      emitOrder(io, shopIdOf(req), 'order:updated', result.order, orderEventContext(order));
      res.json(driver ? orderForDriver(result.order, driver.id) : result.order);
    } catch (err) {
      if (err instanceof DomainError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: 'Não foi possível atualizar o pedido.' });
    }
  });

  // Aceitar corrida + iniciar rota (entregador)
  router.post('/orders/:id/assign', driverGuard, (req, res) => {
    const order = orderOr404(req, req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const driver = currentDriver(res);
    try {
      const result = applyOrderEvent(
        order,
        { type: 'assign', driverId: driver.id },
        orderLifecycleDeps(shopIdOf(req))
      );
      emitOrder(io, shopIdOf(req), 'order:updated', result.order, orderEventContext(order));
      res.json(orderForDriver(result.order, driver.id));
    } catch (err) {
      if (err instanceof DomainError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: 'Não foi possível aceitar a corrida.' });
    }
  });

  // Confirmar pagamento (cozinha) — PIX pendente
  router.patch(
    '/orders/:id/payment',
    requireStaff('kitchen'),
    asyncRoute(async (req, res) => {
      // A recusa de um pedido cancelado vem como DomainError e precisa chegar
      // à cozinha com o texto certo, por isso o erro segue para o errorHandler.
      const order = await settlePayment(io, {
        source: 'kitchen',
        shopId: shopIdOf(req),
        orderId: req.params.id,
        confirmedBy: `kitchen:${req.ip || 'desconhecido'}`,
      });
      if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
      res.json(order);
    })
  );

  // O cliente consulta esta rota a cada poucos segundos enquanto espera o PIX:
  // uma falha do Mercado Pago aqui não pode virar rejeição não tratada.
  router.get(
    '/orders/:id/pix-status',
    asyncRoute(async (req, res) => {
      const order = orderOr404(req, req.params.id);
      if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
      const role = roleOf(req);
      const customerId = String(req.query.customerId || '').trim();
      if (role !== 'kitchen' && (!customerId || customerId !== order.customerId)) {
        return res.status(401).json({ error: 'Não autorizado.' });
      }
      // Num pedido cancelado nem chegamos ao Mercado Pago: consultar a cobrança
      // só serviria para liquidar dinheiro que não tem mais pedido por trás.
      if (
        order.status !== 'cancelado' &&
        order.payment.method === 'pix' &&
        !order.payment.isPaid &&
        order.payment.mpPaymentId
      ) {
        try {
          // A consulta usa o token DESTA loja — a mesma que emitiu a cobrança.
          const updated = await settlePayment(io, {
            source: 'mercadopago',
            shopId: shopIdOf(req),
            paymentId: order.payment.mpPaymentId,
          });
          if (updated) return res.json(updated);
        } catch (err) {
          console.error('Falha ao consultar o pagamento no Mercado Pago:', err);
        }
      }
      res.json(order);
    })
  );


  return router;
}
