import { Router } from 'express';
import type { Request } from 'express';
import type { Server } from 'socket.io';
import type { ChatMessage, Order } from '../../../contract/order/types';
import { customerRoom, driverRoom, kitchenRoom } from '../../../contract/shop/rooms';
import { buildChatMessage, insertChatMessage, listChatMessages } from '../../domain/chat/store';
import { driverFromRequest } from '../../driverSession';
import { sendChatPush } from '../../push';
import { roleOf } from '../middleware/auth';
import { orderOr404 } from '../context';
import { shopIdOf } from '../middleware/tenant';

/**
 * A conversa em volta de um pedido.
 *
 * Router: traduz, autentica e delega. Zero regra de negócio.
 */
export function chatRouter(io: Server): Router {
  const router = Router();

  // ---------- Chat ----------
  const canAccessOrderChat = (req: Request, order: Order): boolean => {
    if (roleOf(req) === 'kitchen') return true;
    // Liberar o chat para qualquer motoboy fazia da rota um dump de nome,
    // telefone e endereço por `orderId`. Só o dono da corrida entra.
    const driver = driverFromRequest(shopIdOf(req), req);
    if (driver) return order.driverId === driver.id;
    const customerId = String(req.body?.customerId || req.query.customerId || '').trim();
    return !!customerId && customerId === order.customerId;
  };

  router.get('/orders/:id/chat', (req, res) => {
    const order = orderOr404(req, req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    if (!canAccessOrderChat(req, order)) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }
    res.json(listChatMessages(shopIdOf(req), req.params.id));
  });

  router.post('/orders/:id/chat', (req, res) => {
    const order = orderOr404(req, req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    if (!canAccessOrderChat(req, order)) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }
    const { sender, senderName, text } = req.body ?? {};
    if (!sender || !text) return res.status(400).json({ error: 'Escreva a mensagem antes de enviar.' });

    const role = roleOf(req);
    const safeSender =
      role === 'kitchen' ? 'store' : role === 'driver' ? 'driver' : 'client';

    const message = buildChatMessage({
      orderId: req.params.id,
      sender: safeSender,
      senderName: String(senderName || ''),
      text: String(text),
    });

    insertChatMessage(shopIdOf(req), message);
    // A sala `drivers` é o time inteiro: mandar para lá espalhava o nome e o
    // texto do cliente para motoboys que não têm nada com a corrida.
    let target = io.to(kitchenRoom(shopIdOf(req))).to(customerRoom(shopIdOf(req), order.customerId));
    if (order.driverId) target = target.to(driverRoom(shopIdOf(req), order.driverId));
    target.emit('chat:message', message);
    // O chat só alcançava quem estava com a aba aberta: uma pergunta do cliente
    // ficava sem resposta até alguém voltar à tela.
    sendChatPush(shopIdOf(req), order, message);
    res.status(201).json(message);
  });

  return router;
}
