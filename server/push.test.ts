import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, beforeEach } from 'node:test';
import type { ChatMessage, Order } from '../src/types';
import type { PushEnvelope } from './push';

// `push.ts` puxa `db.ts`, que abre o sqlite real assim que é importado, e o
// DATA_DIR de desenvolvimento deste repo é o banco de verdade do usuário. O
// override precisa rodar ANTES do import, daí o import dinâmico abaixo.
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'caldinho-push-test-'));
process.env.DATA_DIR = DATA_DIR;
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

const {
  chatPushEnvelopes,
  countPushSubscriptions,
  deletePushSubscription,
  deletePushSubscriptionsForDriver,
  isPushSubscription,
  orderPushEnvelopes,
  pushPublicKey,
  savePushSubscription,
  vapidKeys,
} = await import('./push');
const { db } = await import('./db');

after(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  db.prepare('DELETE FROM push_subscriptions').run();
});

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'CX-TEST',
    customerId: 'cust-1',
    customerName: 'Ana Maria',
    customerPhone: '81999998888',
    address: {
      id: 'addr-1',
      label: 'Casa',
      street: 'Rua da Aurora',
      number: '100',
      neighborhood: 'Boa Vista',
      city: 'Recife - PE',
      complement: 'Apto 302',
      cep: '50050000',
      lat: -8.05,
      lng: -34.9,
      distanceKm: 3,
    },
    items: [],
    subtotal: 30,
    discount: 0,
    deliveryFee: 6,
    total: 36,
    distanceKm: 3,
    status: 'pronto',
    payment: { method: 'pix', isPaid: true, pixCopyPaste: 'segredo', pixQrCode: 'segredo' },
    createdAt: new Date(0).toISOString(),
    estimatedDeliveryMinutes: 30,
    loyaltyPointsEarned: 0,
    ...overrides,
  } as Order;
}

const subscription = (endpoint: string) => ({
  endpoint,
  keys: { p256dh: 'p256dh-fake', auth: 'auth-fake' },
});

// ---------------------------------------------------------------------------
// Chaves VAPID
// ---------------------------------------------------------------------------

test('a chave VAPID nasce uma vez e sobrevive à releitura', () => {
  const first = vapidKeys();
  assert.ok(first.publicKey.length > 20);
  assert.ok(first.privateKey.length > 20);
  // Rotacionar a chave mata em silêncio toda inscrição já aceita pelo
  // navegador: o par tem que ser o mesmo em todo boot.
  const stored = db.prepare("SELECT value FROM meta WHERE key = 'vapid_public_key'").get() as
    | { value: string }
    | undefined;
  assert.equal(stored?.value, first.publicKey);
  assert.equal(pushPublicKey(), first.publicKey);
});

// ---------------------------------------------------------------------------
// Inscrições
// ---------------------------------------------------------------------------

test('a inscrição malformada não entra no banco', () => {
  assert.equal(isPushSubscription(null), false);
  assert.equal(isPushSubscription({ endpoint: 'https://x' }), false);
  assert.equal(isPushSubscription({ endpoint: 'ftp://x', keys: { p256dh: 'a', auth: 'b' } }), false);
  assert.equal(isPushSubscription(subscription('https://push.exemplo/1')), true);
});

test('reinscrever o mesmo navegador sobrescreve a linha em vez de duplicar', () => {
  savePushSubscription({ room: 'kitchen', role: 'kitchen', subscription: subscription('https://push.exemplo/1') });
  savePushSubscription({ room: 'kitchen', role: 'kitchen', subscription: subscription('https://push.exemplo/1') });
  assert.equal(countPushSubscriptions('kitchen'), 1);
});

test('desinscrever apaga a linha do endpoint', () => {
  savePushSubscription({ room: 'kitchen', role: 'kitchen', subscription: subscription('https://push.exemplo/1') });
  deletePushSubscription('https://push.exemplo/1');
  assert.equal(countPushSubscriptions('kitchen'), 0);
});

test('demitir o motoboy apaga a inscrição dele junto com o token', () => {
  savePushSubscription({ room: 'driver:drv-1', role: 'driver', subscription: subscription('https://push.exemplo/drv1') });
  savePushSubscription({ room: 'driver:drv-2', role: 'driver', subscription: subscription('https://push.exemplo/drv2') });
  deletePushSubscriptionsForDriver('drv-1');
  assert.equal(countPushSubscriptions('driver:drv-1'), 0);
  assert.equal(countPushSubscriptions('driver:drv-2'), 1);
});

// ---------------------------------------------------------------------------
// Envelopes — a redação chegando ao push
// ---------------------------------------------------------------------------

const envelopeFor = (envelopes: PushEnvelope[], room: string) =>
  envelopes.find((e) => e.room === room);

test('o pedido novo acorda a cozinha e mais ninguém', () => {
  const envelopes = orderPushEnvelopes('order:new', order({ status: 'recebido' }));
  assert.equal(envelopes.length, 1);
  assert.equal(envelopes[0].room, 'kitchen');
  assert.equal(envelopes[0].alert.urgency, 'demand');
  // O cliente acabou de fazer o pedido na tela dele: avisar seria eco.
  assert.equal(envelopeFor(envelopes, 'customer:cust-1'), undefined);
});

test('o payload do pool nunca leva nome, telefone ou rua do cliente', () => {
  const envelopes = orderPushEnvelopes('order:updated', order({ status: 'pronto', driverId: undefined }), {
    previousStatus: 'em_preparo',
  });
  const pool = envelopeFor(envelopes, 'drivers');
  assert.ok(pool, 'a corrida oferecida tem que chegar ao pool');
  assert.equal(pool.alert.urgency, 'demand');
  // O corpo é montado sobre `recipient.order` — a vista redigida. Montar sobre
  // o pedido cru mandaria o contato do cliente para o time inteiro, dentro de
  // uma notificação que o sistema operacional guarda na tela de bloqueio.
  assert.ok(!pool.payload.includes('Ana Maria'));
  assert.ok(!pool.payload.includes('81999998888'));
  assert.ok(!pool.payload.includes('Rua da Aurora'));
  assert.ok(!pool.payload.includes('cust-1'));
  // O que o motoboy precisa para decidir continua lá.
  assert.ok(pool.payload.includes('Boa Vista'));
});

test('a corrida oferecida desconta a sala do dono quando ela existe', () => {
  const envelopes = orderPushEnvelopes('order:updated', order({ status: 'cancelado', driverId: 'drv-1' }), {
    previousStatus: 'saiu_entrega',
  });
  const pool = envelopeFor(envelopes, 'drivers');
  // Cancelado com dono não é oferta: só o dono é avisado.
  assert.equal(pool, undefined);
  const owner = envelopeFor(envelopes, 'driver:drv-1');
  assert.ok(owner);
  assert.equal(owner.alert.key, 'driver:cancelled:CX-TEST');
});

test('o pedido de retirada não gera push nenhum para motoboy', () => {
  const envelopes = orderPushEnvelopes('order:updated', order({ status: 'pronto', fulfillment: 'pickup' }), {
    previousStatus: 'em_preparo',
  });
  assert.equal(envelopes.some((e) => e.role === 'driver'), false);
});

test('o alerta silencioso não vira notificação do sistema', () => {
  // `em_preparo` é degrau do meio: aparece na tela, não interrompe ninguém.
  const envelopes = orderPushEnvelopes('order:updated', order({ status: 'em_preparo' }), {
    previousStatus: 'recebido',
  });
  assert.equal(envelopeFor(envelopes, 'customer:cust-1'), undefined);
});

test('sair para entrega atravessa o app fechado do cliente', () => {
  const envelopes = orderPushEnvelopes('order:updated', order({ status: 'saiu_entrega', driverId: 'drv-1' }), {
    previousStatus: 'pronto',
  });
  const client = envelopeFor(envelopes, 'customer:cust-1');
  assert.ok(client);
  assert.equal(client.alert.urgency, 'notice');
  assert.equal(client.alert.channels.system, true);
});

test('sem status anterior o cliente não recebe eco a cada evento', () => {
  // O GPS do motoboy dispara `order:updated` a cada ponto; sem o "antes", cada
  // um deles pareceria uma mudança de etapa.
  const envelopes = orderPushEnvelopes('order:updated', order({ status: 'saiu_entrega', driverId: 'drv-1' }));
  assert.equal(envelopeFor(envelopes, 'customer:cust-1'), undefined);
});

test('o pedido de cancelamento pendente grita na cozinha uma vez só', () => {
  const pending = order({
    status: 'em_preparo',
    cancellationRequest: {
      status: 'pendente',
      reason: 'Pedi errado',
      requestedAt: new Date(0).toISOString(),
    },
  });
  const first = orderPushEnvelopes('order:updated', pending, { previousStatus: 'em_preparo' });
  assert.equal(envelopeFor(first, 'kitchen')?.alert.urgency, 'demand');

  const again = orderPushEnvelopes('order:updated', pending, {
    previousStatus: 'em_preparo',
    hadPendingCancelRequest: true,
  });
  assert.equal(envelopeFor(again, 'kitchen'), undefined);
});

test('a mensagem do chat avisa o outro lado, nunca o próprio eco', () => {
  const message: ChatMessage = {
    id: 'msg-1',
    orderId: 'CX-TEST',
    sender: 'client',
    senderName: 'Ana Maria',
    text: 'Pode trazer talher?',
    timestamp: '12:00',
  };
  const envelopes = chatPushEnvelopes(order({ status: 'em_preparo' }), message);
  assert.deepEqual(envelopes.map((e) => e.room), ['kitchen']);
  assert.equal(envelopes.some((e) => e.room === 'drivers'), false);
});
