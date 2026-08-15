// Geração de BR Code (PIX "copia e cola") válido com CRC16-CCITT.
// Compartilhado entre servidor (criação de pedidos) e painel (pré-visualização).

function emvField(id: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return `${id}${len}${value}`;
}

function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function sanitize(value: string, max: number): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .toUpperCase()
    .slice(0, max);
}

export interface PixPayloadOptions {
  pixKey: string;
  amount: number;
  merchantName: string;
  merchantCity: string;
  txid?: string;
}

export function generatePixCopyPaste(opts: PixPayloadOptions): string {
  const key = opts.pixKey.trim();
  const gui = emvField('00', 'br.gov.bcb.pix');
  const keyField = emvField('01', key);
  const mai = emvField('26', gui + keyField);
  const txid = emvField('62', emvField('05', (opts.txid || '***').slice(0, 25)));
  const payload =
    emvField('00', '01') +
    mai +
    emvField('52', '0000') +
    emvField('53', '986') +
    emvField('54', opts.amount.toFixed(2)) +
    emvField('58', 'BR') +
    emvField('59', sanitize(opts.merchantName || 'LOJA', 25)) +
    emvField('60', sanitize(opts.merchantCity || 'BRASIL', 15)) +
    txid;
  return payload + emvField('63', crc16(payload));
}

/** Valida o formato da chave PIX. Retorna mensagem de erro ou null se OK. */
export function validatePixKey(key: string): string | null {
  const k = key.trim();
  if (!k) return null;
  const digits = k.replace(/\D/g, '');
  const isCpf = /^\d{11}$/.test(digits) && digits.length === 11;
  const isCnpj = /^\d{14}$/.test(digits) && digits.length === 14;
  const isPhone = /^\d{15}$/.test(digits) && digits.length === 15;
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k);
  const isEvp = /^[0-9a-fA-F]{32}$/.test(k);
  if (isCpf || isCnpj || isPhone || isEmail || isEvp) return null;
  return 'Formato de chave PIX incomum. Confira: CPF (11 dígitos), CNPJ (14), telefone com DDD e DDI (ex: +5581999990000), e-mail ou chave aleatória (32 caracteres).';
}

/** Gera uma chave PIX aleatória (EVP) válida de 32 caracteres. */
export function generateRandomPixKey(): string {
  const chars = '0123456789ABCDEF';
  let out = '';
  const arr = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < 32; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < 32; i++) out += chars[arr[i] % 16];
  return out;
}
