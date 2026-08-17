// Backup automático do banco SQLite para o Google Drive (conta de serviço).

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from './db';
import { DATA_DIR } from './paths';

function b64url(data: Buffer | string): string {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createJwt(serviceAccount: { client_email: string; private_key: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/drive.file',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = b64url(sign.sign(serviceAccount.private_key));
  return `${header}.${payload}.${signature}`;
}

async function getDriveAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson);
  const jwt = createJwt(sa);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(
      'Falha na autenticação do Google: ' + (data.error_description || data.error || res.status)
    );
  }
  return data.access_token;
}

// Snapshot consistente do SQLite (não corrompe mesmo com escrita acontecendo)
async function createBackupSnapshot(): Promise<string> {
  const backupDir = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  const file = path.join(backupDir, `caldinho-${stamp}.db`);
  await db.backup(file);
  return file;
}

async function uploadToDrive(
  accessToken: string,
  filePath: string,
  fileName: string,
  folderId?: string
): Promise<string> {
  const meta: Record<string, unknown> = { name: fileName };
  if (folderId) meta.parents = [folderId];
  const boundary = '----caldinho' + Date.now().toString(36);
  const fileContent = fs.readFileSync(filePath);
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
    ),
    Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    fileContent,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok || !data.id) {
    throw new Error('Falha no upload: ' + (data.error?.message || res.status));
  }
  return data.id;
}

async function listDriveBackups(
  accessToken: string,
  folderId?: string
): Promise<{ id: string; name: string }[]> {
  const q = folderId
    ? `'${folderId}' in parents and trashed=false and name contains 'caldinho-'`
    : "name contains 'caldinho-' and trashed=false";
  const url = `https://www.googleapis.com/drive/v3/files?fields=files(id,name)&orderBy=createdTime&pageSize=100&q=${encodeURIComponent(
    q
  )}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = (await res.json()) as { files?: { id: string; name: string }[]; error?: { message?: string } };
  if (!res.ok) throw new Error('Falha ao listar backups: ' + (data.error?.message || res.status));
  return data.files || [];
}

async function deleteDriveFile(accessToken: string, fileId: string): Promise<void> {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

function getMeta(key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : fallback;
}

function setMeta(key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

const KEEP_LAST = 15;

/** Executa o backup completo (snapshot -> upload -> limpeza) e registra o status. */
export async function runBackup(): Promise<{ ok: boolean; error?: string }> {
  const serviceAccount = getMeta('backup_service_account');
  if (!serviceAccount) {
    setMeta('backup_last_status', 'error:chave não cadastrada');
    return { ok: false, error: 'Chave da conta de serviço não cadastrada.' };
  }
  const folderId = getMeta('backup_folder_id') || undefined;
  try {
    const token = await getDriveAccessToken(serviceAccount);
    const snapshot = await createBackupSnapshot();
    const fileName = path.basename(snapshot);
    try {
      await uploadToDrive(token, snapshot, fileName, folderId);

      // Limpeza: mantém os últimos KEEP_LAST backups
      try {
        const files = await listDriveBackups(token, folderId);
        const backups = files.filter((f) => f.name.startsWith('caldinho-') && f.name.endsWith('.db'));
        const toDelete = backups.slice(0, Math.max(0, backups.length - KEEP_LAST));
        for (const f of toDelete) {
          await deleteDriveFile(token, f.id).catch(() => {});
        }
      } catch {
        /* limpeza falhou não impede o backup */
      }

      setMeta('backup_last_run', new Date().toISOString());
      setMeta('backup_last_status', 'ok');
      setMeta('backup_last_file', fileName);
      return { ok: true };
    } finally {
      try {
        fs.unlinkSync(snapshot);
      } catch {
        /* ignora */
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setMeta('backup_last_run', new Date().toISOString());
    setMeta('backup_last_status', 'error:' + message.slice(0, 300));
    return { ok: false, error: message };
  }
}
