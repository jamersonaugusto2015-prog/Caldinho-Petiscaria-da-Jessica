import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidShopSlug } from './tenant';
import { novaLojaSchema, shopUrl, slugSugerido } from './platform';

test('o endereço sugerido tira acento, espaço e maiúscula', () => {
  assert.equal(slugSugerido('Hamburgueria do Zé'), 'hamburgueria-do-ze');
  assert.equal(slugSugerido('Açaí & Cia.'), 'acai-cia');
  assert.equal(slugSugerido('Pizzaria   do   João'), 'pizzaria-do-joao');
  assert.equal(slugSugerido('  Sorveteria  '), 'sorveteria');
});

test('o endereço sugerido é sempre um subdomínio válido', () => {
  for (const nome of ['Hamburgueria do Zé', 'Açaí & Cia.', 'Café 24h', 'Loja-Teste']) {
    const slug = slugSugerido(nome);
    assert.equal(isValidShopSlug(slug), true, `"${nome}" gerou "${slug}", que não é subdomínio válido`);
  }
});

test('nome que só tem símbolo não gera endereço nenhum', () => {
  // Vazio é a resposta honesta: o painel pede que o dono escreva um.
  assert.equal(slugSugerido('!!!'), '');
  assert.equal(slugSugerido('   '), '');
});

test('sem domínio configurado, a loja não tem endereço — e isso é dito', () => {
  // Um `/?loja=slug` inventado funcionaria só em desenvolvimento, e entregue ao
  // dono da loja seria um link quebrado com cara de link bom.
  assert.equal(shopUrl('pizzaria', undefined), null);
  assert.equal(shopUrl('pizzaria', 'dominio.com.br'), 'https://pizzaria.dominio.com.br');
});

test('endereço reservado pela plataforma é recusado', () => {
  for (const reservado of ['admin', 'api', 'www']) {
    const r = novaLojaSchema.safeParse({ slug: reservado, name: 'Tentativa' });
    assert.equal(r.success, false, `"${reservado}" não pode virar loja`);
  }
});

test('endereço com formato de subdomínio inválido é recusado', () => {
  assert.equal(novaLojaSchema.safeParse({ slug: '-errado', name: 'Loja' }).success, false);
  assert.equal(novaLojaSchema.safeParse({ slug: 'com ponto.', name: 'Loja' }).success, false);
  assert.equal(novaLojaSchema.safeParse({ slug: 'MAIUSCULA', name: 'Loja' }).success, true, 'maiúscula é normalizada, não recusada');
});

test('nome curto demais é recusado', () => {
  assert.equal(novaLojaSchema.safeParse({ slug: 'loja-x', name: 'A' }).success, false);
});
