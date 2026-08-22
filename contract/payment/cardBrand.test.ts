import assert from 'node:assert/strict';
import test from 'node:test';
import { BRAND_FACE, detectBrand, formatExpiry, formatNumber, onlyDigits } from './cardBrand';

test('detectBrand recognizes Visa BINs', () => {
  assert.equal(detectBrand('4111111111111111'), 'visa');
  assert.equal(detectBrand('4000000000000002'), 'visa');
});

test('detectBrand recognizes Amex BINs', () => {
  assert.equal(detectBrand('378282246310005'), 'amex');
  assert.equal(detectBrand('371449635398431'), 'amex');
});

test('detectBrand recognizes Elo BINs that do not start with 4', () => {
  assert.equal(detectBrand('6362970000457013'), 'elo');
  assert.equal(detectBrand('5090000000000000'), 'elo');
  assert.equal(detectBrand('6550000000000000'), 'elo');
});

test('Elo BINs that start with 4 beat the broader Visa range', () => {
  assert.equal(detectBrand('4011000000000000'), 'elo');
  assert.equal(detectBrand('4312000000000000'), 'elo');
  assert.equal(detectBrand('4389000000000000'), 'elo');
  assert.equal(detectBrand('4514000000000000'), 'elo');
  assert.equal(detectBrand('4576000000000000'), 'elo');
});

test('Hipercard BINs that start with 3 beat the broader Amex range', () => {
  assert.equal(detectBrand('384100000000000'), 'hipercard');
  assert.equal(detectBrand('371449635398431'), 'amex');
});

test('detectBrand recognizes Hipercard BINs', () => {
  assert.equal(detectBrand('606282000000000'), 'hipercard');
  assert.equal(detectBrand('384100000000000'), 'hipercard');
});

test('detectBrand recognizes Mastercard BINs', () => {
  assert.equal(detectBrand('5555555555554444'), 'master');
  assert.equal(detectBrand('2221000000000009'), 'master');
  assert.equal(detectBrand('2720000000000000'), 'master');
});

test('detectBrand falls back to unknown', () => {
  assert.equal(detectBrand('1234567890123456'), 'unknown');
  assert.equal(detectBrand(''), 'unknown');
});

test('onlyDigits strips every non-digit character', () => {
  assert.equal(onlyDigits('4111 1111-1111.1111'), '4111111111111111');
  assert.equal(onlyDigits('abc'), '');
});

test('formatNumber groups digits in 4s for non-Amex brands', () => {
  assert.equal(formatNumber('4111111111111111', 'visa'), '4111 1111 1111 1111');
  assert.equal(formatNumber('5555555555554444', 'master'), '5555 5555 5555 4444');
  assert.equal(formatNumber('1234', 'unknown'), '1234');
});

test('formatNumber groups Amex as 4-6-5', () => {
  assert.equal(formatNumber('378282246310005', 'amex'), '3782 822463 10005');
  assert.equal(formatNumber('37828', 'amex'), '3782 8');
});

test('formatExpiry keeps the month alone until a third digit arrives', () => {
  assert.equal(formatExpiry(''), '');
  assert.equal(formatExpiry('1'), '1');
  assert.equal(formatExpiry('12'), '12');
  assert.equal(formatExpiry('123'), '12/3');
  assert.equal(formatExpiry('1225'), '12/25');
});

test('BRAND_FACE has a face for every detectable brand', () => {
  const brands: (keyof typeof BRAND_FACE)[] = ['visa', 'master', 'amex', 'elo', 'hipercard', 'unknown'];
  for (const brand of brands) {
    assert.ok(BRAND_FACE[brand].label.length > 0);
  }
});
