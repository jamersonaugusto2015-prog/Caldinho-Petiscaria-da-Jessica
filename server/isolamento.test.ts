import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import type { Driver } from '../contract/driver/types';
import type { Order } from '../contract/order/types';

/**
 * A PROVA da Fase 5: duas lojas no mesmo banco, e nenhuma enxerga a outra.
 *
 * Este é o teste que precisa existir antes de a segunda loja receber um pedido
 * de verdade. Um vazamento entre lojas não dá erro nenhum — a consulta sem
 * filtro devolve as linhas das duas e ninguém percebe até a cozinha de uma ler
 * o telefone do cliente da outra.
 *
 * O que ele cobre é a camada de DADOS. O isolamento de TRANSPORTE (host,
 * credencial, salas de socket) é da Fase 6, e ganha o seu próprio teste lá.
 */

// `server/db.ts` abre o SQLite assim que é importado, e o DATA_DIR de
// desenvolvimento é o banco de verdade do dono. O override precisa rodar ANTES,
// daí os imports dinâmicos abaixo.
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'caldinho-isolamento-'));
process.env.DATA_DIR = DATA_DIR;

const { db } = await import('./db');
const { createShop } = await import('./infra/db/seed/createShop');
const {
  getOrder,
  insertOrder,
  listOrders,
  loadDriver,
  loadProduct,
  shopIdOfOrder,
} = await import('./orderStore');
const { getProduct, listProducts, listCoupons, saveCoupon, listCategories, createProduct, updateProduct } =
  await import('./catalog');
const { addLoyaltyPoints, getLoyaltyPoints } = await import('./loyalty');
const { getSecret, getRoleToken } = await import('./infra/secrets');
const { insertDriver, listDrivers, getDriver, findDriverByName } = await import('./domain/driver/store');
const { driverFromToken, issueDriverToken } = await import('./driverSession');
const { insertChatMessage, listChatMessages } = await import('./domain/chat/store');
const { savePushSubscription, countPushSubscriptions } = await import('./push');
const { createPromotion, listPromotions } = await import('./promotions');
const { recordOrderEvent, listOrderEvents } = await import('./domain/order/events');
const { createFreeRedeem, hasFreeRedeem } = await import('./loyalty');
const { getMetaValue, setMetaValue } = await import('./db');

after(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
});

// Duas lojas de verdade, criadas pelo mesmo caminho que o painel super-admin
// vai usar na Fase 9.
const LOJA_A = createShop(db, { slug: 'loja-a', name: 'Loja A' });
const LOJA_B = createShop(db, { slug: 'loja-b', name: 'Loja B' });

function pedido(id: string, overrides: Partial<Order> = {}): Order {
  return {
    id,
    customerId: 'cli-1',
    customerName: 'Ana',
    customerPhone: '81999990000',
    address: {
      id: 'a1',
      label: 'Casa',
      street: 'R',
      number: '1',
      neighborhood: 'C',
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
    payment: { method: 'pix', isPaid: false },
    createdAt: '2026-08-22T12:00:00.000Z',
    estimatedDeliveryMinutes: 30,
    loyaltyPointsEarned: 0,
    ...overrides,
  };
}

function motoboy(id: string, name: string): Driver {
  return {
    id,
    name,
    active: true,
    online: false,
    createdAt: '2026-08-22T12:00:00.000Z',
  };
}

// ---------------------------------------------------------------------------

test('as duas lojas nascem separadas, cada uma com o catálogo inteiro', () => {
  assert.notEqual(LOJA_A, LOJA_B);
  assert.ok(listProducts(LOJA_A).length > 3, 'a loja A precisa do catálogo completo');
  assert.equal(listProducts(LOJA_A).length, listProducts(LOJA_B).length);
  assert.equal(listCategories(LOJA_A).length, listCategories(LOJA_B).length);
});

test('a cozinha de A não vê nenhum pedido de B', () => {
  insertOrder(LOJA_A, pedido('CX-A1'));
  insertOrder(LOJA_A, pedido('CX-A2', { status: 'entregue' }));
  insertOrder(LOJA_B, pedido('CX-B1'));

  const deA = listOrders(LOJA_A).map((o) => o.id);
  const deB = listOrders(LOJA_B).map((o) => o.id);

  assert.deepEqual(deA.sort(), ['CX-A1', 'CX-A2']);
  assert.deepEqual(deB, ['CX-B1']);
});

test('saber o id de um pedido de B não basta para lê-lo pela loja A', () => {
  // Sem o `shopId` na consulta, o id (que é único no mundo) seria a chave de
  // leitura do pedido de qualquer loja: nome, telefone e endereço do cliente.
  assert.equal(getOrder(LOJA_A, 'CX-B1'), null);
  assert.ok(getOrder(LOJA_B, 'CX-B1'));
});

test('o id do pedido continua único no MUNDO: é o caminho de volta do webhook', () => {
  // O webhook do Mercado Pago só traz o `external_reference`. É por ele que o
  // pagamento acha a loja — e um id repetido entre lojas faria o pagamento de
  // uma quitar o pedido da outra.
  assert.equal(shopIdOfOrder('CX-A1'), LOJA_A);
  assert.equal(shopIdOfOrder('CX-B1'), LOJA_B);
  assert.equal(shopIdOfOrder('CX-NAO-EXISTE'), null);
});

test('o filtro por status não escapa da loja', () => {
  assert.deepEqual(
    listOrders(LOJA_A, { status: 'entregue' }).map((o) => o.id),
    ['CX-A2']
  );
  assert.deepEqual(listOrders(LOJA_B, { status: 'entregue' }), []);
});

test('o histórico do cliente é por loja: o mesmo celular pede nas duas', () => {
  // `customerId` é um UUID do aparelho. A mesma pessoa pede na pizzaria e no
  // caldinho, e cada loja só pode ver os pedidos dela.
  assert.equal(listOrders(LOJA_A, { customerId: 'cli-1' }).length, 2);
  assert.equal(listOrders(LOJA_B, { customerId: 'cli-1' }).length, 1);
});

test('o cupom de A não existe em B, e o mesmo código pode existir nas duas', () => {
  saveCoupon(LOJA_A, { code: 'PROMO', discountPercent: 50, description: 'Metade em A' });
  saveCoupon(LOJA_B, { code: 'PROMO', discountFixed: 1, description: 'Um real em B' });

  const deA = listCoupons(LOJA_A).find((c) => c.code === 'PROMO');
  const deB = listCoupons(LOJA_B).find((c) => c.code === 'PROMO');
  assert.equal(deA?.discountPercent, 50);
  assert.equal(deB?.discountFixed, 1);
  assert.equal(deB?.discountPercent, undefined, 'o cupom de A não pode virar o de B');
});

test('um produto criado só em A não existe em B', () => {
  createProduct(LOJA_A, {
    id: 'so-da-loja-a',
    name: 'Exclusivo A',
    basePrice: 10,
    category: 'caldinhos',
  });
  // A linha nova é da loja A e de mais ninguém — nem por getProduct, nem pelo
  // loadProduct que dá preço ao carrinho.
  assert.ok(getProduct(LOJA_A, 'so-da-loja-a'));
  assert.equal(getProduct(LOJA_B, 'so-da-loja-a'), null, 'o produto de A não pode aparecer em B');
  assert.equal(loadProduct(LOJA_B, 'so-da-loja-a'), null);
});

test('editar o preço de um produto em A não muda a linha de B', () => {
  // O template dá o MESMO id às duas lojas; a garantia é que as linhas são
  // independentes. Sem o filtro de shop_id no UPDATE, B seguiria o preço de A.
  const compartilhado = listProducts(LOJA_A)[0].id;
  const antesB = getProduct(LOJA_B, compartilhado)?.basePrice;
  updateProduct(LOJA_A, compartilhado, { basePrice: 999 });
  assert.equal(getProduct(LOJA_A, compartilhado)?.basePrice, 999);
  assert.equal(getProduct(LOJA_B, compartilhado)?.basePrice, antesB, 'o preço de B não pode mudar junto');
  assert.notEqual(getProduct(LOJA_B, compartilhado)?.basePrice, 999);
});

test('os selos de fidelidade são por loja: uma não paga o brinde da outra', () => {
  addLoyaltyPoints(LOJA_A, 'cli-1', 7);
  addLoyaltyPoints(LOJA_B, 'cli-1', 2);
  assert.equal(getLoyaltyPoints(LOJA_A, 'cli-1'), 7);
  assert.equal(getLoyaltyPoints(LOJA_B, 'cli-1'), 2);
});

test('o motoboy é da loja, e o mesmo nome pode existir nas duas', () => {
  insertDriver(LOJA_A, motoboy('drv-a', 'Marcos'));
  insertDriver(LOJA_B, motoboy('drv-b', 'Marcos'));

  assert.deepEqual(listDrivers(LOJA_A).map((d) => d.id), ['drv-a']);
  assert.deepEqual(listDrivers(LOJA_B).map((d) => d.id), ['drv-b']);
  assert.equal(getDriver(LOJA_A, 'drv-b'), null, 'A não enxerga o motoboy de B');
  assert.equal(findDriverByName(LOJA_A, 'Marcos')?.id, 'drv-a');
  assert.equal(findDriverByName(LOJA_B, 'Marcos')?.id, 'drv-b');
});

test('nome repetido DENTRO da mesma loja é recusado pelo banco', () => {
  // O login casa o motoboy pelo nome: dois iguais deixam um deles sem entrar.
  assert.throws(() => insertDriver(LOJA_A, motoboy('drv-a2', 'marcos')), /Já existe um motoboy/);
});

test('a credencial do motoboy de A não vale nada na loja B', () => {
  const token = issueDriverToken(LOJA_A, 'drv-a');
  assert.equal(driverFromToken(LOJA_A, token)?.id, 'drv-a');
  assert.equal(driverFromToken(LOJA_B, token), null, 'o token de A não pode resolver em B');
  assert.equal(loadDriver(LOJA_B, 'drv-a'), null);
});

test('os tokens de papel são diferentes entre as lojas', () => {
  const a = getRoleToken(LOJA_A, 'kitchen');
  const b = getRoleToken(LOJA_B, 'kitchen');
  assert.ok(a && b);
  assert.notEqual(a, b, 'a credencial da cozinha de A não pode abrir a de B');
  assert.notEqual(getRoleToken(LOJA_A, 'driver'), getRoleToken(LOJA_B, 'driver'));
});

test('o PIN de cada loja é um segredo próprio, e mora fora do meta', () => {
  const pinA = getSecret(LOJA_A, 'kitchen_pin_hash');
  const pinB = getSecret(LOJA_B, 'kitchen_pin_hash');
  assert.ok(pinA);
  assert.ok(pinB);
  // Hashes DIFERENTES: se `setSecret` gravasse sempre a loja 1, os dois lados
  // leriam a mesma linha e o PIN de A abriria a cozinha de B.
  assert.notEqual(pinA, pinB, 'o PIN de A não pode ser o mesmo segredo que o de B');
  // `GET /settings` serializa o `meta`. Segredo lá dentro depende de alguém
  // lembrar de removê-lo da resposta — e já vazou assim uma vez.
  const noMeta = db
    .prepare("SELECT COUNT(*) c FROM meta WHERE key LIKE '%pin%' OR key LIKE 'role_token%'")
    .get() as { c: number };
  assert.equal(noMeta.c, 0, 'nenhum segredo pode estar na tabela meta');
});

test('a configuração de uma loja não sobrescreve a da outra', () => {
  setMetaValue(LOJA_A, 'store_name', 'Caldinho da Ana');
  setMetaValue(LOJA_B, 'store_name', 'Pizzaria do João');
  assert.equal(getMetaValue(LOJA_A, 'store_name'), 'Caldinho da Ana');
  assert.equal(getMetaValue(LOJA_B, 'store_name'), 'Pizzaria do João');
});

test('a trilha de eventos de um pedido não atravessa a loja', () => {
  const evento = {
    fromStatus: 'recebido' as const,
    toStatus: 'pronto' as const,
    actor: 'kitchen' as const,
    at: '2026-08-22T13:00:00.000Z',
  };
  // O evento tem FK para o pedido: a linha precisa existir primeiro.
  insertOrder(LOJA_A, pedido('CX-EV'));
  recordOrderEvent(LOJA_A, 'CX-EV', evento);
  assert.equal(listOrderEvents(LOJA_A, 'CX-EV').length, 1);
  // O MESMO id de pedido na loja B não enxerga o evento de A: sem o filtro de
  // shop_id, a auditoria de uma loja apareceria na outra.
  assert.equal(listOrderEvents(LOJA_B, 'CX-EV').length, 0, 'o evento de A não pode aparecer em B');
});

test('o vale-brinde de fidelidade não vale na outra loja', () => {
  const token = createFreeRedeem(LOJA_A, 'cal-1', 'cli-1');
  assert.equal(hasFreeRedeem(LOJA_A, token, 'cal-1'), true);
  // O token é da loja A: a loja B não pode resgatá-lo, mesmo com o produto de
  // mesmo id (vem do template). Sem o filtro de shop_id, o brinde de A pagaria
  // um pedido de B.
  assert.equal(hasFreeRedeem(LOJA_B, token, 'cal-1'), false, 'o token de A não vale em B');
});

test('a conversa de um pedido não atravessa a loja', () => {
  insertChatMessage(LOJA_A, {
    id: 'msg-1',
    orderId: 'CX-A1',
    sender: 'client',
    senderName: 'Ana',
    text: 'Sem cebola, por favor',
    timestamp: '12:00',
  });
  assert.equal(listChatMessages(LOJA_A, 'CX-A1').length, 1);
  assert.equal(listChatMessages(LOJA_B, 'CX-A1').length, 0, 'B não lê a conversa de A');
});

test('a promoção de A não aparece para B', () => {
  createPromotion(LOJA_A, {
    id: 'promo-a',
    name: 'Só em A',
    kind: 'desconto',
    discountPercent: 10,
    scope: 'todos',
  });
  assert.equal(listPromotions(LOJA_A).length, 1);
  assert.equal(listPromotions(LOJA_B).length, 0);
});

test('a sala de push `drivers` não alcança a equipe da outra loja', () => {
  const inscricao = (endpoint: string) => ({
    endpoint,
    keys: { p256dh: 'x', auth: 'y' },
  });
  savePushSubscription({
    shopId: LOJA_A,
    room: 'driver:drv-a',
    role: 'driver',
    subscription: inscricao('https://push.exemplo/a'),
  });
  savePushSubscription({
    shopId: LOJA_B,
    room: 'driver:drv-b',
    role: 'driver',
    subscription: inscricao('https://push.exemplo/b'),
  });

  assert.equal(countPushSubscriptions(LOJA_A, 'driver:drv-a'), 1);
  assert.equal(countPushSubscriptions(LOJA_B, 'driver:drv-a'), 0);
});

test('apagar a loja B inteira não encosta em nada da loja A', () => {
  // Prova de que o `shop_id` está em TODA tabela que precisa dele: se alguma
  // linha de A não tivesse loja, ela sumiria junto aqui.
  const antesA = {
    pedidos: listOrders(LOJA_A).length,
    produtos: listProducts(LOJA_A).length,
    motoboys: listDrivers(LOJA_A).length,
    cupons: listCoupons(LOJA_A).length,
    selos: getLoyaltyPoints(LOJA_A, 'cli-1'),
  };

  db.transaction(() => {
    for (const tabela of [
      'orders',
      'products',
      'categories',
      'coupons',
      'promotions',
      'drivers',
      'driver_tokens',
      'push_subscriptions',
      'loyalty',
      'free_redeems',
      'meta',
      'shop_secrets',
      'chat_messages',
      'order_events',
    ]) {
      db.prepare(`DELETE FROM "${tabela}" WHERE shop_id = ?`).run(LOJA_B);
    }
  })();

  assert.deepEqual(
    {
      pedidos: listOrders(LOJA_A).length,
      produtos: listProducts(LOJA_A).length,
      motoboys: listDrivers(LOJA_A).length,
      cupons: listCoupons(LOJA_A).length,
      selos: getLoyaltyPoints(LOJA_A, 'cli-1'),
    },
    antesA
  );
  assert.equal(listOrders(LOJA_B).length, 0);
  assert.equal(listProducts(LOJA_B).length, 0);
});

test('a loja nova nasce com o NOME dela, não com o da loja anterior', () => {
  // `settings.storeName` é o que o cliente lê na tela, no cupom e no push. A
  // linha em `shops` é administrativa. Sem os dois, toda loja nova nascia
  // chamada como a primeira.
  const id = createShop(db, { slug: 'sorveteria', name: 'Sorveteria da Rua' });
  assert.equal(getMetaValue(id, 'store_name'), 'Sorveteria da Rua');
  assert.equal(getMetaValue(id, 'pix_merchant_name'), 'Sorveteria da Rua');
});
