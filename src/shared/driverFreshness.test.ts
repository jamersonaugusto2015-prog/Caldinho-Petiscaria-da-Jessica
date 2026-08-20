import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOCATION_STALE_AFTER_MS,
  locationAgeLabel,
  locationFreshness,
  parseTakenAt,
} from './driverFreshness';

const NOW = Date.parse('2026-08-20T12:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

test('ponto sem carimbo é de idade desconhecida, nunca ao vivo', () => {
  assert.equal(locationFreshness(undefined, NOW), 'unknown');
  assert.equal(locationFreshness(null, NOW), 'unknown');
  assert.equal(locationFreshness('', NOW), 'unknown');
  assert.equal(locationFreshness('ontem de manhã', NOW), 'unknown');
});

test('dentro da janela o ponto está ao vivo', () => {
  assert.equal(locationFreshness(iso(0), NOW), 'live');
  assert.equal(locationFreshness(iso(30_000), NOW), 'live');
  assert.equal(locationFreshness(iso(LOCATION_STALE_AFTER_MS), NOW), 'live');
});

test('passada a janela o ponto vira último ponto conhecido', () => {
  assert.equal(locationFreshness(iso(LOCATION_STALE_AFTER_MS + 1), NOW), 'stale');
  assert.equal(locationFreshness(iso(10 * 60_000), NOW), 'stale');
});

test('relógio adiantado do aparelho não fabrica ponto do futuro', () => {
  // O celular do cliente pode estar minutos à frente do servidor: a diferença
  // negativa não pode virar 'stale' nem uma idade negativa na tela.
  assert.equal(locationFreshness(iso(-120_000), NOW), 'live');
  assert.equal(locationAgeLabel(iso(-120_000), NOW), 'agora');
});

test('a idade em palavras usa minutos e depois horas', () => {
  assert.equal(locationAgeLabel(iso(0), NOW), 'agora');
  assert.equal(locationAgeLabel(iso(59_000), NOW), 'agora');
  assert.equal(locationAgeLabel(iso(60_000), NOW), 'há 1 min');
  assert.equal(locationAgeLabel(iso(4 * 60_000), NOW), 'há 4 min');
  assert.equal(locationAgeLabel(iso(59 * 60_000), NOW), 'há 59 min');
  assert.equal(locationAgeLabel(iso(60 * 60_000), NOW), 'há 1 h');
  assert.equal(locationAgeLabel(iso(150 * 60_000), NOW), 'há 2 h');
});

test('sem carimbo não existe idade para mostrar', () => {
  // Devolver "há 0 min" inventaria um frescor que ninguém mediu.
  assert.equal(locationAgeLabel(undefined, NOW), null);
  assert.equal(locationAgeLabel('não é data', NOW), null);
});

test('o carimbo é lido como ISO e só como ISO', () => {
  assert.equal(parseTakenAt(iso(0)), NOW);
  assert.equal(parseTakenAt(undefined), null);
  assert.equal(parseTakenAt('não é data'), null);
});
