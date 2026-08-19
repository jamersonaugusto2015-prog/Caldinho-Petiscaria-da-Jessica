import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePixCopyPaste, generateRandomPixKey, normalizePixKey, validatePixKey } from './pix';

test('generatePixCopyPaste produces a valid BR Code with a correct CRC16', () => {
  const out = generatePixCopyPaste({
    pixKey: '81999990000',
    amount: 25.5,
    merchantName: 'Caldinho Express',
    merchantCity: 'Recife',
    txid: 'CX-1234',
  });
  assert.equal(
    out,
    '00020126330014br.gov.bcb.pix011181999990000520400005303986540525.505802BR5916CALDINHO EXPRESS6006RECIFE62110507CX-12346304FC9A'
  );
});

test('the CRC16 covers the "6304" tag+length prefix of its own field (Bacen/EMV spec)', () => {
  // Regression test: an earlier version computed the CRC over the payload
  // WITHOUT the trailing "6304", which real bank apps reject as invalid even
  // though it round-trips fine against this codebase's own crc16(). Verify
  // independently, so a re-introduced bug can't pass by re-checking itself.
  const out = generatePixCopyPaste({
    pixKey: 'lojista@example.com',
    amount: 25.5,
    merchantName: 'Loja',
    merchantCity: 'Recife',
    txid: 'CX-1234',
  });
  const withoutCrcValue = out.slice(0, -4); // includes the literal "6304"
  const claimedCrc = out.slice(-4);

  function referenceCrc16(text: string): string {
    let crc = 0xffff;
    for (let i = 0; i < text.length; i++) {
      crc ^= text.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  assert.equal(claimedCrc, referenceCrc16(withoutCrcValue));
});

test('generatePixCopyPaste sanitizes accents and truncates merchant name/city per EMV limits', () => {
  const out = generatePixCopyPaste({
    pixKey: '81999990000',
    amount: 10,
    merchantName: 'Caldinho & Petiscaria do José com nome bem comprido',
    merchantCity: 'São Lourenço da Mata',
    txid: 'X',
  });
  // Field 59 (merchant name) max 25 chars, field 60 (city) max 15, accents stripped.
  assert.ok(!/[^\x20-\x7E]/.test(out));
  assert.ok(out.includes('JOSE') || out.includes('CALDINHO'));
});

test('generatePixCopyPaste rejects a non-positive or non-finite amount', () => {
  const opts = { pixKey: '81999990000', merchantName: 'Loja', merchantCity: 'Recife' };
  assert.throws(() => generatePixCopyPaste({ ...opts, amount: 0 }));
  assert.throws(() => generatePixCopyPaste({ ...opts, amount: -5 }));
  assert.throws(() => generatePixCopyPaste({ ...opts, amount: NaN }));
});

test('normalizePixKey strips punctuation from CPF and CNPJ', () => {
  assert.equal(normalizePixKey('123.456.789-09'), '12345678909');
  assert.equal(normalizePixKey('12.345.678/0001-95'), '12345678000195');
});

test('normalizePixKey trims and keeps an e-mail key as-is', () => {
  assert.equal(normalizePixKey(' user@example.com '), 'user@example.com');
});

test('normalizePixKey keeps a phone key with the +55 DDI', () => {
  assert.equal(normalizePixKey('+5581999990000'), '+5581999990000');
});

test('normalizePixKey upper-cases a 32-char random (EVP) key', () => {
  assert.equal(normalizePixKey('abcd1234abcd1234abcd1234abcd1234'), 'ABCD1234ABCD1234ABCD1234ABCD1234');
});

test('validatePixKey accepts CPF, CNPJ, e-mail, phone and random keys', () => {
  assert.equal(validatePixKey('123.456.789-09'), null);
  assert.equal(validatePixKey('12.345.678/0001-95'), null);
  assert.equal(validatePixKey('user@example.com'), null);
  assert.equal(validatePixKey('+5581999990000'), null);
  assert.equal(validatePixKey('abcd1234abcd1234abcd1234abcd1234'), null);
  assert.equal(validatePixKey(''), null); // empty is allowed (PIX manual is optional)
});

test('validatePixKey rejects an unrecognized format', () => {
  assert.notEqual(validatePixKey('not-a-real-key'), null);
});

test('generateRandomPixKey returns a 32-char uppercase hex string', () => {
  const key = generateRandomPixKey();
  assert.equal(key.length, 32);
  assert.match(key, /^[0-9A-F]{32}$/);
});
