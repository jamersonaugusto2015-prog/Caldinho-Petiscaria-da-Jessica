import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage, Order, OrderStatus } from './types';
import {
  chatAlertFor,
  expandVibratePattern,
  isRideOffered,
  newOrderSpeech,
  orderAlertFor,
  SAMPLE_NEW_ORDER_SPEECH,
  URGENCY_CHANNELS,
} from './alerts';

const order = (patch: Partial<Order> = {}): Order =>
  ({
    id: 'CX-1234',
    customerId: 'c1',
    customerName: 'Jessica',
    customerPhone: '81999999999',
    address: { id: 'a', label: 'casa', street: 'Rua A', number: '10', neighborhood: 'Boa Viagem', city: 'Recife', distanceKm: 3 },
    fulfillment: 'delivery',
    items: [{ quantity: 2 }],
    subtotal: 40,
    discount: 0,
    deliveryFee: 7,
    total: 47,
    distanceKm: 3.2,
    status: 'recebido' as OrderStatus,
    payment: { method: 'pix', isPaid: true },
    createdAt: '2026-08-20T12:00:00.000Z',
    estimatedDeliveryMinutes: 40,
    loyaltyPointsEarned: 0,
    ...patch,
  }) as unknown as Order;

// ---------------------------------------------------------------- cozinha

test('pedido novo é a única coisa que grita na cozinha, e fala', () => {
  const alert = orderAlertFor('kitchen', 'order:new', order());
  assert.ok(alert);
  assert.equal(alert.urgency, 'demand');
  assert.equal(alert.channels.voice, true);
  assert.equal(alert.channels.sound, true);
  assert.equal(alert.channels.system, true);
  assert.ok(alert.channels.vibrate);
  assert.match(alert.title, /CX-1234/);
  assert.match(alert.body, /Jessica/);
});

test('a voz fala valor e destino, e nunca o código do pedido', () => {
  const alert = orderAlertFor('kitchen', 'order:new', order({ total: 87.5 }));
  assert.ok(alert);
  assert.equal(alert.speech, 'Novo pedido. 87 reais e 50 centavos. Entrega.');
  // O código serve para ler na tela; falado, vira ruído letra por letra.
  assert.doesNotMatch(alert.speech!, /CX-/);
});

test('a retirada é dita, senão a cozinha embala para entrega o que ninguém vai buscar', () => {
  const alert = orderAlertFor('kitchen', 'order:new', order({ fulfillment: 'pickup' }));
  assert.match(alert!.speech!, /Retirada no balcão/);
});

test('valor redondo não fala centavo, e um real não vira "1 reais"', () => {
  assert.equal(newOrderSpeech(40, false), 'Novo pedido. 40 reais. Entrega.');
  assert.equal(newOrderSpeech(1, false), 'Novo pedido. 1 real. Entrega.');
  assert.equal(newOrderSpeech(2.01, false), 'Novo pedido. 2 reais e 1 centavo. Entrega.');
});

test('o botão de testar som fala a mesma frase do alerta de verdade', () => {
  assert.equal(SAMPLE_NEW_ORDER_SPEECH, newOrderSpeech(87.5, false));
});

test('só o pedido novo tem fala; o resto cai no título', () => {
  const complaint = orderAlertFor(
    'kitchen',
    'order:updated',
    order({ complaint: { text: 'veio frio', status: 'aberta', openedAt: 'x' } } as never),
    { hadOpenComplaint: false }
  );
  assert.equal(complaint?.speech, undefined);
});

test('o mesmo pedido atualizado não repete o alerta de pedido novo', () => {
  assert.equal(orderAlertFor('kitchen', 'order:updated', order({ status: 'em_preparo' })), null);
});

test('o pedido de cancelamento grita uma vez só, e não de novo depois', () => {
  const pendente = order({ cancellationRequest: { reason: 'errei o endereço', requestedAt: 'x', status: 'pendente' } });
  const first = orderAlertFor('kitchen', 'order:updated', pendente, { hadPendingCancelRequest: false });
  assert.ok(first);
  assert.equal(first.urgency, 'demand');
  assert.match(first.body, /errei o endereço/);
  assert.equal(orderAlertFor('kitchen', 'order:updated', pendente, { hadPendingCancelRequest: true }), null);
});

test('reclamação avisa a cozinha sem gritar', () => {
  const com = order({ complaint: { text: 'veio frio', openedAt: 'x', status: 'aberta' } });
  const alert = orderAlertFor('kitchen', 'order:updated', com, { hadOpenComplaint: false });
  assert.ok(alert);
  assert.equal(alert.urgency, 'notice');
  assert.equal(alert.channels.sound, false);
  assert.equal(orderAlertFor('kitchen', 'order:updated', com, { hadOpenComplaint: true }), null);
});

// ---------------------------------------------------------------- motoboy

test('corrida oferecida grita para o motoboy e vibra', () => {
  const alert = orderAlertFor('driver', 'order:updated', order({ status: 'pronto' }), { driverId: 'd1' });
  assert.ok(alert);
  assert.equal(alert.urgency, 'demand');
  assert.ok(alert.channels.vibrate);
  assert.equal(alert.channels.repeat, 3);
  assert.match(alert.body, /Boa Viagem/);
});

test('a corrida oferecida tem uma chave só, venha por order:new ou order:updated', () => {
  const pronto = order({ status: 'pronto' });
  const viaNew = orderAlertFor('driver', 'order:new', pronto, { driverId: 'd1' });
  const viaUpdate = orderAlertFor('driver', 'order:updated', pronto, { driverId: 'd1' });
  assert.ok(viaNew && viaUpdate);
  assert.equal(viaNew.key, viaUpdate.key);
});

test('corrida com dono não é oferecida a mais ninguém', () => {
  const taken = order({ status: 'pronto', driverId: 'd9' });
  assert.equal(isRideOffered(taken), false);
  assert.equal(orderAlertFor('driver', 'order:updated', taken, { driverId: 'd1' }), null);
});

test('retirada na loja nunca vira corrida', () => {
  const pickup = order({ status: 'pronto', fulfillment: 'pickup' });
  assert.equal(isRideOffered(pickup), false);
  assert.equal(orderAlertFor('driver', 'order:updated', pickup, { driverId: 'd1' }), null);
});

test('só o dono da corrida sabe que ela acabou ou foi cancelada', () => {
  const mine = order({ status: 'entregue', driverId: 'd1' });
  const done = orderAlertFor('driver', 'order:updated', mine, { driverId: 'd1', previousStatus: 'saiu_entrega' });
  assert.ok(done);
  assert.equal(done.urgency, 'notice');
  assert.equal(orderAlertFor('driver', 'order:updated', mine, { driverId: 'd2', previousStatus: 'saiu_entrega' }), null);

  const killed = order({ status: 'cancelado', driverId: 'd1', cancelledBy: 'cliente' });
  const cancelled = orderAlertFor('driver', 'order:updated', killed, { driverId: 'd1', previousStatus: 'saiu_entrega' });
  assert.ok(cancelled);
  assert.equal(cancelled.urgency, 'demand');
  assert.match(cancelled.body, /cliente/);
});

// ---------------------------------------------------------------- cliente

test('o cliente não é avisado do pedido que ele acabou de fazer', () => {
  assert.equal(orderAlertFor('client', 'order:new', order()), null);
});

test('sem status anterior o cliente não recebe alerta nenhum', () => {
  assert.equal(orderAlertFor('client', 'order:updated', order({ status: 'em_preparo' })), null);
});

test('só os degraus que mudam a vida do cliente interrompem', () => {
  const preparing = orderAlertFor('client', 'order:updated', order({ status: 'em_preparo' }), { previousStatus: 'recebido' });
  assert.ok(preparing);
  assert.equal(preparing.urgency, 'silent');
  assert.equal(preparing.channels.system, false);

  const onTheWay = orderAlertFor('client', 'order:updated', order({ status: 'saiu_entrega' }), { previousStatus: 'pronto' });
  assert.ok(onTheWay);
  assert.equal(onTheWay.urgency, 'notice');
  assert.equal(onTheWay.channels.system, true);
});

test('entregue comemora; os outros não', () => {
  const delivered = orderAlertFor('client', 'order:updated', order({ status: 'entregue' }), { previousStatus: 'saiu_entrega' });
  assert.ok(delivered);
  assert.equal(delivered.celebrate, true);
  const ready = orderAlertFor('client', 'order:updated', order({ status: 'pronto' }), { previousStatus: 'em_preparo' });
  assert.ok(ready);
  assert.notEqual(ready.celebrate, true);
});

test('a retirada fala do balcão, não da porta de casa', () => {
  const alert = orderAlertFor('client', 'order:updated', order({ status: 'pronto', fulfillment: 'pickup' }), {
    previousStatus: 'em_preparo',
  });
  assert.ok(alert);
  assert.match(alert.body, /Retirar/i);
});

test('a resposta ao cancelamento chega com o motivo e grita', () => {
  const refused = order({
    status: 'em_preparo',
    cancellationRequest: { reason: 'mudei de ideia', requestedAt: 'x', status: 'recusado', responseNote: 'já está na chapa' },
  });
  const alert = orderAlertFor('client', 'order:updated', refused, { hadPendingCancelRequest: true, previousStatus: 'em_preparo' });
  assert.ok(alert);
  assert.equal(alert.urgency, 'demand');
  assert.match(alert.body, /já está na chapa/);
});

// ---------------------------------------------------------------- chat

const message = (patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  orderId: 'CX-1234',
  sender: 'client',
  senderName: 'Jessica',
  text: 'cadê meu caldinho',
  timestamp: 'x',
  ...patch,
});

test('ninguém é alertado do próprio eco', () => {
  assert.equal(chatAlertFor('client', message({ sender: 'client' })), null);
  assert.equal(chatAlertFor('kitchen', message({ sender: 'store' })), null);
  assert.ok(chatAlertFor('kitchen', message({ sender: 'client' })));
  assert.ok(chatAlertFor('client', message({ sender: 'store' })));
});

test('o motoboy não recebe o chat do pedido', () => {
  assert.equal(chatAlertFor('driver', message({ sender: 'client' })), null);
});

// ---------------------------------------------------------------- a escala

test('o padrão de vibração do Android cabe num chamado só, sem timer', () => {
  const once = expandVibratePattern([220, 90, 400], 1);
  assert.deepEqual(once, [220, 90, 400]);
  const triple = expandVibratePattern([220, 90, 400], 3);
  assert.equal(triple[0], 220);
  assert.ok(triple.length > once.length);
  assert.ok(triple.length <= 99);
  assert.equal(expandVibratePattern([0, 200], 1)[0], 200);
});

test('a escala só sobe: silent < notice < demand', () => {
  assert.equal(URGENCY_CHANNELS.silent.system, false);
  assert.equal(URGENCY_CHANNELS.silent.vibrate, null);
  assert.equal(URGENCY_CHANNELS.notice.system, true);
  assert.equal(URGENCY_CHANNELS.notice.sound, false);
  assert.equal(URGENCY_CHANNELS.demand.sound, true);
  assert.ok((URGENCY_CHANNELS.demand.repeat ?? 1) > (URGENCY_CHANNELS.notice.repeat ?? 1));
  for (const level of Object.values(URGENCY_CHANNELS)) assert.equal(level.banner, true);
});
