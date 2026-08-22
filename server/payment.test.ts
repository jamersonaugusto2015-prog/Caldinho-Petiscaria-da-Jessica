import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Server } from 'socket.io';
import type { Order } from '../contract/order/types';
import type { StoreSettings } from '../contract/shop/types';
import { DomainError } from './errors';
import { generatePixCopyPaste } from '../contract/payment/pix';
// server/db.ts opens a real sqlite file at DATA_DIR the moment it is imported, and this repo's
// dev DATA_DIR already has a live Mercado Pago access token connected. This override MUST run
// before ./payment / ./orderStore are loaded (hence the dynamic imports below), or these tests
// would run against production data and could trigger a real Mercado Pago API call.
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'caldinho-payment-test-'));
// Sem token nenhum, refundPayment falha antes de chegar à rede: nenhuma
// devolução de teste pode sair da conta real da loja.
delete process.env.MP_ACCESS_TOKEN;

const { collectPixPayment, refundPayment, settlePayment } = await import('./payment');
const { getOrder, insertOrder } = await import('./orderStore');

// Única loja usada neste arquivo: a migração 005_shops garante o id 1 em todo banco novo.
const LOJA = 1;

const settings: StoreSettings = {
  storeName: 'Caldinho Express',
  city: 'Recife',
  storeLat: -8.05,
  storeLng: -34.9,
  storeAddress: 'Rua da Aurora, 100',
  pickupEnabled: true,
  pickupReadyMinutes: 20,
  deliveryPricePerKm: 2,
  deliveryBaseFee: 5,
  deliveryMinFee: 5,
  freeDeliveryAbove: 0,
  maxDeliveryKm: 20,
  minOrderValue: 0,
  routeFactor: 1.35,
  driverFeePerDelivery: 0,
  pixProvider: 'mercadopago',
  pixKey: '11999999999',
  pixMerchantName: 'Caldinho Express',
  pixMerchantCity: 'Recife',
  cardOnDeliveryEnabled: true,
  storeWhatsApp: '',
  orderSoundUrl: '',
  openingHours: Array(7).fill({ open: '00:00', close: '23:59' }),
  sizeOptions: [],
  loyaltyStampCost: 10,
  loyaltyRedeemCategory: 'caldinhos',
  timezone: 'America/Recife',
  orderEnabled: true,
  forceOpen: true,
};

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'CX-PAY-TEST',
    customerId: 'customer-1',
    customerName: 'Ana',
    customerPhone: '',
    address: {
      id: 'addr-1',
      label: 'Casa',
      street: 'Rua Teste',
      number: '10',
      neighborhood: 'Centro',
      city: 'Recife',
      distanceKm: 1,
    },
    items: [],
    subtotal: 20,
    discount: 0,
    deliveryFee: 5,
    total: 25,
    distanceKm: 1,
    status: 'recebido',
    payment: { method: 'cash', isPaid: false },
    createdAt: '2026-08-18T14:30:00.000Z',
    estimatedDeliveryMinutes: 30,
    loyaltyPointsEarned: 0,
    ...overrides,
  };
}

function fakeIo() {
  const emitted: string[] = [];
  const io = {
    to: () => ({ emit: (event: string) => emitted.push(event) }),
  } as unknown as Server;
  return { io, emitted };
}

test('two concurrent kitchen settlements result in exactly one write', async () => {
  const { io, emitted } = fakeIo();
  const orderId = 'CX-PAY-CONCURRENT';
  // customerId 'anon' keeps emitOrder's fan-out to a single room (kitchen), so the emit
  // count below is a reliable proxy for "how many times markOrderPaid actually wrote".
  insertOrder(LOJA, makeOrder({ id: orderId, customerId: 'anon' }));

  const [first, second] = await Promise.all([
    settlePayment(io, { source: 'kitchen', shopId: LOJA, orderId }),
    settlePayment(io, { source: 'kitchen', shopId: LOJA, orderId }),
  ]);

  assert.ok(first && second);
  assert.equal(first!.payment.isPaid, true);
  assert.equal(second!.payment.isPaid, true);
  // markOrderPaid only calls saveOrder + emitOrder when it flips isPaid; the loser of the
  // race reads the already-paid row back from getOrder and short-circuits before either call.
  assert.equal(emitted.length, 1);
  assert.equal(getOrder(LOJA, orderId)?.payment.isPaid, true);
});

test('kitchen settlement records who confirmed it', async () => {
  const { io } = fakeIo();
  const orderId = 'CX-PAY-CONFIRMED-BY';
  insertOrder(LOJA, makeOrder({ id: orderId }));

  const result = await settlePayment(io, { source: 'kitchen', shopId: LOJA, orderId, confirmedBy: 'joao' });

  assert.equal(result?.payment.isPaid, true);
  assert.equal((result?.payment as { confirmedBy?: string }).confirmedBy, 'joao');
  const stored = getOrder(LOJA, orderId);
  assert.equal((stored?.payment as { confirmedBy?: string } | undefined)?.confirmedBy, 'joao');
});

test('kitchen settlement without confirmedBy leaves no trace of who confirmed it', async () => {
  const { io } = fakeIo();
  const orderId = 'CX-PAY-NO-CONFIRMED-BY';
  insertOrder(LOJA, makeOrder({ id: orderId }));

  const result = await settlePayment(io, { source: 'kitchen', shopId: LOJA, orderId });

  assert.equal(result?.payment.isPaid, true);
  assert.equal((result?.payment as { confirmedBy?: string }).confirmedBy, undefined);
});

test('a cancelled order can never be settled, whatever the source', async () => {
  const { io } = fakeIo();
  const orderId = 'CX-PAY-CANCELLED';
  insertOrder(LOJA, makeOrder({ id: orderId, status: 'cancelado', payment: { method: 'pix', isPaid: false } }));

  await assert.rejects(
    () => settlePayment(io, { source: 'kitchen', shopId: LOJA, orderId }),
    (error: unknown) => error instanceof DomainError && error.status === 400
  );
  assert.equal(getOrder(LOJA, orderId)?.payment.isPaid, false);
});

test('a cash refund is marked returned right away and repeating it changes nothing', async () => {
  const { io, emitted } = fakeIo();
  const orderId = 'CX-REFUND-CASH';
  insertOrder(
    LOJA,
    makeOrder({
      id: orderId,
      customerId: 'anon',
      status: 'cancelado',
      payment: { method: 'cash', isPaid: true, refundStatus: 'pendente' },
    })
  );

  const first = await refundPayment(io, { shopId: LOJA, orderId, by: 'kitchen:1.1.1.1' });
  assert.equal(first?.payment.refundStatus, 'devolvido');
  assert.equal(first?.payment.refundedBy, 'kitchen:1.1.1.1');
  assert.ok(first?.payment.refundedAt);
  const emissionsAfterFirst = emitted.length;

  const second = await refundPayment(io, { shopId: LOJA, orderId, by: 'kitchen:2.2.2.2' });
  assert.equal(second?.payment.refundStatus, 'devolvido');
  // Idempotente como markOrderPaid: a repetição sai antes de gravar ou emitir.
  assert.equal(emitted.length, emissionsAfterFirst);
  assert.equal(getOrder(LOJA, orderId)?.payment.refundedBy, 'kitchen:1.1.1.1');
});

test('a Mercado Pago failure marks the refund as failed and never as returned', async () => {
  const { io } = fakeIo();
  const orderId = 'CX-REFUND-FAIL';
  insertOrder(
    LOJA,
    makeOrder({
      id: orderId,
      status: 'cancelado',
      payment: { method: 'pix', isPaid: true, mpPaymentId: '999', refundStatus: 'pendente' },
    })
  );

  await assert.rejects(
    () => refundPayment(io, { shopId: LOJA, orderId, by: 'kitchen:1.1.1.1' }),
    (error: unknown) => error instanceof DomainError && error.status === 502
  );

  const stored = getOrder(LOJA, orderId);
  assert.equal(stored?.payment.refundStatus, 'falhou');
  assert.ok(stored?.payment.refundError);
  assert.equal(stored?.payment.refundedAt, undefined);
});

test('a failed refund can be retried, since no money left on the failed attempt', async () => {
  const { io } = fakeIo();
  const orderId = 'CX-REFUND-RETRY';
  insertOrder(
    LOJA,
    makeOrder({
      id: orderId,
      status: 'cancelado',
      payment: {
        method: 'cash',
        isPaid: true,
        refundStatus: 'falhou',
        refundError: 'Mercado Pago fora do ar',
      },
    })
  );

  const retried = await refundPayment(io, { shopId: LOJA, orderId, by: 'kitchen:1.1.1.1' });
  assert.equal(retried?.payment.refundStatus, 'devolvido');
  assert.ok(retried?.payment.refundedAt);
  assert.equal(retried?.payment.refundError, undefined);
});

test('a refund is refused when the shop owes nothing', async () => {
  const { io } = fakeIo();
  const orderId = 'CX-REFUND-NOT-DUE';
  insertOrder(LOJA, makeOrder({ id: orderId, payment: { method: 'pix', isPaid: true } }));

  await assert.rejects(
    () => refundPayment(io, { shopId: LOJA, orderId }),
    (error: unknown) => error instanceof DomainError && error.status === 400
  );
});

test('collectPixPayment falls back to a manual PIX key when Mercado Pago is not connected', async () => {
  const payment = await collectPixPayment({
    shopId: LOJA,
    orderId: 'CX-PIX-FALLBACK',
    amount: 25.5,
    settings,
    payerName: 'Ana',
    notificationUrl: '',
  });

  const expected = generatePixCopyPaste({
    pixKey: settings.pixKey,
    amount: 25.5,
    merchantName: settings.pixMerchantName,
    merchantCity: settings.pixMerchantCity,
    txid: 'CX-PIX-FALLBACK',
  });
  assert.equal(payment.pixCopyPaste, expected);
  assert.equal(payment.mpPaymentId, undefined);
});

test('collectPixPayment fails clearly when neither Mercado Pago nor a PIX key is available', async () => {
  await assert.rejects(
    () =>
      collectPixPayment({
        shopId: LOJA,
        orderId: 'CX-PIX-NONE',
        amount: 10,
        settings: { ...settings, pixKey: '' },
        payerName: 'Ana',
        notificationUrl: '',
      }),
    (error: unknown) => error instanceof DomainError && error.status === 400
  );
});

test('collectPixPayment na chave da loja gera o BR Code e o PNG do QR Code', async () => {
  const payment = await collectPixPayment({
    shopId: LOJA,
    orderId: 'CX-PIX-LOCAL',
    amount: 31.9,
    settings: { ...settings, pixProvider: 'local' },
    payerName: 'Ana',
    notificationUrl: '',
  });

  assert.equal(
    payment.pixCopyPaste,
    generatePixCopyPaste({
      pixKey: settings.pixKey,
      amount: 31.9,
      merchantName: settings.pixMerchantName,
      merchantCity: settings.pixMerchantCity,
      txid: 'CX-PIX-LOCAL',
    })
  );
  // Sem Mercado Pago no meio: nada de id de cobrança nem link de comprovante.
  assert.equal(payment.mpPaymentId, undefined);
  assert.equal(payment.mpTicketUrl, undefined);
  // A imagem tem que ser base64 puro de um PNG — as telas do cliente montam o
  // `data:image/png;base64,` na frente e um data URL aqui viraria imagem quebrada.
  assert.ok(payment.pixQrCode, 'faltou o QR Code do PIX');
  assert.ok(!payment.pixQrCode!.startsWith('data:'), 'o QR veio como data URL');
  assert.equal(Buffer.from(payment.pixQrCode!, 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('collectPixPayment na chave da loja recusa o pedido quando não há chave cadastrada', async () => {
  await assert.rejects(
    () =>
      collectPixPayment({
        shopId: LOJA,
        orderId: 'CX-PIX-LOCAL-SEM-CHAVE',
        amount: 10,
        settings: { ...settings, pixProvider: 'local', pixKey: '' },
        payerName: 'Ana',
        notificationUrl: '',
      }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.status === 400 &&
      error.message.includes('Cadastre a chave PIX')
  );
});


test('a loja B não quita o pedido da loja A, mesmo com pagamento aprovado', async () => {
  const { io } = fakeIo();
  // Um pedido REAL da loja A (id único no mundo, é o que permite a conferência).
  const orderId = 'CX-CROSS-A';
  insertOrder(LOJA, makeOrder({ id: orderId, payment: { method: 'pix', isPaid: false } }));

  // O Mercado Pago responde "aprovado" e aponta para o pedido da loja A — mas a
  // requisição diz ser da loja 2. O guarda `shopIdOfOrder !== shopId` recusa.
  const pagamentoDaLojaA = async () => ({
    id: 'pay-x',
    status: 'approved' as const,
    externalReference: orderId,
  });
  const resultado = await settlePayment(
    io,
    { source: 'mercadopago', shopId: 2, paymentId: 'pay-x' },
    { fetchPayment: pagamentoDaLojaA as never }
  );
  assert.equal(resultado, null, 'a loja 2 não pode quitar o pedido da loja 1');
  assert.equal(getOrder(LOJA, orderId)?.payment.isPaid, false, 'o pedido de A segue não pago');

  // A MESMA notificação, agora com a loja certa (1), quita.
  const ok = await settlePayment(
    io,
    { source: 'mercadopago', shopId: LOJA, paymentId: 'pay-x' },
    { fetchPayment: pagamentoDaLojaA as never }
  );
  assert.equal(ok?.payment.isPaid, true, 'a própria loja quita o próprio pedido');
});


test('o guarda shopIdOfOrder bloqueia sozinho, mesmo se getOrder devolvesse o pedido de A', async () => {
  const { io } = fakeIo();
  const orderId = 'CX-GUARD-A';
  // O pedido é REAL da loja A (shopIdOfOrder o vê como loja 1).
  insertOrder(LOJA, makeOrder({ id: orderId, payment: { method: 'pix', isPaid: false } }));

  const pagamentoDeA = async () => ({ id: 'pay-g', status: 'approved' as const, externalReference: orderId });
  // getOrder é injetado COMPROMETIDO: devolve o pedido de A mesmo consultado
  // como loja 2. Só o guarda `shopIdOfOrder(ref) !== shopId` pode barrar agora —
  // se ele for removido, isto quita o pedido de A na loja 2.
  const getOrderComprometido = () => makeOrder({ id: orderId, payment: { method: 'pix', isPaid: false } });
  const resultado = await settlePayment(
    io,
    { source: 'mercadopago', shopId: 2, paymentId: 'pay-g' },
    { fetchPayment: pagamentoDeA as never, getOrder: getOrderComprometido as never }
  );
  assert.equal(resultado, null, 'o guarda shopIdOfOrder tem que barrar sozinho');
  assert.equal(getOrder(LOJA, orderId)?.payment.isPaid, false, 'o pedido de A segue não pago');
});
