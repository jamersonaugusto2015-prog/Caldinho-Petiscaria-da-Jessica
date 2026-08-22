import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConfig } from './config';

test('um ambiente vazio ainda sobe, com os padrões', () => {
  const config = buildConfig({});
  assert.equal(config.PORT, 3001);
  assert.equal(config.NODE_ENV, 'development');
  assert.equal(config.isProduction, false);
  assert.equal(config.corsOrigins, true, 'sem CORS_ORIGIN, todas as origens passam');
  assert.equal(config.MP_CLIENT_ID, undefined);
});

test('as aspas que o painel de deploy gruda no valor são removidas', () => {
  const config = buildConfig({ MP_REDIRECT_URI: '"https://loja.com/api/mercadopago/callback"' });
  assert.equal(config.MP_REDIRECT_URI, 'https://loja.com/api/mercadopago/callback');
});

test('espaços em volta do valor não viram parte dele', () => {
  assert.equal(buildConfig({ APP_URL: '  https://loja.com  ' }).APP_URL, 'https://loja.com');
});

test('variável vazia é o mesmo que variável ausente', () => {
  const config = buildConfig({ MP_ACCESS_TOKEN: '', VAPID_PUBLIC_KEY: '   ' });
  assert.equal(config.MP_ACCESS_TOKEN, undefined);
  assert.equal(config.VAPID_PUBLIC_KEY, undefined);
});

test('CORS_ORIGIN vira lista sem espaços', () => {
  assert.deepEqual(buildConfig({ CORS_ORIGIN: 'https://a.com, https://b.com' }).corsOrigins, [
    'https://a.com',
    'https://b.com',
  ]);
});

test('MP_TEST aceita true/false e nada mais vira undefined', () => {
  assert.equal(buildConfig({ MP_TEST: 'true' }).MP_TEST, true);
  assert.equal(buildConfig({ MP_TEST: 'FALSE' }).MP_TEST, false);
  assert.equal(buildConfig({ MP_TEST: 'talvez' }).MP_TEST, undefined);
  assert.equal(buildConfig({}).MP_TEST, undefined);
});

test('PORT que não é número derruba o boot em vez de virar 3001 em silêncio', () => {
  assert.throws(() => buildConfig({ PORT: 'oitenta' }), /PORT/);
  assert.throws(() => buildConfig({ PORT: '99999' }), /PORT/);
});

test('PIN de reset curto demais é recusado no boot, não ignorado', () => {
  // Antes, um valor de 3 caracteres era descartado sem aviso e o dono ficava
  // tentando entrar com um PIN que nunca chegou a ser gravado.
  assert.throws(() => buildConfig({ KITCHEN_PIN_RESET: '123' }), /KITCHEN_PIN_RESET/);
  assert.equal(buildConfig({ KITCHEN_PIN_RESET: '4321' }).KITCHEN_PIN_RESET, '4321');
});

test('NODE_ENV=production liga isProduction', () => {
  assert.equal(buildConfig({ NODE_ENV: 'production' }).isProduction, true);
});

test('DATA_DIR relativo vira caminho absoluto', () => {
  const config = buildConfig({ DATA_DIR: './dados' }, '/app/server');
  assert.ok(config.dataDir.startsWith('/'), `esperava caminho absoluto, veio ${config.dataDir}`);
  assert.ok(config.uploadsDir.endsWith('/uploads'));
});

test('sem DATA_DIR, os dados ficam ao lado do código', () => {
  assert.equal(buildConfig({}, '/app/server').dataDir, '/app/data');
});
