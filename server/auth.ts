import { randomBytes, scrypt as scryptCallback, scryptSync, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scryptCallback);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = ((await scryptAsync(password, salt, 64)) as Buffer).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    // credencial legada em texto claro (migração)
    return stored === password;
  }
  const [, salt, hash] = parts;
  const calc = ((await scryptAsync(password, salt, 64)) as Buffer).toString('hex');
  const calcBuf = Buffer.from(calc, 'hex');
  const storedBuf = Buffer.from(hash, 'hex');
  if (calcBuf.length !== storedBuf.length) return false;
  return timingSafeEqual(calcBuf, storedBuf);
}

/**
 * Variante síncrona usada só na inicialização (seed/migração em db.ts e no reset
 * de emergência do PIN em index.ts), antes do servidor aceitar conexões — nesse
 * momento não há requisições concorrentes para o event loop bloquear.
 */
export function hashPasswordSync(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}
