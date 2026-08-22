import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// server/db.ts opens a real sqlite file at DATA_DIR the moment it is imported, and this repo's
// dev DATA_DIR already has live data (including a real Mercado Pago token and, potentially, a
// real backup service account). This override MUST run before ./backup is loaded (hence the
// dynamic import below), or these tests would run against production data.
const testDataDir = mkdtempSync(path.join(os.tmpdir(), 'caldinho-backup-test-'));
process.env.DATA_DIR = testDataDir;

const { runBackup, assertValidSnapshot } = await import('./backup');
const { db, LOJA_PADRAO } = await import('./db');

function backupsDir(): string {
  return path.join(testDataDir, 'backups');
}

function leftoverBackupFiles(): string[] {
  if (!fs.existsSync(backupsDir())) return [];
  return fs.readdirSync(backupsDir());
}

test('runBackup reports a clear, actionable error when no service account key is configured', async () => {
  delete process.env.BACKUP_SERVICE_ACCOUNT;
  db.prepare("DELETE FROM shop_secrets WHERE shop_id = ? AND key = 'backup_service_account'").run(LOJA_PADRAO);

  const result = await runBackup(LOJA_PADRAO);

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /chave.*conta de serviço/i);
  // No snapshot should have been created at all — we bailed before touching the disk.
  assert.deepEqual(leftoverBackupFiles(), []);
});

test('runBackup fails clearly (not silently ok:true) when the service account key is invalid, and leaves no temp file behind', async () => {
  process.env.BACKUP_SERVICE_ACCOUNT = JSON.stringify({
    client_email: 'fake@example.iam.gserviceaccount.com',
    // Not a real PEM key — signing throws, which is what a corrupted/truncated credential
    // (e.g. pasted wrong into the kitchen settings panel) looks like in production.
    private_key: 'not-a-real-key',
  });

  const result = await runBackup(LOJA_PADRAO);

  assert.equal(result.ok, false);
  assert.ok(result.error, 'must report a reason the kitchen can act on');
  const status = (
    db
      .prepare("SELECT value FROM meta WHERE shop_id = ? AND key = 'backup_last_status'")
      .get(LOJA_PADRAO) as { value: string } | undefined
  )?.value;
  assert.ok(status?.startsWith('error:'), `expected a recorded error status, got: ${status}`);
  // db.backup() runs before the auth call resolves in this path? No — auth is awaited first,
  // so the snapshot step never runs. Either way, nothing should be left in backups/.
  assert.deepEqual(leftoverBackupFiles(), []);

  delete process.env.BACKUP_SERVICE_ACCOUNT;
});

test('assertValidSnapshot rejects a 0-byte file instead of letting it upload as "ok"', () => {
  const file = path.join(testDataDir, 'empty.db');
  fs.writeFileSync(file, Buffer.alloc(0));
  assert.throws(() => assertValidSnapshot(file), /vazio/i);
  fs.unlinkSync(file);
});

test('assertValidSnapshot rejects a file that is not a SQLite database', () => {
  const file = path.join(testDataDir, 'garbage.db');
  fs.writeFileSync(file, 'this is not a sqlite file, just text\n'.repeat(10));
  assert.throws(() => assertValidSnapshot(file), /válido/i);
  fs.unlinkSync(file);
});

test('assertValidSnapshot accepts a real SQLite backup produced by db.backup()', async () => {
  const file = path.join(testDataDir, 'real-snapshot.db');
  await db.backup(file);
  assert.doesNotThrow(() => assertValidSnapshot(file));
  fs.unlinkSync(file);
});

test('runBackup cleans up the local snapshot directory even when it fails fast', async () => {
  delete process.env.BACKUP_SERVICE_ACCOUNT;
  db.prepare("DELETE FROM shop_secrets WHERE shop_id = ? AND key = 'backup_service_account'").run(LOJA_PADRAO);
  await runBackup(LOJA_PADRAO);
  assert.deepEqual(leftoverBackupFiles(), []);
});
