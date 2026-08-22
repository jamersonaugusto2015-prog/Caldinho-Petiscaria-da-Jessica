import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAddressLine, isUsableAddress } from './address';

test('isUsableAddress requires street, number and finite coordinates', () => {
  assert.equal(
    isUsableAddress({ street: 'Rua A', number: '10', lat: -8.05, lng: -34.9 }),
    true
  );
});

test('isUsableAddress rejects missing street/number', () => {
  assert.equal(isUsableAddress({ street: '', number: '10', lat: -8.05, lng: -34.9 }), false);
  assert.equal(isUsableAddress({ street: 'Rua A', number: '  ', lat: -8.05, lng: -34.9 }), false);
});

test('isUsableAddress rejects missing or non-finite coordinates', () => {
  assert.equal(isUsableAddress({ street: 'Rua A', number: '10' }), false);
  assert.equal(isUsableAddress({ street: 'Rua A', number: '10', lat: NaN, lng: -34.9 }), false);
});

test('isUsableAddress handles null/undefined input without throwing', () => {
  assert.equal(isUsableAddress(null), false);
  assert.equal(isUsableAddress(undefined), false);
});

test('formatAddressLine combines label/neighborhood with street/number', () => {
  assert.equal(
    formatAddressLine({ label: 'Casa', neighborhood: 'Boa Viagem', street: 'Rua A', number: '10' }),
    'Casa · Boa Viagem — Rua A, 10'
  );
});

test('formatAddressLine falls back to just street/number without label or neighborhood', () => {
  assert.equal(formatAddressLine({ street: 'Rua A', number: '10' }), 'Rua A, 10');
});

test('formatAddressLine returns empty string when there is no street', () => {
  assert.equal(formatAddressLine({ number: '10' }), '');
  assert.equal(formatAddressLine(null), '');
});
