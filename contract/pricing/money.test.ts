import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatCents,
  formatMoney,
  percentOf,
  roundMoney,
  toApiAmount,
  toCents,
  toReais,
} from './money';

test('reais viram centavos inteiros', () => {
  assert.equal(toCents(25.5), 2550);
  assert.equal(toCents(0), 0);
  assert.equal(toCents(18), 1800);
});

test('o caso clássico do ponto flutuante não perde um centavo', () => {
  // 1.005 * 100 dá 100.49999999999999 em JavaScript. Sem correção,
  // Math.round devolveria 100 — um centavo a menos, todo dia, para sempre.
  assert.equal(toCents(1.005), 101);
  assert.equal(toCents(8.165), 817);
  assert.equal(toCents(1.015), 102);
});

test('somar em centavos não acumula erro', () => {
  const total = toCents(0.1) + toCents(0.2);
  assert.equal(total, 30);
  assert.equal(toReais(total), 0.3);
  // O mesmo cálculo em ponto flutuante erra:
  assert.notEqual(0.1 + 0.2, 0.3);
});

test('valor inválido vira zero em vez de NaN se espalhando pelo pedido', () => {
  assert.equal(toCents(Number.NaN), 0);
  assert.equal(toCents(Number.POSITIVE_INFINITY), 0);
});

test('valor negativo (estorno) arredonda para o mesmo lado', () => {
  assert.equal(toCents(-1.005), -101);
  assert.equal(toReais(-101), -1.01);
});

test('roundMoney dá o mesmo resultado do caminho dos centavos', () => {
  assert.equal(roundMoney(1.005), 1.01);
  assert.equal(roundMoney(25.499), 25.5);
  assert.equal(roundMoney(10), 10);
});

test('percentual é calculado sobre centavos e arredondado uma vez só', () => {
  assert.equal(percentOf(1800, 50), 900);
  assert.equal(percentOf(3333, 10), 333);
  // 10% de R$ 1,15 = 11,5 centavos -> 12, não 11
  assert.equal(percentOf(115, 10), 12);
  assert.equal(percentOf(1000, Number.NaN), 0);
});

test('o formatador escreve como se escreve no Brasil', () => {
  // As seis cópias antigas faziam `R$ ${v.toFixed(2)}` e escreviam "R$ 25.50".
  assert.equal(formatMoney(25.5).replace(/ /g, ' '), 'R$ 25,50');
  assert.equal(formatMoney(1000).replace(/ /g, ' '), 'R$ 1.000,00');
  assert.equal(formatCents(2550).replace(/ /g, ' '), 'R$ 25,50');
  assert.equal(formatMoney(Number.NaN).replace(/ /g, ' '), 'R$ 0,00');
});

test('o valor mandado para a API de pagamento tem no máximo dois decimais', () => {
  assert.equal(toApiAmount(25.499999), 25.5);
  assert.equal(toApiAmount(1.005), 1.01);
  assert.equal(String(toApiAmount(10)), '10');
});
