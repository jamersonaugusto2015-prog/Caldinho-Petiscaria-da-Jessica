import { Router } from 'express';
import { customerRoom, driverRoom, driversRoom, kitchenRoom } from '../../../contract/shop/rooms';
import { driverFromRequest, tokenFromRequest } from '../../driverSession';
import { getRoleToken } from '../../infra/secrets';
import { deletePushSubscription, isPushSubscription, pushPublicKey, savePushSubscription } from '../../push';
import { shopIdOf } from '../middleware/tenant';

/**
 * As inscrições de push do navegador.
 *
 * Router: traduz, autentica e delega. Zero regra de negócio.
 */
export function pushRouter(): Router {
  const router = Router();

  // ---------- Push (o aviso que atravessa o app fechado) ----------
  // A chave pública é pública mesmo: sem ela o navegador não consegue nem pedir
  // permissão, e ela não autoriza ninguém a enviar nada.
  router.get('/push/key', (req, res) => {
    res.json({ key: pushPublicKey() });
  });

  /**
   * A SALA É DECIDIDA AQUI, nunca lida do corpo (ADR-0009). Um `room` vindo do
   * cliente seria a chave da sala privada de qualquer motoboy — o contato do
   * cliente da corrida entregue no celular de quem pedisse.
   */
  router.post('/push/subscribe', (req, res) => {
    const shopId = shopIdOf(req);
    const subscription = req.body?.subscription;
    if (!isPushSubscription(subscription)) {
      return res.status(400).json({ error: 'A inscrição de notificações não veio completa. Ative as notificações de novo.' });
    }

    const token = tokenFromRequest(req);
    if (token && token === getRoleToken(shopId, 'kitchen')) {
      savePushSubscription({ shopId, room: kitchenRoom(shopId), role: 'kitchen', subscription });
      return res.status(201).json({ ok: true, rooms: [kitchenRoom(shopId)] });
    }

    const driver = driverFromRequest(shopId, req);
    if (driver) {
      // Uma linha só, na sala privada: o endpoint é o navegador e o navegador é
      // um só. A sala compartilhada `drivers` é derivada do papel na hora do
      // envio, então o motoboy fica nas duas sem receber em dobro.
      savePushSubscription({ shopId, room: driverRoom(shopId, driver.id), role: 'driver', subscription });
      return res.status(201).json({ ok: true, rooms: [driversRoom(shopId), driverRoom(shopId, driver.id)] });
    }

    // Mesmo trim + corte de 80 que o `join` do socket aplica: as duas portas
    // precisam gerar exatamente a mesma sala, senão o cliente se inscreve num
    // canal onde o evento nunca cai.
    const customerId = String(req.body?.customerId || '').trim().slice(0, 80);
    if (!customerId || customerId === 'anon') {
      return res.status(401).json({ error: 'Não autorizado.' });
    }
    savePushSubscription({ shopId, room: customerRoom(shopId, customerId), role: 'client', subscription });
    return res.status(201).json({ ok: true, rooms: [customerRoom(shopId, customerId)] });
  });

  // Sem token: quem tem o endpoint é o dono do navegador que o gerou, e apagar
  // a própria inscrição não expõe nada de ninguém.
  router.post('/push/unsubscribe', (req, res) => {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
    if (!endpoint) return res.status(400).json({ error: 'Informe o endpoint da inscrição de notificações.' });
    deletePushSubscription(endpoint);
    res.json({ ok: true });
  });

  return router;
}
