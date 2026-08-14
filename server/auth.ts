import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored) return false;
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    // credencial legada em texto claro (migração)
    return stored === password;
  }
  const [, salt, hash] = parts;
  const calc = scryptSync(password, salt, 64).toString('hex');
  return timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(hash, 'hex'));
}
