import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IMAGE_MAX_DIMENSION,
  IMAGE_TARGET_BYTES,
  dataUrlBytes,
  isDataUrlOf,
  pickBestAttempt,
  qualityLadder,
  scaledSize,
} from './imageEncoding';

/** Monta um data URL com um corpo base64 de tamanho conhecido. */
function fakeDataUrl(mime: string, bytes: number): string {
  return `data:${mime};base64,${Buffer.alloc(bytes, 7).toString('base64')}`;
}

test('dataUrlBytes mede os bytes reais, não o tamanho do texto base64', () => {
  // base64 infla ~33%: medir o comprimento da string diria que uma imagem de
  // 150 kB tem 200 kB, e a escada de qualidade desceria um degrau à toa.
  for (const bytes of [1, 2, 3, 1000, 180 * 1024]) {
    assert.equal(dataUrlBytes(fakeDataUrl('image/webp', bytes)), bytes);
  }
  assert.equal(dataUrlBytes('data:image/webp;base64,'), 0);
});

test('isDataUrlOf recusa o formato que o navegador trocou por baixo', () => {
  // Navegador sem WebP devolve PNG calado no lugar do formato pedido.
  assert.equal(isDataUrlOf(fakeDataUrl('image/webp', 10), 'image/webp'), true);
  assert.equal(isDataUrlOf(fakeDataUrl('image/png', 10), 'image/webp'), false);
});

test('a escada do WebP começa mais baixa que a do JPEG e sempre desce', () => {
  const webp = qualityLadder('image/webp');
  const jpeg = qualityLadder('image/jpeg');
  assert.ok(webp[0] < jpeg[0], 'o WebP guarda mais detalhe no mesmo número');
  for (const ladder of [webp, jpeg]) {
    for (let i = 1; i < ladder.length; i++) {
      assert.ok(ladder[i] < ladder[i - 1], 'a escada tem que descer');
    }
  }
  // Formato desconhecido nunca fica sem escada: cairia num loop sem tentativas.
  assert.deepEqual(qualityLadder('image/avif'), jpeg);
});

test('pickBestAttempt para na primeira tentativa que cabe no teto', () => {
  const grande = fakeDataUrl('image/webp', IMAGE_TARGET_BYTES + 1);
  const cabe = fakeDataUrl('image/webp', IMAGE_TARGET_BYTES - 1);
  const menor = fakeDataUrl('image/webp', 1000);
  assert.equal(pickBestAttempt([grande, cabe, menor]), cabe);
});

test('pickBestAttempt devolve a menor quando nenhuma cabe, em vez de recusar', () => {
  // Uma foto muito texturizada pode não caber nem no último degrau. Recusar
  // deixaria o produto sem foto nenhuma, que é pior que uma foto pesada.
  const a = fakeDataUrl('image/webp', IMAGE_TARGET_BYTES + 5000);
  const b = fakeDataUrl('image/webp', IMAGE_TARGET_BYTES + 100);
  assert.equal(pickBestAttempt([a, b]), b);
});

test('pickBestAttempt reclama quando o canvas não produziu nada', () => {
  assert.throws(() => pickBestAttempt([]));
  assert.throws(() => pickBestAttempt(['data:,']));
});

test('scaledSize limita o lado maior e mantém a proporção', () => {
  const largo = scaledSize(4000, 3000);
  assert.equal(largo.width, IMAGE_MAX_DIMENSION);
  assert.equal(largo.height, 750);

  const alto = scaledSize(3000, 4000);
  assert.equal(alto.height, IMAGE_MAX_DIMENSION);
  assert.equal(alto.width, 750);

  // Imagem menor que o teto não é esticada: aumentar só inventaria pixel.
  assert.deepEqual(scaledSize(320, 200), { width: 320, height: 200 });
  // Nunca zero: um canvas de lado 0 quebra o toDataURL.
  assert.deepEqual(scaledSize(1, 1, 0), { width: 1, height: 1 });
});
