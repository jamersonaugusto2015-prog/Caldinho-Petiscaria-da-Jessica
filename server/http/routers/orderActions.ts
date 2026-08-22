import { Router } from 'express';
import type { Server } from 'socket.io';
import type { CancelActor, ChatMessage } from '../../../contract/order/types';
import { customerRoom, driverRoom, kitchenRoom } from '../../../contract/shop/rooms';
import { cancelOrder, defaultCancelReason } from '../../cancellation';
import { buildChatMessage, insertChatMessage } from '../../domain/chat/store';
import { orderLifecycleDeps } from '../../domain/deps';
import { DomainError } from '../../errors';
import { emitOrder, orderEventContext } from '../../orderEvents';
import { applyOrderEvent } from '../../orderLifecycle';
import { refundPayment } from '../../payment';
import { requireStaff, roleOf } from '../middleware/auth';
import { asyncRoute } from '../middleware/errors';
import { orderOr404 } from '../context';
import { shopIdOf } from '../middleware/tenant';

/**
 * O que acontece com um pedido depois: cancelamento, reclamação e avaliação.
 *
 * Router: traduz, autentica e delega. Zero regra de negócio.
 */
export function orderActionsRouter(io: Server): Router {
  const router = Router();

    // Cancelar pedido (cliente só em "recebido"; cozinha a qualquer momento antes de entregar)
  router.post('/orders/:id/cancel', (req, res) => {
  const order = orderOr404(req, req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const isKitchen = roleOf(req) === 'kitchen';
    const customerId = String(req.body?.customerId || '').trim();
    if (!isKitchen) {
      if (!customerId || customerId !== order.customerId) {
        return res.status(401).json({ error: 'Não autorizado.' });
      }
      if (order.status !== 'recebido') {
        return res.status(400).json({ error: 'O pedido já está em preparo e não pode ser cancelado pelo cliente.' });
      }
    }
    const by: CancelActor = isKitchen ? 'loja' : 'cliente';
    const reason = String(req.body?.reason || '').trim() || defaultCancelReason(by);
    try {
      res.json(cancelOrder(io, shopIdOf(req), { order, reason, by }));
    } catch (err) {
      if (err instanceof DomainError) return res.status(err.status).json({ error: err.message });
      console.error('[orderActions] falha inesperada:', err);
      res.status(500).json({ error: 'Não foi possível cancelar o pedido.' });
    }
  });

  // O cliente pede o cancelamento de um pedido que já está em preparo
  router.post('/orders/:id/cancel-request', (req, res) => {
    const order = orderOr404(req, req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const customerId = String(req.body?.customerId || '').trim();
    if (!customerId || customerId !== order.customerId) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }
    try {
      const result = applyOrderEvent(
        order,
        { type: 'request-cancel', reason: String(req.body?.reason || '') },
        orderLifecycleDeps(shopIdOf(req))
      );
      emitOrder(io, shopIdOf(req), 'order:updated', result.order, orderEventContext(order));
      res.json(result.order);
    } catch (err) {
      if (err instanceof DomainError) return res.status(err.status).json({ error: err.message });
      console.error('[orderActions] falha inesperada:', err);
      res.status(500).json({ error: 'Não foi possível enviar o pedido de cancelamento.' });
    }
  });

  // A cozinha responde ao pedido de cancelamento
  router.post('/orders/:id/cancel-request/resolve', requireStaff('kitchen'), (req, res) => {
    const order = orderOr404(req, req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const accept = req.body?.accept === true;
    const note = typeof req.body?.note === 'string' ? req.body.note : undefined;
    try {
      // O lifecycle registra a resposta; aceitar continua no cancellation.ts,
      // que é quem cuida de selo, devolução e do emit único.
      const result = applyOrderEvent(
        order,
        { type: 'resolve-cancel', accept, note },
        orderLifecycleDeps(shopIdOf(req))
      );
      if (!accept) {
        emitOrder(io, shopIdOf(req), 'order:updated', result.order, orderEventContext(order));
        return res.json(result.order);
      }
      const reason = result.order.cancellationRequest?.reason || defaultCancelReason('loja');
      // `before` é o pedido com a solicitação ainda pendente: é o que faz o
      // alerta "Cancelamento aceito" existir para o cliente.
      res.json(cancelOrder(io, shopIdOf(req), { order: result.order, reason, by: 'loja', before: order }));
    } catch (err) {
      if (err instanceof DomainError) return res.status(err.status).json({ error: err.message });
      console.error('[orderActions] falha inesperada:', err);
      res.status(500).json({ error: 'A resposta ao cancelamento não foi enviada. Tente de novo.' });
    }
  });

  // A cozinha devolve o dinheiro de um pedido cancelado que já estava pago
  router.post(
    '/orders/:id/refund',
    requireStaff('kitchen'),
    asyncRoute(async (req, res) => {
      const order = await refundPayment(io, {
        shopId: shopIdOf(req),
        orderId: req.params.id,
        by: `kitchen:${req.ip || 'desconhecido'}`,
      });
      if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
      res.json(order);
    })
  );

  // Reclamação pós-entrega: fica no pedido e no chat que já existe
  router.post('/orders/:id/complaint', (req, res) => {
    const order = orderOr404(req, req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const customerId = String(req.body?.customerId || '').trim();
    if (!customerId || customerId !== order.customerId) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }
    try {
      const result = applyOrderEvent(
        order,
        { type: 'complain', text: String(req.body?.text || '') },
        orderLifecycleDeps(shopIdOf(req))
      );
      const message = buildChatMessage({
        orderId: req.params.id,
        sender: 'client',
        senderName: result.order.customerName,
        text: result.order.complaint!.text,
      });
      insertChatMessage(shopIdOf(req), message);
      // Igual ao chat normal: a reclamação (texto livre do cliente, costuma
      // trazer contato) vai para a cozinha, para o cliente e SÓ para o motoboy
      // da corrida — nunca para a sala `drivers`, que é o time inteiro.
      let alvo = io
        .to(kitchenRoom(shopIdOf(req)))
        .to(customerRoom(shopIdOf(req), order.customerId));
      if (order.driverId) alvo = alvo.to(driverRoom(shopIdOf(req), order.driverId));
      alvo.emit('chat:message', message);
      // Sem push do chat aqui: a reclamação já tem alerta próprio na tabela, e
      // os dois juntos notificariam a cozinha duas vezes pelo mesmo toque.
      emitOrder(io, shopIdOf(req), 'order:updated', result.order, orderEventContext(order));
      res.status(201).json(result.order);
    } catch (err) {
      if (err instanceof DomainError) return res.status(err.status).json({ error: err.message });
      console.error('[orderActions] falha inesperada:', err);
      res.status(500).json({ error: 'A reclamação não foi registrada. Tente de novo ou fale pelo chat do pedido.' });
    }
  });

  router.post('/orders/:id/complaint/resolve', requireStaff('kitchen'), (req, res) => {
    const order = orderOr404(req, req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    try {
      const result = applyOrderEvent(
        order,
        { type: 'resolve-complaint' },
        orderLifecycleDeps(shopIdOf(req))
      );
      emitOrder(io, shopIdOf(req), 'order:updated', result.order, orderEventContext(order));
      res.json(result.order);
    } catch (err) {
      if (err instanceof DomainError) return res.status(err.status).json({ error: err.message });
      console.error('[orderActions] falha inesperada:', err);
      res.status(500).json({ error: 'A reclamação não foi marcada como resolvida. Tente de novo.' });
    }
  });

  router.post('/orders/:id/rating', (req, res) => {
    const order = orderOr404(req, req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const customerId = String(req.body?.customerId || '').trim();
    if (!customerId || customerId !== order.customerId) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }
    try {
      const result = applyOrderEvent(order, {
        type: 'rate',
        rating: Number(req.body?.rating),
        comment: typeof req.body?.comment === 'string' ? req.body.comment : undefined,
      }, orderLifecycleDeps(shopIdOf(req)));
      emitOrder(io, shopIdOf(req), 'order:updated', result.order, orderEventContext(order));
      res.json(result.order);
    } catch (err) {
      if (err instanceof DomainError) return res.status(err.status).json({ error: err.message });
      console.error('[orderActions] falha inesperada:', err);
      res.status(500).json({ error: 'A avaliação não foi registrada. Tente de novo.' });
    }
  });

  return router;
}
