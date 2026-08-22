import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { runMigrations } from '../runner';
import { MIGRATIONS } from './index';
import { INITIAL_PRODUCTS } from '../seed/catalogTemplate';

function novo(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

const contar = (db: Database.Database, tabela: string) =>
  (db.prepare(`SELECT COUNT(*) c FROM ${tabela}`).get() as { c: number }).c;

test('um banco vazio recebe todas as migrações e nenhuma erra', () => {
  const db = novo();
  const aplicadas = runMigrations(db, MIGRATIONS);
  assert.deepEqual(aplicadas, MIGRATIONS.map((m) => m.id));
});

test('a migração dos combos NÃO semeia um banco novo', () => {
  // Este era o bug: as migrações rodam no import de `db.ts` e os seeds rodam
  // depois. Inserindo 3 combos aqui, o `seedProducts` desistia por achar que já
  // havia catálogo — e a loja nova abria com 3 combos e nenhum caldinho.
  const db = novo();
  runMigrations(db, MIGRATIONS);
  assert.equal(contar(db, 'products'), 0, 'loja nova sai daqui com a tabela vazia, para o seed encher');
});

test('a migração dos combos conserta uma loja ANTIGA que já tem catálogo', () => {
  const db = novo();
  runMigrations(db, [MIGRATIONS[0]]);
  // Uma loja de antes dos combos: catálogo populado, zero combos.
  const insert = db.prepare('INSERT INTO products (id, data) VALUES (?, ?)');
  const semCombos = INITIAL_PRODUCTS.filter((p) => p.category !== 'combos');
  for (const p of semCombos) insert.run(p.id, JSON.stringify(p));

  runMigrations(db, MIGRATIONS);

  const combos = INITIAL_PRODUCTS.filter((p) => p.category === 'combos');
  assert.ok(combos.length > 0, 'o template precisa ter combos para este teste valer');
  assert.equal(contar(db, 'products'), semCombos.length + combos.length);
});

test('a migração dos combos não sobrescreve um produto que o dono editou', () => {
  const db = novo();
  runMigrations(db, [MIGRATIONS[0]]);
  const combo = INITIAL_PRODUCTS.find((p) => p.category === 'combos');
  assert.ok(combo, 'o template precisa ter ao menos um combo');
  db.prepare('INSERT INTO products (id, data) VALUES (?, ?)').run(
    combo.id,
    JSON.stringify({ ...combo, name: 'Nome que a dona escolheu', basePrice: 99 })
  );

  runMigrations(db, MIGRATIONS);

  const guardado = JSON.parse(
    (db.prepare('SELECT data FROM products WHERE id = ?').get(combo.id) as { data: string }).data
  );
  assert.equal(guardado.name, 'Nome que a dona escolheu');
  assert.equal(guardado.basePrice, 99);
});

test('senha de motoboy em texto claro vira hash, e um hash existente não é rehashado', () => {
  const db = novo();
  runMigrations(db, [MIGRATIONS[0]]);
  const insert = db.prepare('INSERT INTO drivers (id, data) VALUES (?, ?)');
  insert.run('drv-claro', JSON.stringify({ id: 'drv-claro', name: 'A', password: '1234' }));
  insert.run('drv-hash', JSON.stringify({ id: 'drv-hash', name: 'B', password: 'scrypt:ja-e-hash' }));

  runMigrations(db, MIGRATIONS);

  const ler = (id: string) =>
    JSON.parse((db.prepare('SELECT data FROM drivers WHERE id = ?').get(id) as { data: string }).data);
  assert.match(ler('drv-claro').password, /^scrypt:/);
  assert.equal(ler('drv-hash').password, 'scrypt:ja-e-hash', 'hash existente não pode ser hashado de novo');
});

test('um banco antigo sem orders.customer_id ganha a coluna e o índice', () => {
  const db = novo();
  db.exec(`
    CREATE TABLE orders (id TEXT PRIMARY KEY, data TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  db.prepare('INSERT INTO orders VALUES (?,?,?,?)').run('CX-1', '{}', 'recebido', '2024-01-01');

  runMigrations(db, MIGRATIONS);

  const colunas = (db.prepare('PRAGMA table_info(orders)').all() as { name: string }[]).map((c) => c.name);
  assert.ok(colunas.includes('customer_id'));
  assert.equal(contar(db, 'orders'), 1, 'o pedido antigo não pode se perder');
  // A 002 cria `idx_orders_customer_created`; a 006 o substitui pela versão com
  // a loja na frente. O que precisa existir no fim é o novo.
  const indice = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_orders_shop_customer'")
    .get();
  assert.ok(indice, 'o índice de histórico por cliente (com a loja) precisa existir');
});

test('a loja 1 nasce e todo pedido existente passa a pertencer a ela', () => {
  const db = novo();
  runMigrations(db, MIGRATIONS.slice(0, 2));
  db.prepare('INSERT INTO orders (id, data, status, created_at) VALUES (?,?,?,?)').run(
    'CX-1',
    JSON.stringify({ id: 'CX-1', total: 45.16, rating: 5, payment: { isPaid: true } }),
    'entregue',
    '2025-01-01'
  );

  runMigrations(db, MIGRATIONS);

  const loja = db.prepare('SELECT id, slug, active FROM shops WHERE id = 1').get() as {
    id: number;
    slug: string;
    active: number;
  };
  assert.equal(loja.id, 1);
  assert.equal(loja.active, 1);

  const pedido = db
    .prepare('SELECT shop_id, total_cents, is_paid, rating FROM orders WHERE id = ?')
    .get('CX-1') as { shop_id: number; total_cents: number; is_paid: number; rating: number };
  assert.equal(pedido.shop_id, 1, 'o pedido que já existia é da loja 1');
  assert.equal(pedido.total_cents, 4516, 'o total sai do JSON para centavos inteiros');
  assert.equal(pedido.is_paid, 1);
  assert.equal(pedido.rating, 5);
});

test('duas lojas não podem dividir o mesmo subdomínio', () => {
  const db = novo();
  runMigrations(db, MIGRATIONS);
  const inserir = db.prepare(
    "INSERT INTO shops (slug, name, active, created_at) VALUES (?, ?, 1, '2026-01-01')"
  );
  inserir.run('pizzaria', 'Pizzaria');
  assert.throws(() => inserir.run('pizzaria', 'Outra'), /UNIQUE/);
});

test('um pedido que cita motoboy apagado não derruba a migração', () => {
  const db = novo();
  runMigrations(db, MIGRATIONS.slice(0, 2));
  db.prepare('INSERT INTO orders (id, data, status, created_at) VALUES (?,?,?,?)').run(
    'CX-VELHO',
    JSON.stringify({ id: 'CX-VELHO', driverId: 'drv-que-foi-embora', total: 10 }),
    'entregue',
    '2024-01-01'
  );

  runMigrations(db, MIGRATIONS);

  const pedido = db.prepare('SELECT driver_id FROM orders WHERE id = ?').get('CX-VELHO') as {
    driver_id: string | null;
  };
  assert.equal(pedido.driver_id, null, 'motoboy que não existe mais não vira chave estrangeira quebrada');
});
