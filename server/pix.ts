// Geração de BR Code (PIX "copia e cola") válido com CRC16-CCITT.

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
