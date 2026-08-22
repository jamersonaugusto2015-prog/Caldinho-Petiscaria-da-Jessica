import { db } from '../../db';
import { DomainError } from '../../errors';
import type { Driver } from '../../../contract/driver/types';
import type { ShopId } from '../../../contract/shop/types';

/**
 * O cadastro dos motoboys de uma loja.
 *
 * Isto morava solto em `routes.ts`, em nove `db.prepare` espalhados por seis
 * rotas — cada uma com a sua ideia de como ler e gravar um motoboy. O router
 * agora traduz e delega; o SQL mora aqui.
 *
 * A coluna `name` existe fora do JSON (migração `008_drivers_shop`) por um
 * motivo só: o índice `UNIQUE(shop_id, name COLLATE NOCASE)`. Ver `nomeEmUso`.
 */

function parse(row: { data: string } | undefined): Driver | null {
  return row ? (JSON.parse(row.data) as Driver) : null;
}

export function listDrivers(shopId: ShopId): Driver[] {
  const rows = db
    .prepare('SELECT data FROM drivers WHERE shop_id = ? ORDER BY rowid')
    .all(shopId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Driver);
}

export function getDriver(shopId: ShopId, id: string): Driver | null {
  return parse(
    db.prepare('SELECT data FROM drivers WHERE shop_id = ? AND id = ?').get(shopId, id) as
      | { data: string }
      | undefined
  );
}

/**
 * Acha o motoboy pelo nome, para o login.
 *
 * `COLLATE NOCASE` no SQL, e não `.toLowerCase()` no JavaScript: é a MESMA
 * comparação que o índice único usa. Duas regras de igualdade diferentes
 * deixariam passar um cadastro que o login depois não conseguisse resolver.
 */
export function findDriverByName(shopId: ShopId, name: string): Driver | null {
  const alvo = name.trim();
  if (!alvo) return null;
  const driver = parse(
    db
      .prepare('SELECT data FROM drivers WHERE shop_id = ? AND name = ? COLLATE NOCASE')
      .get(shopId, alvo) as { data: string } | undefined
  );
  return driver?.active ? driver : null;
}

/**
 * Grava o motoboy. Traduz a violação do índice único numa mensagem que a
 * cozinha entende.
 *
 * O que isto substitui era um laço em JavaScript que lia a equipe INTEIRA e
 * comparava nome por nome. Além de ler tudo à toa, ele perdia a corrida: dois
 * cadastros chegando juntos passavam os dois pela checagem e os dois entravam,
 * deixando o login ambíguo — e um dos dois motoboys nunca mais entrava no app.
 * Um índice único não perde essa corrida.
 */
function gravar(shopId: ShopId, driver: Driver, sql: string, params: unknown[]): Driver {
  try {
    db.prepare(sql).run(...params);
  } catch (err) {
    if (String(err).includes('UNIQUE') && String(err).includes('drivers')) {
      throw new DomainError(
        409,
        `Já existe um motoboy chamado "${driver.name.trim()}". Use um nome diferente (ex.: "João M.").`
      );
    }
    throw err;
  }
  return driver;
}

export function insertDriver(shopId: ShopId, driver: Driver): Driver {
  return gravar(
    shopId,
    driver,
    'INSERT INTO drivers (shop_id, id, name, active, data) VALUES (?, ?, ?, ?, ?)',
    [shopId, driver.id, driver.name.trim(), driver.active ? 1 : 0, JSON.stringify(driver)]
  );
}

export function updateDriver(shopId: ShopId, driver: Driver): Driver {
  return gravar(
    shopId,
    driver,
    'UPDATE drivers SET name = ?, active = ?, data = ? WHERE shop_id = ? AND id = ?',
    [driver.name.trim(), driver.active ? 1 : 0, JSON.stringify(driver), shopId, driver.id]
  );
}

export function deleteDriver(shopId: ShopId, id: string): void {
  db.transaction(() => {
    // `orders.driver_id` referencia `drivers(id)` sem ON DELETE (migração 006):
    // apagar um motoboy que já entregou estourava a FK e virava um 500 na tela
    // da cozinha. O histórico não se perde — o nome dele continua no JSON do
    // pedido — só a coluna de índice solta a referência.
    db.prepare('UPDATE orders SET driver_id = NULL WHERE shop_id = ? AND driver_id = ?').run(
      shopId,
      id
    );
    db.prepare('DELETE FROM drivers WHERE shop_id = ? AND id = ?').run(shopId, id);
  })();
}
