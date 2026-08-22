import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

/**
 * Estes testes não conferem regra de negócio — conferem que o ponto de
 * composição está COMPLETO e que cada closure carrega A LOJA CERTA. Uma
 * dependência esquecida aqui compila sem reclamar (o campo é opcional na
 * interface) e explode em produção, na rota que ninguém abriu.
 *
 * DATA_DIR temporário e imports dinâmicos: `server/db.ts` abre o SQLite no
 * import e roda as migrações. Sem isto, rodar os testes aplicaria uma migração
 * nova no banco de desenvolvimento real do dono da máquina.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'caldinho-deps-'));
process.env.DATA_DIR = DATA_DIR;

const { orderIntakeDeps, orderLifecycleDeps } = await import('./deps');
const { LOJA_PADRAO, db } = await import('../db');
const { createShop } = await import('../infra/db/seed/createShop');
const { createProduct } = await import('../catalog');

after(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
});

test('o pacote do ciclo de vida traz tudo que o domínio pede', () => {
  const deps = orderLifecycleDeps(LOJA_PADRAO);
  for (const campo of ['getSettings', 'getDriver', 'earnStamp', 'saveOrder'] as const) {
    assert.equal(typeof deps[campo], 'function', `faltou ${campo}`);
  }
});

test('o pacote da entrada de pedido traz tudo que o domínio pede', () => {
  const deps = orderIntakeDeps(LOJA_PADRAO);
  // `settings` pode ser objeto ou função; o resto é sempre função.
  assert.ok(deps.settings, 'faltou settings');
  for (const campo of [
    'loadProduct',
    'listCoupons',
    'listPromotions',
    'listProducts',
    'registerPromotionUses',
    'peekFreeRedeem',
    'consumeFreeItems',
    'persistOrder',
    'getLoyaltyPoints',
  ] as const) {
    assert.equal(typeof deps[campo], 'function', `faltou ${campo}`);
  }
  assert.equal(typeof deps.payment?.collectPix, 'function', 'faltou o adaptador de cobrança');
  assert.equal(typeof deps.payment?.collectCard, 'function', 'faltou o adaptador de cobrança');
});

test('cada closure lê a SUA loja: o mesmo id de produto dá resultados diferentes', () => {
  // O ponto inteiro da Fase 5 é que a closure carrega o shopId certo. Um id de
  // produto igual nas duas lojas tem que devolver o produto DE CADA UMA — se a
  // dep ignorasse o shopId, as duas leriam a mesma linha.
  const lojaA = createShop(db, { slug: 'deps-a', name: 'Deps A' });
  const lojaB = createShop(db, { slug: 'deps-b', name: 'Deps B' });
  createProduct(lojaA, { id: 'mesmo-id', name: 'Da A', basePrice: 11, category: 'caldinhos' });
  createProduct(lojaB, { id: 'mesmo-id', name: 'Da B', basePrice: 22, category: 'caldinhos' });

  const depsA = orderIntakeDeps(lojaA);
  const depsB = orderIntakeDeps(lojaB);
  assert.equal(depsA.loadProduct('mesmo-id')?.basePrice, 11);
  assert.equal(depsB.loadProduct('mesmo-id')?.basePrice, 22);
});

test('a loja que existia antes do multi-tenant é a 1', () => {
  // É o id que a migração `005_shops` cria e para onde todos os backfills
  // apontam. Nenhum outro lugar do sistema pode inventar este número.
  assert.equal(LOJA_PADRAO, 1);
});
