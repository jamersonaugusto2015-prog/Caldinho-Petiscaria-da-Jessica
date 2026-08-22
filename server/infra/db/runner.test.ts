import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { appliedMigrations, runMigrations, type Migration } from './runner';

function memory(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

test('um banco novo não tem versão nenhuma', () => {
  assert.deepEqual(appliedMigrations(memory()), []);
});

test('as migrações rodam em ordem e ficam registradas', () => {
  const db = memory();
  const fresh = runMigrations(db, [
    { id: '001_a', sql: 'CREATE TABLE a (id TEXT PRIMARY KEY);' },
    { id: '002_b', sql: 'CREATE TABLE b (id TEXT PRIMARY KEY);' },
  ]);
  assert.deepEqual(fresh, ['001_a', '002_b']);
  assert.deepEqual(appliedMigrations(db), ['001_a', '002_b']);
});

test('a segunda execução não reaplica nada', () => {
  const db = memory();
  const list: Migration[] = [{ id: '001_a', sql: 'CREATE TABLE a (id TEXT PRIMARY KEY);' }];
  runMigrations(db, list);
  assert.deepEqual(runMigrations(db, list), []);
});

test('só o que falta é aplicado quando uma migração nova entra na lista', () => {
  const db = memory();
  runMigrations(db, [{ id: '001_a', sql: 'CREATE TABLE a (id TEXT PRIMARY KEY);' }]);
  const fresh = runMigrations(db, [
    { id: '001_a', sql: 'CREATE TABLE a (id TEXT PRIMARY KEY);' },
    { id: '002_b', sql: 'CREATE TABLE b (id TEXT PRIMARY KEY);' },
  ]);
  assert.deepEqual(fresh, ['002_b']);
});

test('uma migração em JavaScript recebe o banco e roda uma vez só', () => {
  const db = memory();
  let calls = 0;
  const list: Migration[] = [
    { id: '001_a', sql: 'CREATE TABLE a (id TEXT PRIMARY KEY);' },
    {
      id: '002_js',
      run: (handle) => {
        calls += 1;
        handle.prepare('INSERT INTO a (id) VALUES (?)').run('x');
      },
    },
  ];
  runMigrations(db, list);
  runMigrations(db, list);
  assert.equal(calls, 1);
  assert.equal((db.prepare('SELECT COUNT(*) c FROM a').get() as { c: number }).c, 1);
});

test('a migração que falha não deixa metade do trabalho no banco', () => {
  const db = memory();
  assert.throws(() =>
    runMigrations(db, [
      {
        id: '001_meio',
        sql: 'CREATE TABLE a (id TEXT PRIMARY KEY); CREATE TABLE a (id TEXT PRIMARY KEY);',
      },
    ])
  );
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='a'")
    .all();
  assert.deepEqual(tables, [], 'a tabela criada antes do erro devia ter sumido junto');
  assert.deepEqual(appliedMigrations(db), [], 'a migração que falhou não pode ficar registrada');
});

test('a migração que falha pode ser reaplicada depois de corrigida', () => {
  const db = memory();
  assert.throws(() => runMigrations(db, [{ id: '001_x', sql: 'ISTO NÃO É SQL;' }]));
  const fresh = runMigrations(db, [{ id: '001_x', sql: 'CREATE TABLE x (id TEXT PRIMARY KEY);' }]);
  assert.deepEqual(fresh, ['001_x']);
});

test('id repetido é recusado antes de qualquer escrita', () => {
  const db = memory();
  assert.throws(
    () =>
      runMigrations(db, [
        { id: '001_a', sql: 'CREATE TABLE a (id TEXT PRIMARY KEY);' },
        { id: '001_a', sql: 'CREATE TABLE b (id TEXT PRIMARY KEY);' },
      ]),
    /duplicada/
  );
  assert.deepEqual(appliedMigrations(db), []);
});

test('migração sem sql e sem run é recusada', () => {
  assert.throws(() => runMigrations(memory(), [{ id: '001_vazia' }]), /nem sql nem run/);
});

test('o rebuild de tabela roda com as chaves estrangeiras desligadas e religa depois', () => {
  const db = memory();
  runMigrations(db, [
    {
      id: '001_base',
      sql: `
        CREATE TABLE pai (id TEXT PRIMARY KEY);
        CREATE TABLE filho (id TEXT PRIMARY KEY, pai_id TEXT NOT NULL REFERENCES pai(id));
      `,
    },
  ]);
  db.prepare('INSERT INTO pai (id) VALUES (?)').run('p1');
  db.prepare('INSERT INTO filho (id, pai_id) VALUES (?, ?)').run('f1', 'p1');

  runMigrations(db, [
    { id: '001_base', sql: 'SELECT 1;' },
    {
      id: '002_rebuild',
      disableForeignKeys: true,
      sql: `
        CREATE TABLE pai_novo (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '');
        INSERT INTO pai_novo (id) SELECT id FROM pai;
        DROP TABLE pai;
        ALTER TABLE pai_novo RENAME TO pai;
      `,
    },
  ]);

  assert.equal(db.pragma('foreign_keys', { simple: true }), 1, 'o pragma tinha que voltar ligado');
  assert.equal((db.prepare('SELECT COUNT(*) c FROM filho').get() as { c: number }).c, 1);
  assert.deepEqual(db.pragma('foreign_key_check'), [], 'nenhum órfão');
});

test('o rebuild que deixa órfão é desfeito inteiro', () => {
  const db = memory();
  runMigrations(db, [
    {
      id: '001_base',
      sql: `
        CREATE TABLE pai (id TEXT PRIMARY KEY);
        CREATE TABLE filho (id TEXT PRIMARY KEY, pai_id TEXT NOT NULL REFERENCES pai(id));
      `,
    },
  ]);
  db.prepare('INSERT INTO pai (id) VALUES (?)').run('p1');
  db.prepare('INSERT INTO filho (id, pai_id) VALUES (?, ?)').run('f1', 'p1');

  assert.throws(
    () =>
      runMigrations(db, [
        { id: '001_base', sql: 'SELECT 1;' },
        {
          // Recria o pai VAZIO: o filho fica apontando para o nada.
          id: '002_ruim',
          disableForeignKeys: true,
          sql: `
            CREATE TABLE pai_novo (id TEXT PRIMARY KEY);
            DROP TABLE pai;
            ALTER TABLE pai_novo RENAME TO pai;
          `,
        },
      ]),
    /órfã/
  );

  assert.equal((db.prepare('SELECT COUNT(*) c FROM pai').get() as { c: number }).c, 1, 'o pai voltou');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1, 'o pragma tinha que voltar ligado');
  assert.deepEqual(appliedMigrations(db), ['001_base']);
});
