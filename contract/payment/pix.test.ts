import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generatePixCopyPaste,
  generateRandomPixKey,
  normalizePixKey,
  normalizePixProvider,
  usesLocalPix,
  validatePixKey,
} from './pix';

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
    // Chave de celular sai com o DDI (+55) e o txid perde o hífen: as duas
    // coisas que faziam o app do banco recusar o QR Code como inválido.
    '00020101021126360014br.gov.bcb.pix0114+5581999990000520400005303986540525.505802BR5916CALDINHO EXPRESS6006RECIFE62100506CX12346304F201'
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

test('normalizePixKey devolve a chave aleatória como UUID minúsculo com hífens', () => {
  // O DICT guarda a EVP nesse formato. Os 32 dígitos colados, ou em
  // maiúsculas, viram uma chave que o banco não encontra.
  assert.equal(
    normalizePixKey('ABCD1234ABCD1234ABCD1234ABCD1234'),
    'abcd1234-abcd-1234-abcd-1234abcd1234'
  );
  assert.equal(
    normalizePixKey('abcd1234-abcd-1234-abcd-1234abcd1234'),
    'abcd1234-abcd-1234-abcd-1234abcd1234'
  );
});

test('normalizePixKey separa celular de CPF pelos dígitos verificadores', () => {
  // Os dois têm 11 dígitos. Só o DV do CPF distingue, e errar aqui põe uma
  // chave inexistente dentro do QR Code.
  assert.equal(normalizePixKey('81999990000'), '+5581999990000');
  assert.equal(normalizePixKey('(81) 99999-0000'), '+5581999990000');
  assert.equal(normalizePixKey('123.456.789-09'), '12345678909');
  assert.equal(normalizePixKey('5581999990000'), '+5581999990000');
});

test('o txid do BR Code fica só com letras e números', () => {
  // O id de pedido tem hífen ("CX-1234") e o Bacen só aceita [A-Za-z0-9] no
  // campo 62-05: com o hífen, o app do banco recusa o payload inteiro.
  const out = generatePixCopyPaste({
    pixKey: 'lojista@example.com',
    amount: 5,
    merchantName: 'Loja',
    merchantCity: 'Recife',
    txid: 'CX-12/34 ab',
  });
  assert.ok(out.includes('0508CX1234ab'), out);
});

test('o BR Code declara o método de iniciação estático (campo 01 = 11)', () => {
  const out = generatePixCopyPaste({
    pixKey: 'lojista@example.com',
    amount: 5,
    merchantName: 'Loja',
    merchantCity: 'Recife',
  });
  assert.ok(out.startsWith('000201010211'), out.slice(0, 20));
});

test('validatePixKey accepts CPF, CNPJ, e-mail, phone and random keys', () => {
  assert.equal(validatePixKey('123.456.789-09'), null);
  assert.equal(validatePixKey('12.345.678/0001-95'), null);
  assert.equal(validatePixKey('user@example.com'), null);
  assert.equal(validatePixKey('+5581999990000'), null);
  assert.equal(validatePixKey('abcd1234abcd1234abcd1234abcd1234'), null);
  assert.equal(validatePixKey('7f3d9a2b-1c4e-4f8a-9b2d-6e5c1a0f3d77'), null); // EVP real (UUID)
  assert.equal(validatePixKey('81999990000'), null); // celular sem DDI
  assert.equal(validatePixKey(''), null); // empty is allowed (PIX manual is optional)
});

test('validatePixKey rejects an unrecognized format', () => {
  assert.notEqual(validatePixKey('not-a-real-key'), null);
});

test('generateRandomPixKey devolve um UUID v4, o formato real de uma chave aleatória', () => {
  const key = generateRandomPixKey();
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(validatePixKey(key), null);
  assert.equal(normalizePixKey(key), key);
});

test('normalizePixProvider só aceita "local"; o resto volta para o Mercado Pago', () => {
  assert.equal(normalizePixProvider('local'), 'local');
  assert.equal(normalizePixProvider('mercadopago'), 'mercadopago');
  // Config antiga (campo inexistente) e lixo digitado não podem desligar o
  // Mercado Pago sem a loja pedir.
  assert.equal(normalizePixProvider(undefined), 'mercadopago');
  assert.equal(normalizePixProvider(''), 'mercadopago');
  assert.equal(normalizePixProvider('LOCAL'), 'mercadopago');
  assert.equal(usesLocalPix('local'), true);
  assert.equal(usesLocalPix(undefined), false);
});
