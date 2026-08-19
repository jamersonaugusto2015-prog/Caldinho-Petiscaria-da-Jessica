// Backup automático do banco SQLite para o Google Drive (conta de serviço).

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
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

// Timeout de rede: sem ele, uma chamada travada ao Google (ou uma rede caída)
// prende o scheduler e o botão "rodar backup agora" da cozinha indefinidamente,
// sem nunca reportar erro.
const NETWORK_TIMEOUT_MS = 30_000;

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
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });
  const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(
      'Falha na autenticação do Google: ' + (data.error_description || data.error || res.status)
    );
  }
  return data.access_token;
}

// Snapshot consistente do SQLite (usa a Online Backup API do SQLite via
// better-sqlite3, não um fs.copyFile — copiar o arquivo bruto em modo WAL
// pode pegar o .db sem o conteúdo ainda no -wal e gerar um snapshot corrompido)
function backupSnapshotPath(): string {
  const backupDir = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  return path.join(backupDir, `caldinho-${stamp}.db`);
}

const SQLITE_HEADER = 'SQLite format 3\0';

/**
 * Confere que o snapshot é um banco SQLite íntegro antes de subir pro Drive.
 * Um backup vazio ou truncado (disco cheio, falha de permissão a meio da
 * cópia) não pode virar "backup_last_status = ok" silenciosamente — a cozinha
 * confiaria numa proteção que não existe.
 */
export function assertValidSnapshot(file: string): void {
  const stat = fs.statSync(file);
  if (stat.size === 0) {
    throw new Error('Snapshot do banco ficou vazio (0 bytes) — abortando backup.');
  }
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length);
    fs.readSync(fd, header, 0, header.length, 0);
    if (header.toString('utf8') !== SQLITE_HEADER) {
      throw new Error('Snapshot do banco não é um arquivo SQLite válido — abortando backup.');
    }
  } finally {
    fs.closeSync(fd);
  }
  // Checagem estrutural rápida (varre as páginas, não as foreign keys) — pega
  // truncamento/corrupção que um header válido sozinho não denuncia.
  const check = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const result = check.pragma('quick_check') as Array<{ quick_check: string }>;
    const ok = result.length === 1 && result[0].quick_check === 'ok';
    if (!ok) {
      throw new Error('Snapshot do banco falhou no quick_check do SQLite — abortando backup.');
    }
  } finally {
    check.close();
  }
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
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
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
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });
  const data = (await res.json()) as { files?: { id: string; name: string }[]; error?: { message?: string } };
  if (!res.ok) throw new Error('Falha ao listar backups: ' + (data.error?.message || res.status));
  return data.files || [];
}

async function deleteDriveFile(accessToken: string, fileId: string): Promise<void> {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
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
  // A env var tem prioridade: mantém a credencial fora do próprio banco que ela
  // protege, então perder o disco não derruba junto o acesso ao backup.
  const serviceAccount = process.env.BACKUP_SERVICE_ACCOUNT || getMeta('backup_service_account');
  if (!serviceAccount) {
    setMeta('backup_last_status', 'error:chave não cadastrada');
    return { ok: false, error: 'Chave da conta de serviço não cadastrada.' };
  }
  const folderId = getMeta('backup_folder_id') || undefined;
  // Caminho decidido antes de qualquer chamada que possa falhar, para que o
  // `finally` consiga limpar o arquivo mesmo se db.backup() jogar exceção no
  // meio da cópia (disco cheio, etc.) — antes, uma falha nesse ponto pulava
  // direto pro catch e deixava o .db parcial no disco de 1 GB para sempre.
  const snapshot = backupSnapshotPath();
  try {
    const token = await getDriveAccessToken(serviceAccount);
    await db.backup(snapshot);
    assertValidSnapshot(snapshot);
    const fileName = path.basename(snapshot);
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setMeta('backup_last_run', new Date().toISOString());
    setMeta('backup_last_status', 'error:' + message.slice(0, 300));
    return { ok: false, error: message };
  } finally {
    try {
      if (fs.existsSync(snapshot)) fs.unlinkSync(snapshot);
    } catch {
      /* ignora */
    }
  }
}
