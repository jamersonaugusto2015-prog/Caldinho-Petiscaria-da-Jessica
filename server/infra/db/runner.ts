import type { Database } from 'better-sqlite3';

/**
 * O aplicador de migrações.
 *
 * Antes disto o schema nascia de um `db.exec` gigante com `CREATE TABLE IF NOT
 * EXISTS` e de duas funções que rodavam a CADA boot varrendo tabelas inteiras
 * ("migrações-fantasma"). Ninguém sabia em que versão um banco estava, e a
 * única prova de que uma correção já tinha rodado era ela rodar de novo.
 *
 * Aqui cada mudança tem um id, roda UMA vez, dentro de uma transação, e fica
 * registrada em `schema_version`. Um banco novo e um banco de dois anos atrás
 * chegam no mesmo lugar pelo mesmo caminho.
 */
export interface Migration {
  /**
   * `NNN_nome_curto`. É a chave gravada em `schema_version`.
   * NUNCA renomeie um id já aplicado: o banco não reconheceria e rodaria de novo.
   */
  id: string;
  /** SQL puro. Use `run` quando a migração precisar de JavaScript. */
  sql?: string;
  /** Migração que precisa de JS (hash de senha, reescrita de JSON dentro da linha). */
  run?: (db: Database) => void;
  /**
   * Desliga `foreign_keys` durante esta migração. Necessário só nos rebuilds de
   * tabela do SQLite (criar nova → copiar → dropar → renomear), onde as chaves
   * estrangeiras apontariam para a tabela velha no meio do caminho.
   *
   * O pragma NÃO pode ser trocado dentro de uma transação, então ele é desligado
   * fora dela e religado depois — inclusive se a migração falhar.
   */
  disableForeignKeys?: boolean;
}

const SCHEMA_VERSION_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_version (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`;

/**
 * Aplica o que falta, na ordem da lista, e devolve os ids aplicados AGORA.
 *
 * Lança na primeira falha, de propósito: subir o servidor com o schema pela
 * metade é pior do que não subir. A transação por migração garante que o que
 * falhou não deixou meia tabela para trás.
 */
export function runMigrations(db: Database, migrations: Migration[]): string[] {
  db.exec(SCHEMA_VERSION_TABLE);

  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.id)) {
      throw new Error(`Migração duplicada: ${migration.id}`);
    }
    if (!migration.sql && !migration.run) {
      throw new Error(`Migração ${migration.id} não tem nem sql nem run.`);
    }
    seen.add(migration.id);
  }

  const applied = new Set(
    (db.prepare('SELECT id FROM schema_version').all() as { id: string }[]).map((r) => r.id)
  );

  // Banco ADIANTADO em relação ao código (deploy antigo depois de um rollback):
  // não é fatal — o esquema mais novo costuma ser compatível — mas rodar calado
  // é como banco e código divergem sem ninguém perceber.
  const conhecidas = new Set(migrations.map((m) => m.id));
  const aFrente = [...applied].filter((id) => !conhecidas.has(id));
  if (aFrente.length > 0) {
    console.warn(
      `⚠️  O banco tem ${aFrente.length} migração(ões) que este código não conhece: ${aFrente.join(', ')}.`
    );
  }
  const record = db.prepare('INSERT INTO schema_version (id, applied_at) VALUES (?, ?)');
  const fresh: string[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    const apply = db.transaction(() => {
      if (migration.sql) db.exec(migration.sql);
      migration.run?.(db);

      if (migration.disableForeignKeys) {
        // Depois de mexer na forma das tabelas, conferir que nenhuma linha ficou
        // apontando para o vazio. Roda DENTRO da transação de propósito: assim
        // um resultado ruim desfaz a migração em vez de só reclamar depois.
        const broken = db.pragma('foreign_key_check') as unknown[];
        if (broken.length > 0) {
          throw new Error(
            `Migração ${migration.id} deixou ${broken.length} linha(s) órfã(s). Nada foi gravado.`
          );
        }
      }

      record.run(migration.id, new Date().toISOString());
    });

    try {
      if (!migration.disableForeignKeys) {
        apply();
      } else {
        // O pragma não muda dentro de uma transação, então ele é desligado aqui
        // fora — e religado no `finally`, inclusive quando a migração explode.
        const wasOn = db.pragma('foreign_keys', { simple: true }) === 1;
        db.pragma('foreign_keys = OFF');
        try {
          apply();
        } finally {
          if (wasOn) db.pragma('foreign_keys = ON');
        }
      }
    } catch (erro) {
      // O SQLite explica o QUÊ ("UNIQUE constraint failed"), mas não ONDE. Sem
      // o id aqui, o operador de um boot travado fica adivinhando qual das
      // migrações parou o banco.
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      throw detalhe.startsWith(`Migração ${migration.id}`)
        ? erro
        : new Error(`Migração ${migration.id} falhou: ${detalhe}`);
    }

    fresh.push(migration.id);
  }

  return fresh;
}

/** Em que versão o banco está. Vazio = banco novo. */
export function appliedMigrations(db: Database): string[] {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'")
    .get();
  if (!table) return [];
  return (
    db.prepare('SELECT id FROM schema_version ORDER BY id').all() as { id: string }[]
  ).map((r) => r.id);
}
