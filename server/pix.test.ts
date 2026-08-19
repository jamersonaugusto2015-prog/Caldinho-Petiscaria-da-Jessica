import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePixCopyPaste } from './pix';

// server/pix.ts is a thin re-export of ../src/shared/pix (shared between server
// and the kitchen panel's preview). It never touches the database, so no
// DATA_DIR override is needed here — same as server/payment.test.ts, which
// already imports generatePixCopyPaste as a plain static import.

/** Decodes a BR Code TLV string into { id: value } pairs, in order. */
function parseEmv(payload: string): { id: string; value: string }[] {
  const fields: { id: string; value: string }[] = [];
  let i = 0;
  while (i < payload.length) {
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    const value = payload.slice(i + 4, i + 4 + len);
    fields.push({ id, value });
    i += 4 + len;
  }
  return fields;
}

test('generatePixCopyPaste produces well-formed, ordered EMV fields', () => {
  const payload = generatePixCopyPaste({
    pixKey: 'lojista@example.com',
    amount: 25.5,
    merchantName: 'Caldinho da Jessica',
    merchantCity: 'Recife',
    txid: 'CX-1234',
  });
  const fields = parseEmv(payload);
  const byId = Object.fromEntries(fields.map((f) => [f.id, f.value]));

  assert.equal(byId['00'], '01', 'payload format indicator');
  assert.match(byId['26'], /^0014br\.gov\.bcb\.pix0119lojista@example\.com$/);
  assert.equal(byId['52'], '0000', 'merchant category code');
  assert.equal(byId['53'], '986', 'BRL currency code');
  assert.equal(byId['54'], '25.50', 'transaction amount');
  assert.equal(byId['58'], 'BR');
  assert.equal(byId['59'], 'CALDINHO DA JESSICA');
  assert.equal(byId['60'], 'RECIFE');
  assert.equal(byId['62'], '0507CX-1234', 'txid subfield 05');
  assert.match(byId['63'], /^[0-9A-F]{4}$/, 'CRC is 4 uppercase hex digits');

  // Ascending tag order end-to-end, as EMV/Bacen readers expect.
  const ids = fields.map((f) => f.id);
  assert.deepEqual(ids, ['00', '26', '52', '53', '54', '58', '59', '60', '62', '63']);

  // The whole string must fully decode with nothing left over.
  const consumed = fields.reduce((sum, f) => sum + 4 + f.value.length, 0);
  assert.equal(consumed, payload.length);
});

test('merchant name and city are stripped to ASCII, uppercased and length-capped', () => {
  // Bacen requires ASCII only, merchant name <=25 chars, city <=15 chars.
  const payload = generatePixCopyPaste({
    pixKey: '11999998888',
    amount: 10,
    merchantName: 'Restaurante Caldinho & Petiscos da Jéssica Ltda',
    merchantCity: 'São Lourenço da Mata',
  });
  const fields = parseEmv(payload);
  const byId = Object.fromEntries(fields.map((f) => [f.id, f.value]));

  assert.ok(byId['59'].length <= 25, `merchant name too long: ${byId['59'].length}`);
  assert.ok(byId['60'].length <= 15, `merchant city too long: ${byId['60'].length}`);
  assert.doesNotMatch(byId['59'], /[^\x20-\x7E]/, 'merchant name must be ASCII');
  assert.doesNotMatch(byId['60'], /[^\x20-\x7E]/, 'merchant city must be ASCII');
  // Accents dropped, not mangled into '?' or replaced with garbage.
  assert.equal(byId['60'], 'SAO LOURENCO DA');
});

test('missing txid falls back to the Bacen "no reference" placeholder', () => {
  const payload = generatePixCopyPaste({
    pixKey: 'lojista@example.com',
    amount: 1,
    merchantName: 'Loja',
    merchantCity: 'Recife',
  });
  const byId = Object.fromEntries(parseEmv(payload).map((f) => [f.id, f.value]));
  assert.equal(byId['62'], '0503***');
});

test('a long txid is capped to the 25-char reference-label limit', () => {
  const payload = generatePixCopyPaste({
    pixKey: 'lojista@example.com',
    amount: 1,
    merchantName: 'Loja',
    merchantCity: 'Recife',
    txid: 'CX-'.padEnd(40, '9'),
  });
  const byId = Object.fromEntries(parseEmv(payload).map((f) => [f.id, f.value]));
  const [, txidValue] = [byId['62'].slice(0, 4), byId['62'].slice(4)];
  assert.ok(txidValue.length <= 25, `txid too long: ${txidValue.length}`);
});


// O CRC do BR Code cobre o payload inteiro incluindo o "6304" do próprio
// campo 63: só os 4 dígitos do CRC ficam de fora. Calculado errado, o código
// passa na validação interna e mesmo assim é recusado pelos apps de banco.
test('CRC16 covers the "6304" tag+length prefix of its own field (Bacen spec)', () => {
  const payload = generatePixCopyPaste({
    pixKey: 'lojista@example.com',
    amount: 25.5,
    merchantName: 'Loja',
    merchantCity: 'Recife',
    txid: 'CX-1234',
  });
  const withoutCrcValue = payload.slice(0, -4); // includes the literal "6304"
  const claimedCrc = payload.slice(-4);

  // Re-implement the spec-correct CRC16/CCITT-FALSE (poly 0x1021, init 0xFFFF)
  // independently, to avoid re-testing the buggy implementation against itself.
  function crc16(text: string): string {
    let crc = 0xffff;
    for (let i = 0; i < text.length; i++) {
      crc ^= text.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  assert.equal(claimedCrc, crc16(withoutCrcValue));
});
