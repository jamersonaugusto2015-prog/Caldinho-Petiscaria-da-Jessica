import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import type { Request, Response } from 'express';

/**
 * O teste do portão de entrada: de onde a loja vem, e de onde ela NUNCA pode vir.
 */

const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'caldinho-tenant-'));
process.env.DATA_DIR = DATA_DIR;

const { db } = await import('../../db');
const { createShop } = await import('../../infra/db/seed/createShop');
const { invalidateShopCache } = await import('../../infra/shops');
const { resolveShop, resolveTenant, currentShop, shopIdOf } = await import('./tenant');
const { config } = await import('../../config');

after(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
});

// O domínio onde as lojas moram. Em produção ele vem do ambiente; aqui é fixo
// para os testes falarem de um mundo concreto.
(config as { SHOP_BASE_DOMAIN?: string }).SHOP_BASE_DOMAIN = 'dominio.com.br';

/** Roda o corpo como se fosse produção, e devolve o mundo ao normal depois. */
function emProducao(corpo: () => void): void {
  const anterior = config.isProduction;
  try {
    (config as { isProduction: boolean }).isProduction = true;
    corpo();
  } finally {
    (config as { isProduction: boolean }).isProduction = anterior;
  }
}

const LOJA_A = createShop(db, { slug: 'loja-a', name: 'Loja A' });
const LOJA_B = createShop(db, { slug: 'loja-b', name: 'Loja B' });
const DESATIVADA = createShop(db, { slug: 'fechada', name: 'Fechada' });
db.prepare('UPDATE shops SET active = 0 WHERE id = ?').run(DESATIVADA);
invalidateShopCache();

function req(headers: Record<string, string>): Request {
  return {
    get: (nome: string) => headers[nome.toLowerCase()],
  } as unknown as Request;
}

function res() {
  const estado: { status?: number; body?: unknown } = {};
  const objeto = {
    status(codigo: number) {
      estado.status = codigo;
      return objeto;
    },
    json(corpo: unknown) {
      estado.body = corpo;
      return objeto;
    },
  };
  return { res: objeto as unknown as Response, estado };
}

// ---------------------------------------------------------------------------

test('o subdomínio decide a loja', () => {
  const a = resolveShop({ host: 'loja-a.dominio.com.br' });
  const b = resolveShop({ host: 'loja-b.dominio.com.br' });
  assert.notEqual(a, 'plataforma');
  assert.equal(a && a !== 'plataforma' ? a.id : null, LOJA_A);
  assert.equal(b && b !== 'plataforma' ? b.id : null, LOJA_B);
});

test('subdomínio que não existe não vira loja nenhuma', () => {
  assert.equal(resolveShop({ host: 'nao-existe.dominio.com.br' }), null);
});

test('rótulo com formato inválido nem chega ao banco', () => {
  assert.equal(resolveShop({ host: '-invalido.dominio.com.br' }), null);
});

test('o domínio raiz é a plataforma, não uma loja', () => {
  // Precisa do domínio-base: `dominio.com.br` tem os mesmos três rótulos de
  // `loja.dominio.com`, e sem ele a heurística leria "dominio" como loja.
  emProducao(() => {
    assert.equal(resolveShop({ host: 'dominio.com.br' }), 'plataforma');
    assert.equal(resolveShop({ host: 'www.dominio.com.br' }), 'plataforma');
  });
});

test('sem SHOP_BASE_DOMAIN a heurística é ambígua em .com.br', () => {
  // Documenta o limite conhecido, e é por isso que o boot avisa quando a
  // variável falta em produção.
  const anterior = config.SHOP_BASE_DOMAIN;
  try {
    (config as { SHOP_BASE_DOMAIN?: string }).SHOP_BASE_DOMAIN = undefined;
    assert.equal(
      resolveShop({ host: 'dominio.com.br' }),
      null,
      'sem domínio-base, o raiz vira uma busca por uma loja chamada "dominio"'
    );
  } finally {
    (config as { SHOP_BASE_DOMAIN?: string }).SHOP_BASE_DOMAIN = anterior;
  }
});

test('o header x-shop-slug funciona em desenvolvimento', () => {
  // Em `npm run dev` o endereço é `localhost:3000`, que não tem subdomínio.
  const b = resolveShop({ host: 'localhost:3000', headerSlug: 'loja-b' });
  assert.equal(b && b !== 'plataforma' ? b.id : null, LOJA_B);
});

test('o header x-shop-slug é IGNORADO em produção', () => {
  // Esta é a regra inteira do multi-tenant: `shopId` não é entrada. Aceitar o
  // header em produção devolveria ao cliente a escolha da loja — e com ela os
  // pedidos, o telefone e o endereço dos clientes de qualquer uma.
  emProducao(() => {
    assert.equal(
      resolveShop({ host: 'dominio.com.br', headerSlug: 'loja-b' }),
      'plataforma',
      'o header não pode escolher a loja em produção'
    );
  });
});

test('o middleware põe req.shop e deixa passar', () => {
  const requisicao = req({ host: 'loja-a.dominio.com.br' });
  const { res: resposta, estado } = res();
  let passou = false;
  resolveTenant(requisicao, resposta, () => {
    passou = true;
  });
  assert.equal(passou, true);
  assert.equal(estado.status, undefined);
  assert.equal(shopIdOf(requisicao), LOJA_A);
  assert.equal(currentShop(requisicao).slug, 'loja-a');
});

test('loja que não existe recebe 404, não erro genérico', () => {
  const { res: resposta, estado } = res();
  let passou = false;
  resolveTenant(req({ host: 'sumiu.dominio.com.br' }), resposta, () => {
    passou = true;
  });
  assert.equal(passou, false, 'nenhuma rota pode rodar sem loja');
  assert.equal(estado.status, 404);
});

test('loja desativada recebe 404 com o motivo certo', () => {
  const { res: resposta, estado } = res();
  let passou = false;
  resolveTenant(req({ host: 'fechada.dominio.com.br' }), resposta, () => {
    passou = true;
  });
  assert.equal(passou, false);
  assert.equal(estado.status, 404);
  assert.match(String((estado.body as { error: string }).error), /desativada/);
});

test('currentShop lança quando o middleware não rodou', () => {
  // Devolver a loja 1 em silêncio aqui seria como uma loja passa a servir os
  // dados da outra sem ninguém perceber.
  assert.throws(() => currentShop(req({})), /sem resolveTenant/);
});

test('criar uma loja nova é enxergado depois de invalidar o cache', () => {
  const nova = createShop(db, { slug: 'recem-criada', name: 'Nova' });
  assert.equal(resolveShop({ host: 'recem-criada.dominio.com.br' }), null, 'o cache ainda é o antigo');
  invalidateShopCache();
  const achada = resolveShop({ host: 'recem-criada.dominio.com.br' });
  assert.equal(achada && achada !== 'plataforma' ? achada.id : null, nova);
});
