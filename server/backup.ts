// Backup automático POR LOJA para o Google Drive (conta de serviço), a partir
// de um snapshot de PLATAFORMA que nunca sai daqui sozinho.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { db, getMetaValue, setMetaValue } from './db';
import { getSecret } from './infra/secrets';
import { shopById } from './infra/shops';
import { DATA_DIR } from './paths';
import { config } from './config';
import type { ShopId } from '../contract/shop/types';

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

/**
 * Snapshot da PLATAFORMA: cópia consistente do arquivo SQLite inteiro, com os
 * dados de TODAS as lojas.
 *
 * Existe só como passo intermediário de `runBackup` — nunca sobe para o Drive
 * de ninguém sozinho. `buildShopExport` abre este arquivo e apaga tudo que não
 * é da loja pedida antes de qualquer upload.
 *
 * Usa a Online Backup API do SQLite (via `db.backup`), e não um
 * `fs.copyFile`: copiar o arquivo bruto em modo WAL pode pegar o `.db` sem o
 * conteúdo ainda no `-wal` e gerar um snapshot corrompido.
 */
function platformSnapshotPath(shopId: ShopId): string {
  const backupDir = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  // `loja{shopId}` no nome, e não só o `stamp`: evita que duas lojas fazendo
  // backup no mesmo minuto disputem o mesmo arquivo temporário local.
  return path.join(backupDir, `_plataforma-loja${shopId}-${stamp}.db`);
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

/**
 * As tabelas por-loja são descobertas em runtime (via PRAGMA), não mantidas
 * numa lista à mão: uma tabela nova que ganhe `shop_id` no futuro entra
 * sozinha no export, sem exigir lembrar de atualizar o backup também.
 */
function tabelasComLoja(conexao: Database.Database): string[] {
  const tabelas = conexao
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  return tabelas
    .filter((tabela) =>
      (conexao.prepare(`PRAGMA table_info(${tabela.name})`).all() as { name: string }[]).some(
        (coluna) => coluna.name === 'shop_id'
      )
    )
    .map((tabela) => tabela.name);
}

/**
 * Recorta o snapshot da plataforma para os dados de UMA loja só.
 *
 * Apaga de cada tabela por-loja tudo que não é desta loja, e apaga POR
 * INTEIRO as tabelas que não são de loja nenhuma (`shops`, `server_config`,
 * `platform_admins`, `platform_tokens`, `geo_cache`) — são credenciais e dados
 * do SERVIDOR INTEIRO, não desta loja, e não têm nada a fazer no Drive do dono
 * de um restaurante.
 *
 * ⚠ Sem este recorte, o "backup da loja B" seria literalmente o banco
 * inteiro — pedido, telefone e endereço de cliente da loja A incluídos,
 * entregues para quem nem opera aquela loja.
 */
function buildShopExport(platformSnapshot: string, shopId: ShopId): string {
  const exportPath = platformSnapshot.replace(/\.db$/, '-export.db');
  fs.copyFileSync(platformSnapshot, exportPath);
  const conexao = new Database(exportPath);
  try {
    for (const tabela of tabelasComLoja(conexao)) {
      conexao.prepare(`DELETE FROM ${tabela} WHERE shop_id != ?`).run(shopId);
    }
    // `shops` não tem `shop_id` (ela É a tabela de lojas) — mantém só a
    // própria linha, apaga as outras pelo `id`.
    conexao.prepare('DELETE FROM shops WHERE id != ?').run(shopId);
    // Nenhuma destas é de loja nenhuma: são configuração e credenciais do
    // servidor inteiro (VAPID, admins da plataforma, sessões do painel
    // super-admin) ou um cache global (endereço → coordenadas).
    for (const tabela of ['server_config', 'platform_admins', 'platform_tokens', 'geo_cache']) {
      conexao.exec(`DELETE FROM ${tabela}`);
    }
    // `shop_secrets` tem `shop_id`, então o recorte por loja manteria os DA
    // PRÓPRIA loja — e o arquivo no Drive do dono carregaria o PIN, os tokens
    // da equipe e o access token do Mercado Pago. Backup é de DADOS;
    // credencial se recria no painel (é a promessa da migração 019).
    conexao.exec('DELETE FROM shop_secrets');
    // `driver_tokens` são credenciais de portador VIVAS (e sem prazo): quem
    // pegasse o arquivo do Drive entraria como o motoboy. Mesma razão do
    // shop_secrets — o motoboy refaz o login. E o hash da senha do motoboy sai
    // do JSON: backup é de dados, não de credencial.
    conexao.exec('DELETE FROM driver_tokens');
    conexao.exec("UPDATE drivers SET data = json_remove(data, '$.password')");
    // `sqlite_sequence` guarda os contadores de AUTOINCREMENT — inclusive de
    // `shops`, `platform_admins`, `order_events`. No arquivo do dono de UMA
    // loja isso revelaria quantas lojas e admins a plataforma tem. No restore
    // os contadores se refazem a partir do max(id) das linhas que ficaram.
    conexao.exec("DELETE FROM sqlite_sequence");
    // Sem o VACUUM o arquivo continua do tamanho do banco inteiro: apagar uma
    // linha libera a página, mas não encolhe o arquivo sozinho.
    conexao.exec('VACUUM');
  } finally {
    conexao.close();
  }
  return exportPath;
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
  prefix: string,
  folderId?: string
): Promise<{ id: string; name: string }[]> {
  const q = folderId
    ? `'${folderId}' in parents and trashed=false and name contains '${prefix}'`
    : `name contains '${prefix}' and trashed=false`;
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

const KEEP_LAST = 15;

/** Executa o backup completo de UMA loja (snapshot -> recorte -> upload -> limpeza) e registra o status. */
/**
 * Uma loja por vez. Dois cliques em "rodar backup agora" dentro do mesmo minuto
 * gravavam o MESMO arquivo temporário (o carimbo tem resolução de minuto): um
 * `db.backup()` sobrescrevia o arquivo que o outro estava copiando, e o
 * `finally` de um apagava o arquivo que o outro subia. A trava recusa o segundo
 * enquanto o primeiro roda.
 */
const backupsEmAndamento = new Set<ShopId>();

export async function runBackup(shopId: ShopId): Promise<{ ok: boolean; error?: string }> {
  const shop = shopById(shopId);
  if (!shop) {
    // Não devia acontecer — quem chama isto sempre itera `listShops()` ou usa
    // a loja já resolvida da requisição. Melhor um erro claro aqui do que um
    // `undefined.slug` explodindo lá embaixo, no meio do try.
    return { ok: false, error: 'Loja não encontrada.' };
  }
  // A env var tem prioridade: mantém a credencial fora do próprio banco que ela
  // protege, então perder o disco não derruba junto o acesso ao backup.
  const serviceAccount = config.BACKUP_SERVICE_ACCOUNT || getSecret(shopId, 'backup_service_account');
  if (!serviceAccount) {
    setMetaValue(shopId, 'backup_last_status', 'error:chave não cadastrada');
    return { ok: false, error: 'Chave da conta de serviço não cadastrada.' };
  }
  const folderId = getMetaValue(shopId, 'backup_folder_id') || undefined;

  if (backupsEmAndamento.has(shopId)) {
    return { ok: false, error: 'Um backup desta loja já está em andamento. Aguarde ele terminar.' };
  }
  // Caminhos decididos antes de qualquer chamada que possa falhar, para que o
  // `finally` consiga limpar os dois arquivos temporários mesmo se algo no
  // meio jogar exceção (disco cheio, etc.) — sem isto, uma falha nesse ponto
  // deixava o `.db` parcial no disco de 1 GB para sempre.
  const platformSnapshot = platformSnapshotPath(shopId);
  let shopExport: string | null = null;
  // A trava é adquirida SÓ aqui, depois de `platformSnapshotPath` (que faz
  // mkdir e pode lançar): assim uma falha antes do try não deixa a trava presa.
  backupsEmAndamento.add(shopId);
  try {
    const token = await getDriveAccessToken(serviceAccount);
    await db.backup(platformSnapshot);
    assertValidSnapshot(platformSnapshot);
    shopExport = buildShopExport(platformSnapshot, shopId);
    assertValidSnapshot(shopExport);
    // O nome que sobe para o Drive leva o id da loja num prefixo que o slug
    // não pode conter (`_`): é por ele que a retenção acha os backups DESTA
    // loja sem confundir "loja" com "loja-nova" (os dois começam com "loja-").
    const fileName = `${shop.id}_${shop.slug}-${path.basename(shopExport)}`;
    await uploadToDrive(token, shopExport, fileName, folderId);

    // Retenção: mantém os últimos KEEP_LAST backups DESTA loja. O prefixo
    // carrega o slug de propósito — sem ele, "manter os últimos 15" da loja B
    // apagaria também os backups da loja A guardados na mesma pasta do Drive:
    // nada impede duas lojas apontando para a mesma pasta, e um prefixo fixo
    // (`caldinho-`) não distinguiria uma da outra.
    // O MESMO prefixo com que o arquivo subiu — antes a retenção procurava por
    // `${slug}-` mas o arquivo subia como `_plataforma-loja{id}-...`, então
    // nada casava e NADA era apagado: a pasta crescia para sempre.
    const prefix = `${shop.id}_${shop.slug}-`;
    try {
      const files = await listDriveBackups(token, prefix, folderId);
      const backups = files.filter((f) => f.name.startsWith(prefix) && f.name.endsWith('.db'));
      const toDelete = backups.slice(0, Math.max(0, backups.length - KEEP_LAST));
      for (const f of toDelete) {
        await deleteDriveFile(token, f.id).catch(() => {});
      }
    } catch {
      /* limpeza falhou não impede o backup */
    }

    setMetaValue(shopId, 'backup_last_run', new Date().toISOString());
    setMetaValue(shopId, 'backup_last_status', 'ok');
    setMetaValue(shopId, 'backup_last_file', fileName);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setMetaValue(shopId, 'backup_last_run', new Date().toISOString());
    setMetaValue(shopId, 'backup_last_status', 'error:' + message.slice(0, 300));
    return { ok: false, error: message };
  } finally {
    for (const file of [platformSnapshot, shopExport]) {
      try {
        if (file && fs.existsSync(file)) fs.unlinkSync(file);
      } catch {
        /* ignora */
      }
    }
    // Libera a trava: a próxima chamada desta loja pode rodar.
    backupsEmAndamento.delete(shopId);
  }
}
