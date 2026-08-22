import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidShopSlug, slugFromHost } from './tenant';
import { customerRoom, driverRoom, driversRoom, kitchenRoom } from './rooms';

test('o subdomínio vira o rótulo da loja', () => {
  assert.equal(slugFromHost('loja-a.dominio.com.br'), 'loja-a');
  assert.equal(slugFromHost('pizzaria.dominio.com'), 'pizzaria');
});

test('a porta e as maiúsculas do Host não entram no rótulo', () => {
  assert.equal(slugFromHost('Loja-A.Dominio.Com.BR:3000'), 'loja-a');
});

test('o domínio raiz não é loja nenhuma: é a plataforma', () => {
  assert.equal(slugFromHost('dominio.com.br', 'dominio.com.br'), null);
  assert.equal(slugFromHost('www.dominio.com.br'), null);
});

test('localhost e IP não têm subdomínio', () => {
  assert.equal(slugFromHost('localhost'), null);
  assert.equal(slugFromHost('localhost:3000'), null);
  // Sem isto, `192.168.0.10` viraria uma loja chamada "192".
  assert.equal(slugFromHost('192.168.0.10'), null);
  assert.equal(slugFromHost('192.168.0.10:3001'), null);
});

test('Host vazio ou ausente não resolve loja', () => {
  assert.equal(slugFromHost(undefined), null);
  assert.equal(slugFromHost(''), null);
  assert.equal(slugFromHost('   '), null);
});

test('o ponto final de um nome plenamente qualificado não muda a loja', () => {
  assert.equal(slugFromHost('loja-a.dominio.com.br.', 'dominio.com.br'), 'loja-a');
  assert.equal(slugFromHost('dominio.com.br.', 'dominio.com.br'), null);
  // Sem domínio-base, o raiz com ponto final também não vira a loja "dominio".
  assert.equal(slugFromHost('dominio.com.br.'), 'dominio');
});

test('com domínio-base configurado, host de fora não vira loja', () => {
  assert.equal(slugFromHost('loja-a.dominio.com.br', 'dominio.com.br'), 'loja-a');
  // Um atacante apontando `dominio.com.br.malicioso.com` para cá não pode
  // virar a loja "dominio".
  assert.equal(slugFromHost('dominio.com.br.malicioso.com', 'dominio.com.br'), null);
  assert.equal(slugFromHost('a.b.dominio.com.br', 'dominio.com.br'), null);
});

test('o rótulo aceitável é o de um subdomínio de verdade', () => {
  assert.equal(isValidShopSlug('loja-a'), true);
  assert.equal(isValidShopSlug('pizzaria123'), true);
  assert.equal(isValidShopSlug('-comeca-com-hifen'), false);
  assert.equal(isValidShopSlug('termina-com-hifen-'), false);
  assert.equal(isValidShopSlug('MAIUSCULA'), false);
  assert.equal(isValidShopSlug('com ponto.'), false);
  assert.equal(isValidShopSlug(''), false);
  assert.equal(isValidShopSlug('a'.repeat(64)), false);
});

test('as salas carregam a loja, e duas lojas nunca produzem a mesma', () => {
  assert.equal(kitchenRoom(1), 'shop:1:kitchen');
  assert.equal(driversRoom(2), 'shop:2:drivers');
  assert.equal(driverRoom(1, 'drv-9'), 'shop:1:driver:drv-9');
  assert.equal(customerRoom(1, 'cli-9'), 'shop:1:customer:cli-9');

  assert.notEqual(kitchenRoom(1), kitchenRoom(2));
  // O MESMO aparelho pede nas duas lojas: sem o prefixo, o pedido de uma
  // apareceria no acompanhamento da outra.
  assert.notEqual(customerRoom(1, 'cli-9'), customerRoom(2, 'cli-9'));
});

test('www é o site, não uma loja — com ou sem domínio-base', () => {
  assert.equal(slugFromHost('www.dominio.com.br'), null);
  assert.equal(slugFromHost('www.dominio.com.br', 'dominio.com.br'), null);
});
