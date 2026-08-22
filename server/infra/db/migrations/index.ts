import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Database } from 'better-sqlite3';
import { hashPasswordSync } from '../../../auth';
import type { Migration } from '../runner';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const sql = (file: string): string => fs.readFileSync(path.join(HERE, file), 'utf8');

/**
 * `orders.customer_id` num banco anterior ao histórico do cliente.
 *
 * A baseline já declara a coluna, mas `CREATE TABLE IF NOT EXISTS` não mexe numa
 * tabela que já existe — então um banco antigo passaria pela 001 sem ganhar
 * nada. Esta é a antiga `migrateOrdersCustomerId()`, que rodava a cada boot.
 */
function addOrdersCustomerId(db: Database): void {
  const columns = db.prepare('PRAGMA table_info(orders)').all() as { name: string }[];
  if (!columns.some((c) => c.name === 'customer_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN customer_id TEXT');
  }
  // O índice mora aqui, e não na baseline, porque só agora a coluna existe com
  // certeza — nos dois caminhos: banco novo (a 001 criou a tabela já com ela) e
  // banco antigo (a linha acima acabou de acrescentar).
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders (customer_id, created_at)'
  );
}

/**
 * Senha de motoboy em texto claro vira hash scrypt.
 *
 * Isto rodava a CADA boot (`upgradeDriverPasswords` no antigo `db.ts`), lendo a
 * tabela de motoboys inteira toda vez para quase sempre não achar nada. Como
 * migração, roda uma vez e some do caminho crítico do boot.
 */
function hashDriverPasswords(db: Database): void {
  const rows = db.prepare('SELECT id, data FROM drivers').all() as { id: string; data: string }[];
  const update = db.prepare('UPDATE drivers SET data = ? WHERE id = ?');
  for (const row of rows) {
    const driver = JSON.parse(row.data) as { password?: unknown };
    if (typeof driver.password === 'string' && !driver.password.startsWith('scrypt:')) {
      driver.password = hashPasswordSync(driver.password);
      update.run(JSON.stringify(driver), row.id);
    }
  }
}

/**
 * Os combos entraram no catálogo de exemplo depois que lojas antigas já tinham
 * banco populado. `seedProducts` só roda com a tabela vazia, então essas lojas
 * nunca ganhariam a categoria Combos.
 *
 * `INSERT OR IGNORE` é o ponto: nada sobrescreve um produto que o dono já
 * editou. Antes isto também rodava a cada boot; agora roda uma vez, e quem
 * apagar um combo de propósito não vai vê-lo ressuscitar no próximo deploy.
 */
function backfillSeedCombos(db: Database): void {
  // ⚠ A tabela VAZIA é o caso em que esta migração não pode fazer nada.
  //
  // O motivo é a ordem: as migrações rodam no import de `db.ts`, e os seeds
  // rodam logo depois. Numa loja NOVA, inserir os 3 combos aqui deixaria a
  // tabela "não vazia" — e o `seedProducts` desistiria por achar que já tinha
  // catálogo. A loja abriria com 3 combos e nenhum caldinho. É o oposto do que
  // esta migração existe para fazer: ela conserta loja ANTIGA; loja nova recebe
  // o catálogo inteiro pelo seed.
  const total = (db.prepare('SELECT COUNT(*) AS c FROM products').get() as { c: number }).c;
  if (total === 0) return;

  /**
   * Os combos vêm CONGELADOS num JSON ao lado das migrações, e não do catálogo
   * de exemplo vivo: uma migração aplicada não pode mudar de significado
   * quando o template evoluir. Um 4º combo no template daria três resultados
   * diferentes para três bancos, todos no mesmo número de versão.
   */
  const combos = JSON.parse(
    fs.readFileSync(path.join(HERE, '004_backfill_seed_combos.json'), 'utf8')
  ) as { id: string }[];
  const insert = db.prepare('INSERT OR IGNORE INTO products (id, data) VALUES (?, ?)');
  for (const product of combos) insert.run(product.id, JSON.stringify(product));
}

/**
 * A ordem desta lista É o histórico do banco. Só se acrescenta no fim.
 *
 * A lista é explícita (em vez de varrer a pasta) porque migrações em SQL e em
 * JavaScript precisam entrar na MESMA sequência: `002` depende de `001` ter
 * criado a tabela, e uma varredura de `*.sql` não teria onde encaixar as duas
 * migrações que precisam de código.
 */
export const MIGRATIONS: Migration[] = [
  { id: '001_baseline', sql: sql('001_baseline.sql') },
  { id: '002_orders_customer_id', run: addOrdersCustomerId },
  { id: '003_hash_driver_passwords', run: hashDriverPasswords },
  { id: '004_backfill_seed_combos', run: backfillSeedCombos },
  { id: '005_shops', sql: sql('005_shops.sql') },
  { id: '006_orders_shop', sql: sql('006_orders_shop.sql') },
  { id: '007_chat_messages_shop', sql: sql('007_chat_messages_shop.sql'), disableForeignKeys: true },
  { id: '008_drivers_shop', sql: sql('008_drivers_shop.sql') },
  { id: '009_driver_tokens_shop', sql: sql('009_driver_tokens_shop.sql'), disableForeignKeys: true },
  { id: '010_push_subscriptions_shop', sql: sql('010_push_subscriptions_shop.sql') },
  { id: '011_promotions_shop', sql: sql('011_promotions_shop.sql') },
  // 012, 013, 016 e 018 reconstroem tabelas que não estão em NENHUM lado de
  // uma FK — desligar o pragma (e pagar um foreign_key_check do banco inteiro)
  // nelas era custo por nada.
  { id: '012_loyalty_shop', sql: sql('012_loyalty_shop.sql') },
  { id: '013_categories_shop', sql: sql('013_categories_shop.sql') },
  { id: '014_products_shop', sql: sql('014_products_shop.sql'), disableForeignKeys: true },
  { id: '015_free_redeems_shop', sql: sql('015_free_redeems_shop.sql'), disableForeignKeys: true },
  { id: '016_coupons_shop', sql: sql('016_coupons_shop.sql') },
  { id: '017_geo_cache_global', sql: sql('017_geo_cache_global.sql') },
  { id: '018_meta_shop', sql: sql('018_meta_shop.sql') },
  { id: '019_shop_secrets', sql: sql('019_shop_secrets.sql') },
  { id: '020_server_config', sql: sql('020_server_config.sql') },
  { id: '021_order_events', sql: sql('021_order_events.sql') },
  { id: '022_platform_admins', sql: sql('022_platform_admins.sql') },
];
