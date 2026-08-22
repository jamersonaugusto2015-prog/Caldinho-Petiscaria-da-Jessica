import { randomBytes, createHash } from 'crypto';
import { db } from '../../db';
import { DomainError } from '../../errors';
import { hashPassword, verifyPassword } from '../../auth';

/**
 * Os administradores da PLATAFORMA — quem cria e desativa lojas.
 *
 * A credencial é separada da das lojas de propósito. Um token de cozinha, por
 * mais privilegiado que seja dentro da própria loja, não pode criar loja
 * nenhuma nem enxergar outra. Se o papel de plataforma vivesse dentro do espaço
 * da loja, ele seria alcançável a partir dela.
 */

export interface PlatformAdmin {
  id: number;
  email: string;
  name: string;
  active: boolean;
  createdAt: string;
}

/** Quanto tempo uma sessão de plataforma dura. */
const SESSAO_DIAS = 7;

type LinhaAdmin = {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  active: number;
  created_at: string;
};

function paraAdmin(linha: LinhaAdmin): PlatformAdmin {
  return {
    id: linha.id,
    email: linha.email,
    name: linha.name,
    active: linha.active === 1,
    createdAt: linha.created_at,
  };
}

export async function createPlatformAdmin(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<PlatformAdmin> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes('@')) throw new DomainError(400, 'Informe um e-mail válido.');
  // Senha de plataforma abre TODAS as lojas: o mínimo aqui é maior que o de um
  // PIN de cozinha, que só abre uma.
  if (input.password.length < 10) {
    throw new DomainError(400, 'A senha do administrador precisa ter pelo menos 10 caracteres.');
  }

  const hash = await hashPassword(input.password);
  try {
    const info = db
      .prepare(
        'INSERT INTO platform_admins (email, password_hash, name, active, created_at) VALUES (?, ?, ?, 1, ?)'
      )
      .run(email, hash, input.name?.trim() || '', new Date().toISOString());
    return paraAdmin(
      db.prepare('SELECT * FROM platform_admins WHERE id = ?').get(info.lastInsertRowid) as LinhaAdmin
    );
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      throw new DomainError(409, 'Já existe um administrador com este e-mail.');
    }
    throw err;
  }
}

export function countPlatformAdmins(): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM platform_admins').get() as { c: number }).c;
}

/**
 * Confere a senha e abre uma sessão.
 *
 * Devolve `null` para e-mail inexistente E para senha errada — a mesma resposta
 * nos dois casos. Distinguir os dois diria a um atacante quais e-mails existem
 * na plataforma.
 */
export async function loginPlatformAdmin(
  email: string,
  password: string
): Promise<{ token: string; admin: PlatformAdmin } | null> {
  pruneExpiredPlatformTokens();

  const linha = db
    .prepare('SELECT * FROM platform_admins WHERE email = ? COLLATE NOCASE')
    .get(email.trim()) as LinhaAdmin | undefined;
  if (!linha || linha.active !== 1) return null;
  if (!(await verifyPassword(password, linha.password_hash))) return null;

  const token = `plt-${randomBytes(32).toString('hex')}`;
  const agora = Date.now();
  db.prepare(
    'INSERT INTO platform_tokens (token, admin_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(
    // Guarda o HASH, nunca o portador: um dump do banco não pode virar sessão
    // de super-admin. O cliente recebe o token cru uma vez (abaixo).
    hashToken(token),
    linha.id,
    new Date(agora).toISOString(),
    new Date(agora + SESSAO_DIAS * 24 * 3600 * 1000).toISOString()
  );
  return { token, admin: paraAdmin(linha) };
}

/** O dono do token, ou `null`. Sessão vencida ou admin desativado não resolve. */
export function platformAdminFromToken(token: string): PlatformAdmin | null {
  if (!token) return null;
  const linha = db
    .prepare(
      `SELECT a.* FROM platform_tokens t
       JOIN platform_admins a ON a.id = t.admin_id
       WHERE t.token = ? AND t.expires_at > ? AND a.active = 1`
    )
    .get(hashToken(token), new Date().toISOString()) as LinhaAdmin | undefined;
  return linha ? paraAdmin(linha) : null;
}

export function revokePlatformToken(token: string): void {
  if (token) db.prepare('DELETE FROM platform_tokens WHERE token = ?').run(hashToken(token));
}

/** O que fica gravado: o SHA-256 do token, nunca o token. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Apaga as sessões vencidas. Chamado no login: é o momento em que a tabela
 * cresce, e um `setInterval` só para isto seria um temporizador a mais para
 * pouca coisa.
 */
export function pruneExpiredPlatformTokens(): void {
  db.prepare('DELETE FROM platform_tokens WHERE expires_at <= ?').run(new Date().toISOString());
}
