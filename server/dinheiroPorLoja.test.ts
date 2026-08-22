import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { createHmac } from 'node:crypto';

/**
 * A prova da Fase 7: o dinheiro de cada loja cai na conta DELA.
 *
 * É o que travava a segunda loja. Com uma credencial só do Mercado Pago, a
 * loja B cobraria na conta da loja A — o pedido fecharia, o cliente pagaria, e
 * o dinheiro entraria na conta errada sem nenhum erro em lugar nenhum.
 */

const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'caldinho-dinheiro-'));
process.env.DATA_DIR = DATA_DIR;

const { db } = await import('./db');
const { createShop } = await import('./infra/db/seed/createShop');
const { getSecret, setSecret } = await import('./infra/secrets');
const {
  getPublicKey,
  isMercadoPagoConnected,
  isTestMode,
  disconnectMercadoPago,
  saveManualAccessToken,
  publicBaseUrl,
  verifyWebhookSignature,
} = await import('./mercadopago');

after(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const LOJA_A = createShop(db, { slug: 'loja-a', name: 'Loja A' });
const LOJA_B = createShop(db, { slug: 'loja-b', name: 'Loja B' });

// ---------------------------------------------------------------------------

test('cada loja guarda o próprio token do Mercado Pago', () => {
  saveManualAccessToken(LOJA_A, 'TEST-token-da-loja-a');
  saveManualAccessToken(LOJA_B, 'TEST-token-da-loja-b');

  assert.equal(getSecret(LOJA_A, 'mp_access_token'), 'TEST-token-da-loja-a');
  assert.equal(getSecret(LOJA_B, 'mp_access_token'), 'TEST-token-da-loja-b');
});

test('conectar uma loja não conecta a outra', () => {
  const nova = createShop(db, { slug: 'terceira', name: 'Terceira' });
  assert.equal(isMercadoPagoConnected(LOJA_A), true);
  assert.equal(
    isMercadoPagoConnected(nova),
    false,
    'uma loja sem token não pode ser considerada conectada porque outra está'
  );
});

test('desconectar uma loja não desconecta a outra', () => {
  disconnectMercadoPago(LOJA_B);
  assert.equal(isMercadoPagoConnected(LOJA_B), false);
  assert.equal(isMercadoPagoConnected(LOJA_A), true, 'a loja A não pode cair junto');
  assert.equal(getSecret(LOJA_A, 'mp_access_token'), 'TEST-token-da-loja-a');
});

test('a chave pública do cartão é por loja', () => {
  setSecret(LOJA_A, 'mp_public_key', 'PUB-A');
  setSecret(LOJA_B, 'mp_public_key', 'PUB-B');
  assert.equal(getPublicKey(LOJA_A), 'PUB-A');
  assert.equal(getPublicKey(LOJA_B), 'PUB-B');
});

test('colar token de produção com o servidor em modo teste é recusado', () => {
  // Não é limitação: é a proteção. Em sandbox, um `APP_USR-` colado por engano
  // faria a loja cobrar de verdade achando que estava testando.
  assert.throws(
    () => saveManualAccessToken(LOJA_B, 'APP_USR-token-de-verdade'),
    /TEST-/
  );
});

test('o modo de teste é decidido pelo token DAQUELA loja', () => {
  // Uma loja em sandbox e a outra valendo ao mesmo tempo é o caso real de uma
  // loja nova sendo testada enquanto a antiga fatura. O token vai direto pelo
  // cofre porque `saveManualAccessToken` (com razão) recusaria o `APP_USR-`
  // enquanto o servidor está em modo teste — aqui simulamos a loja que já
  // conectou por OAuth em produção.
  setSecret(LOJA_B, 'mp_access_token', 'APP_USR-token-de-verdade');
  assert.equal(isTestMode(LOJA_A), true, 'a loja A está em sandbox');
  assert.equal(isTestMode(LOJA_B), false, 'a loja B está valendo');
  assert.equal(isMercadoPagoConnected(LOJA_B), true);
});

test('o segredo do webhook é por loja', () => {
  // O painel do Mercado Pago gera um segredo por CONTA. Com um segredo global,
  // a assinatura de uma das lojas nunca bateria — e "assinatura inválida" num
  // webhook de pagamento é dinheiro que entrou e pedido que nunca foi quitado.
  setSecret(LOJA_A, 'mp_webhook_secret', 'segredo-a');
  setSecret(LOJA_B, 'mp_webhook_secret', 'segredo-b');

  // Uma assinatura VÁLIDA, feita com o segredo da loja A (o mesmo manifesto que
  // o verificador monta): id;request-id;ts. Só a loja A pode aceitá-la — se a
  // loja B também aceitasse, o segredo não seria por loja e o webhook de A
  // quitaria na conta de B.
  const ts = '1700000000';
  const reqId = 'req-1';
  const dataId = 'pay-1';
  const manifesto = `id:${dataId.toLowerCase()};request-id:${reqId};ts:${ts};`;
  const v1 = createHmac('sha256', 'segredo-a').update(manifesto).digest('hex');
  const assinaturaDeA = `ts=${ts},v1=${v1}`;
  assert.equal(
    verifyWebhookSignature(LOJA_A, assinaturaDeA, reqId, dataId),
    true,
    'a loja A aceita a própria assinatura'
  );
  assert.equal(
    verifyWebhookSignature(LOJA_B, assinaturaDeA, reqId, dataId),
    false,
    'a loja B NÃO pode aceitar a assinatura da loja A'
  );

  // E a loja sem segredo nenhum aceita (o comportamento antigo, documentado).
  const semSegredo = createShop(db, { slug: 'sem-segredo', name: 'Sem segredo' });
  assert.equal(verifyWebhookSignature(semSegredo, assinaturaDeA, reqId, dataId), true);
});

test('o notification_url sai do Host da requisição, não do ambiente', () => {
  // É a inversão da Fase 7. `MP_REDIRECT_URI` e `APP_URL` são variáveis do
  // SERVIDOR: com duas lojas elas apontariam as duas para o mesmo endereço, e o
  // webhook de um pagamento da loja B chegaria no host da loja A — onde seria
  // processado com a credencial errada.
  assert.equal(publicBaseUrl('loja-b.dominio.com.br', 'https'), 'https://loja-b.dominio.com.br');
  assert.equal(publicBaseUrl('loja-a.dominio.com.br', 'https'), 'https://loja-a.dominio.com.br');
});

test('sem Host nenhum ainda há um endereço: fila e desenvolvimento não têm requisição', () => {
  assert.match(publicBaseUrl(undefined, undefined), /^https?:\/\//);
});

test('a credencial do AMBIENTE vale só para a loja que existia antes', async () => {
  // `MP_ACCESS_TOKEN` é variável do SERVIDOR. Sem esta trava, toda loja nova
  // nasceria "conectada" com a credencial da primeira — e cobraria na conta
  // dela. O painel mostraria "conectado" numa loja que nunca conectou nada, que
  // é a pior versão do erro: ninguém procura o que já parece certo.
  const { config } = await import('./config');
  const { LOJA_PADRAO } = await import('./db');

  const anterior = config.MP_ACCESS_TOKEN;
  try {
    (config as { MP_ACCESS_TOKEN?: string }).MP_ACCESS_TOKEN = 'TEST-token-do-ambiente';
    const nova = createShop(db, { slug: 'recem-nascida', name: 'Recém-nascida' });

    assert.equal(
      isMercadoPagoConnected(nova),
      false,
      'loja nova NÃO herda a credencial do ambiente'
    );
    assert.equal(
      isMercadoPagoConnected(LOJA_PADRAO),
      true,
      'a loja que existia antes continua usando a credencial do ambiente'
    );
  } finally {
    (config as { MP_ACCESS_TOKEN?: string }).MP_ACCESS_TOKEN = anterior;
  }
});
