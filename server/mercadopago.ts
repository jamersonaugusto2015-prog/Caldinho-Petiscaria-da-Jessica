import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { toApiAmount } from '../contract/pricing/money';
import { config } from './config';
import { deleteSecret, getSecret, setSecret, type ShopSecretKey } from './infra/secrets';
import type { ShopId } from '../contract/shop/types';
import { LOJA_PADRAO } from './db';

const TOKEN_URL = 'https://api.mercadopago.com/oauth/token';
const PAYMENTS_URL = 'https://api.mercadopago.com/v1/payments';
const AUTH_URL = 'https://auth.mercadopago.com/authorization';

if (!config.MP_WEBHOOK_SECRET) {
  console.warn(
    '⚠️  MP_WEBHOOK_SECRET não configurado: a verificação de assinatura do webhook do Mercado Pago está DESATIVADA. Qualquer requisição para /api/mercadopago/webhook será aceita sem checar a origem.'
  );
}

/**
 * O `state` do OAuth guarda a LOJA.
 *
 * O Mercado Pago devolve o usuário em `/mercadopago/callback` sem credencial
 * nenhuma: só com o `code` e o `state`. Se a loja fosse lida do `Host` do
 * callback, bastaria abrir o callback no host errado para conectar a conta do
 * Mercado Pago de uma loja na outra.
 *
 * O `state` é criado por `startOAuth`, que roda numa requisição de cozinha
 * AUTENTICADA — é a única entrada confiável deste fluxo, e é onde a loja é
 * decidida.
 */
type PendingAuth = { verifier: string; expiresAt: number; shopId: ShopId };
const pendingAuth = new Map<string, PendingAuth>();

/**
 * As credenciais do Mercado Pago são SEGREDO e moram em `shop_secrets`, não em
 * `meta` (migração `019_shop_secrets`).
 *
 * A razão é concreta: `GET /settings` serializa a `meta` inteira para o painel.
 * Enquanto o `mp_access_token` morasse lá, não vazá-lo dependia de alguém
 * lembrar de removê-lo da resposta — e um `io.emit` sem sala já vazou a chave
 * PIX exatamente assim.
 */
function segredo(shopId: ShopId, key: string, fallback = ''): string {
  return getSecret(shopId, key as ShopSecretKey, fallback);
}

/**
 * As credenciais do ambiente (`MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`) valem para
 * UMA loja só: a que existia antes do multi-tenant.
 *
 * Elas são variáveis do SERVIDOR. Sem esta trava, toda loja nova nasceria
 * "conectada ao Mercado Pago" com a credencial da primeira — e cobraria na
 * conta dela. O painel mostraria "conectado" numa loja que nunca conectou
 * nada, que é a pior versão do erro: ninguém vai procurar o que já parece
 * certo.
 */
function credencialDoAmbiente(shopId: ShopId, valor: string | undefined): string {
  return shopId === LOJA_PADRAO ? valor || '' : '';
}

function gravaSegredo(shopId: ShopId, key: string, value: string): void {
  setSecret(shopId, key as ShopSecretKey, value);
}

function apagaSegredos(shopId: ShopId, ...keys: string[]): void {
  for (const key of keys) deleteSecret(shopId, key as ShopSecretKey);
}

export function isOAuthConfigured(): boolean {
  return !!(config.MP_CLIENT_ID && config.MP_CLIENT_SECRET);
}

function looksLikeHttpUrl(value: string): boolean {
  return /^https?:\/\/[a-z0-9.-]+/i.test(value);
}

export function isPublicWebhookUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      host.startsWith('192.168.') ||
      host.startsWith('10.')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * A URL pública desta requisição — e é dela que sai o `notification_url` de cada
 * cobrança.
 *
 * A ORDEM INVERTEU no multi-tenant: o `Host` da requisição vem PRIMEIRO.
 *
 * `MP_REDIRECT_URI` e `APP_URL` são variáveis de ambiente, uma para o servidor
 * inteiro. Com duas lojas, elas apontariam as duas para o mesmo endereço — e o
 * webhook de um pagamento da loja B chegaria no host da loja A. Como é o `Host`
 * que resolve a loja (`middleware/tenant.ts`), isso significa o pagamento de
 * uma loja sendo processado com a credencial da outra.
 *
 * As variáveis continuam existindo como último recurso: em desenvolvimento e em
 * fila de trabalho (backup, scheduler) não há requisição nenhuma para consultar.
 */
export function publicBaseUrl(reqHost?: string, proto?: string): string {
  if (reqHost) return `${proto === 'https' ? 'https' : 'http'}://${reqHost}`;

  const redirect = config.MP_REDIRECT_URI;
  if (redirect && looksLikeHttpUrl(redirect)) {
    return redirect.replace(/\/api\/mercadopago\/callback\/?$/, '');
  }
  const app = config.APP_URL;
  if (app && looksLikeHttpUrl(app)) return app.replace(/\/$/, '');
  const cors = config.CORS_ORIGIN;
  if (cors && cors !== 'true' && looksLikeHttpUrl(cors.split(',')[0].trim())) {
    return cors.split(',')[0].trim().replace(/\/$/, '');
  }
  return 'http://localhost:3001';
}

export function redirectUri(reqHost?: string, proto?: string): string {
  if (config.MP_REDIRECT_URI) return config.MP_REDIRECT_URI;
  return `${publicBaseUrl(reqHost, proto)}/api/mercadopago/callback`;
}

export function isTestMode(shopId: ShopId): boolean {
  const token = segredo(shopId, 'mp_access_token') || credencialDoAmbiente(shopId, config.MP_ACCESS_TOKEN);
  if (tokenLooksLive(token)) return false;
  if (config.MP_TEST === true || tokenLooksTest(token)) return true;
  if (config.MP_TEST === false) return false;
  return !config.isProduction;
}

function tokenLooksLive(token: string): boolean {
  return token.startsWith('APP_USR-');
}

function tokenLooksTest(token: string): boolean {
  return token.startsWith('TEST-');
}

export function isMercadoPagoConnected(shopId: ShopId): boolean {
  const token = segredo(shopId, 'mp_access_token') || credencialDoAmbiente(shopId, config.MP_ACCESS_TOKEN);
  if (!token) return false;
  if (isTestMode(shopId) && tokenLooksLive(token)) return false;
  return true;
}

export function mercadoPagoUserId(shopId: ShopId): string {
  return segredo(shopId, 'mp_user_id');
}

export function saveManualAccessToken(shopId: ShopId, raw: string): void {
  const token = raw.trim();
  if (!token) throw new Error('Cole o Access Token.');
  if (isTestMode(shopId) && !tokenLooksTest(token)) {
    throw new Error(
      'Modo teste: cole o Access Token que começa com TEST- (Credenciais de teste no painel). Não use APP_USR-.'
    );
  }
  if (!isTestMode(shopId) && !tokenLooksLive(token) && !tokenLooksTest(token)) {
    throw new Error('Token inválido. Use um Access Token do Mercado Pago.');
  }
  gravaSegredo(shopId, 'mp_access_token', token);
  gravaSegredo(shopId, 'mp_connected_at', new Date().toISOString());
  if (tokenLooksTest(token)) gravaSegredo(shopId, 'mp_user_id', 'teste');
}

export function savePublicKey(shopId: ShopId, raw: string): void {
  const key = raw.trim();
  if (!key) {
    apagaSegredos(shopId, 'mp_public_key');
    return;
  }
  gravaSegredo(shopId, 'mp_public_key', key);
}

export function getPublicKey(shopId: ShopId): string {
  return segredo(shopId, 'mp_public_key') || credencialDoAmbiente(shopId, config.MP_PUBLIC_KEY);
}

function buildPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function startOAuth(shopId: ShopId, reqHost?: string, proto?: string): { url: string } {
  if (!isOAuthConfigured()) {
    throw new Error('Defina MP_CLIENT_ID e MP_CLIENT_SECRET no servidor.');
  }
  const state = randomBytes(16).toString('hex');
  const { verifier, challenge } = buildPkce();
  pendingAuth.set(state, { verifier, expiresAt: Date.now() + 10 * 60 * 1000, shopId });

  const params = new URLSearchParams({
    client_id: config.MP_CLIENT_ID ?? '',
    response_type: 'code',
    platform_id: 'mp',
    state,
    redirect_uri: redirectUri(reqHost, proto),
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return { url: `${AUTH_URL}?${params.toString()}` };
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user_id?: number | string;
  public_key?: string;
  error?: string;
  message?: string;
  error_description?: string;
};

function saveTokens(shopId: ShopId, data: TokenResponse): void {
  if (!data.access_token) throw new Error(data.message || data.error_description || 'Token do Mercado Pago vazio.');
  gravaSegredo(shopId, 'mp_access_token', data.access_token);
  if (data.refresh_token) gravaSegredo(shopId, 'mp_refresh_token', data.refresh_token);
  const expiresIn = Number(data.expires_in) || 180 * 24 * 3600;
  gravaSegredo(shopId, 'mp_token_expires_at', new Date(Date.now() + expiresIn * 1000).toISOString());
  if (data.user_id != null) gravaSegredo(shopId, 'mp_user_id', String(data.user_id));
  if (data.public_key) gravaSegredo(shopId, 'mp_public_key', data.public_key);
  gravaSegredo(shopId, 'mp_connected_at', new Date().toISOString());
}

export async function finishOAuth(
  code: string,
  state: string,
  reqHost?: string,
  proto?: string
): Promise<void> {
  const pending = pendingAuth.get(state);
  pendingAuth.delete(state);
  if (!pending || pending.expiresAt < Date.now()) {
    throw new Error('Sessão OAuth expirada. Tente conectar de novo.');
  }
  // A loja sai do `state`, não do `Host` do callback: o Mercado Pago devolve o
  // usuário aqui sem credencial nenhuma.
  const shopId = pending.shopId;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: config.MP_CLIENT_ID,
      client_secret: config.MP_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(reqHost, proto),
      code_verifier: pending.verifier,
      test_token: isTestMode(shopId) ? 'true' : 'false',
    }),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok) {
    throw new Error(data.message || data.error_description || 'Falha ao trocar o código do Mercado Pago.');
  }
  saveTokens(shopId, data);
}

export function disconnectMercadoPago(shopId: ShopId): void {
  apagaSegredos(
    shopId,
    'mp_access_token',
    'mp_refresh_token',
    'mp_token_expires_at',
    'mp_user_id',
    'mp_public_key',
    'mp_connected_at'
  );
}

async function refreshAccessToken(shopId: ShopId): Promise<string | null> {
  const refresh = segredo(shopId, 'mp_refresh_token');
  if (!refresh || !isOAuthConfigured()) return null;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: config.MP_CLIENT_ID,
      client_secret: config.MP_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refresh,
    }),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || !data.access_token) return null;
  saveTokens(shopId, data);
  return data.access_token;
}

export async function getAccessToken(shopId: ShopId): Promise<string | null> {
  const stored = segredo(shopId, 'mp_access_token');
  const expiresAt = segredo(shopId, 'mp_token_expires_at');
  if (stored) {
    if (isTestMode(shopId) && tokenLooksLive(stored)) return null;
    const soon = Date.now() + 60 * 60 * 1000;
    if (!expiresAt || new Date(expiresAt).getTime() > soon) return stored;
    const refreshed = await refreshAccessToken(shopId);
    if (refreshed) return refreshed;
    return stored;
  }
  const envToken = credencialDoAmbiente(shopId, config.MP_ACCESS_TOKEN);
  if (envToken && isTestMode(shopId) && tokenLooksLive(envToken)) return null;
  return envToken || null;
}

/** Prazo da cobrança PIX. Depois disso o QR Code morre sozinho no Mercado Pago. */
const PIX_EXPIRATION_MINUTES = 30;

export type MpPixCharge = {
  paymentId: string;
  qrCode: string;
  qrCodeBase64?: string;
  ticketUrl?: string;
};

export async function createPixCharge(opts: {
  /** A loja que vai RECEBER o dinheiro. Sem ela, a cobrança cai na conta errada. */
  shopId: ShopId;
  orderId: string;
  amount: number;
  description: string;
  payerName: string;
  notificationUrl?: string;
}): Promise<MpPixCharge> {
  const { shopId } = opts;
  const token = await getAccessToken(shopId);
  if (!token) {
    throw new Error(
      isTestMode(shopId)
        ? 'Modo teste: cole um Access Token TEST- nas configurações da cozinha. APP_USR- não funciona em teste.'
        : 'Mercado Pago não está conectado.'
    );
  }
  if (isTestMode(shopId) && tokenLooksLive(token)) {
    throw new Error('Modo teste: não use credenciais live (APP_USR-). Cole o token TEST- do painel.');
  }

  const firstName = opts.payerName.trim().split(/\s+/)[0] || 'Cliente';
  // Sem prazo, uma cobrança PIX segue pagável para sempre: o cliente cancela o
  // pedido e paga o QR Code dias depois, e o dinheiro cai sem pedido por trás.
  // O Mercado Pago exige o deslocamento explícito, não aceita o sufixo "Z".
  const expiresAt = new Date(Date.now() + PIX_EXPIRATION_MINUTES * 60 * 1000)
    .toISOString()
    .replace('Z', '+00:00');
  const lastName = opts.payerName.trim().split(/\s+/).slice(1).join(' ') || 'Caldinho';
  const testEmail = `test_user_${opts.orderId.toLowerCase().replace(/[^a-z0-9]/g, '')}@testuser.com`;
  const liveEmail = `pedido.${opts.orderId.toLowerCase().replace(/[^a-z0-9]/g, '')}@caldinho.app`;
  const body = {
    transaction_amount: toApiAmount(opts.amount),
    description: opts.description.slice(0, 255),
    payment_method_id: 'pix',
    payer: {
      email: isTestMode(shopId) || tokenLooksTest(token) ? testEmail : liveEmail,
      first_name: firstName.slice(0, 60),
      last_name: lastName.slice(0, 60),
    },
    external_reference: opts.orderId,
    date_of_expiration: expiresAt,
    ...(isPublicWebhookUrl(opts.notificationUrl)
      ? { notification_url: opts.notificationUrl }
      : {}),
  };

  const res = await fetch(PAYMENTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Idempotency-Key': `pix-${opts.orderId}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    id?: number | string;
    status?: string;
    message?: string;
    error?: string;
    cause?: { description?: string }[];
    point_of_interaction?: {
      transaction_data?: {
        qr_code?: string;
        qr_code_base64?: string;
        ticket_url?: string;
      };
    };
  };
  if (!res.ok || !data.id) {
    const detail = data.cause?.[0]?.description || data.message || data.error || `HTTP ${res.status}`;
    throw new Error(`Mercado Pago: ${detail}`);
  }
  const tx = data.point_of_interaction?.transaction_data;
  if (!tx?.qr_code) {
    throw new Error('Mercado Pago não devolveu o PIX. Confira a chave PIX na conta.');
  }
  return {
    paymentId: String(data.id),
    qrCode: tx.qr_code,
    qrCodeBase64: tx.qr_code_base64,
    ticketUrl: tx.ticket_url,
  };
}

export type MpCardCharge = {
  paymentId: string;
  status: string;
  statusDetail?: string;
  paymentMethodId?: string;
};

export async function createCardCharge(opts: {
  /** A loja que vai RECEBER o dinheiro. Sem ela, a cobrança cai na conta errada. */
  shopId: ShopId;
  orderId: string;
  amount: number;
  description: string;
  cardToken: string;
  paymentMethodId: string;
  installments: number;
  issuerId?: string;
  payerEmail: string;
  identificationType: string;
  identificationNumber: string;
  notificationUrl?: string;
}): Promise<MpCardCharge> {
  const { shopId } = opts;
  const token = await getAccessToken(shopId);
  if (!token) throw new Error('Mercado Pago não está conectado.');

  const body: Record<string, unknown> = {
    token: opts.cardToken,
    transaction_amount: toApiAmount(opts.amount),
    description: opts.description.slice(0, 255),
    installments: Math.max(1, Math.floor(opts.installments || 1)),
    payment_method_id: opts.paymentMethodId,
    binary_mode: true,
    payer: {
      email: opts.payerEmail.trim().slice(0, 120),
      identification: {
        type: opts.identificationType || 'CPF',
        number: opts.identificationNumber.replace(/\D/g, ''),
      },
    },
    external_reference: opts.orderId,
    ...(isPublicWebhookUrl(opts.notificationUrl) ? { notification_url: opts.notificationUrl } : {}),
  };
  if (opts.issuerId) body.issuer_id = Number(opts.issuerId) || opts.issuerId;

  const res = await fetch(PAYMENTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Idempotency-Key': `card-${opts.orderId}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    id?: number | string;
    status?: string;
    status_detail?: string;
    payment_method_id?: string;
    message?: string;
    error?: string;
    cause?: { description?: string }[];
  };
  if (!res.ok || !data.id) {
    const detail = data.cause?.[0]?.description || data.message || data.error || `HTTP ${res.status}`;
    throw new Error(`Mercado Pago: ${detail}`);
  }
  return {
    paymentId: String(data.id),
    status: String(data.status || ''),
    statusDetail: data.status_detail,
    paymentMethodId: data.payment_method_id,
  };
}

export type MpPayment = {
  id: string;
  status: string;
  externalReference: string;
};

export async function fetchPayment(shopId: ShopId, paymentId: string): Promise<MpPayment | null> {
  const token = await getAccessToken(shopId);
  if (!token) return null;
  const res = await fetch(`${PAYMENTS_URL}/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    id?: number | string;
    status?: string;
    external_reference?: string;
  };
  if (!data.id) return null;
  return {
    id: String(data.id),
    status: String(data.status || ''),
    externalReference: String(data.external_reference || ''),
  };
}

export type MpRefund = {
  refundId: string;
  status: string;
};

/** Tempo máximo de espera do Mercado Pago numa devolução, em milissegundos. */
const REFUND_TIMEOUT_MS = 20000;

/**
 * Única chamada do projeto que TIRA dinheiro da conta da loja. Qualquer resposta
 * que não seja um 2xx com um id de devolução vira erro: quem chama grava
 * `refundStatus: 'falhou'` e a cozinha tenta de novo. Nunca devolvemos sucesso
 * numa resposta duvidosa — marcar 'devolvido' sem devolução é perder o dinheiro
 * e o registro ao mesmo tempo.
 */
export async function refundPayment(shopId: ShopId, paymentId: string, amount?: number): Promise<MpRefund> {
  const id = String(paymentId || '').trim();
  if (!id) throw new Error('Pagamento sem identificador no Mercado Pago.');
  const token = await getAccessToken(shopId);
  if (!token) throw new Error('Mercado Pago não está conectado.');

  const partial = typeof amount === 'number' && Number.isFinite(amount) && amount > 0;
  const body = partial ? { amount: toApiAmount(amount) } : {};

  let res: Response;
  try {
    res = await fetch(`${PAYMENTS_URL}/${encodeURIComponent(id)}/refunds`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // A mesma chave para o mesmo pagamento: uma repetição da rota de
        // devolução não pode virar duas devoluções.
        'X-Idempotency-Key': `refund-${id}${partial ? `-${body.amount}` : ''}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REFUND_TIMEOUT_MS),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'sem resposta';
    throw new Error(`Mercado Pago não respondeu à devolução: ${detail}`);
  }

  let data: {
    id?: number | string;
    status?: string;
    message?: string;
    error?: string;
    cause?: { description?: string }[];
  } = {};
  try {
    data = (await res.json()) as typeof data;
  } catch {
    // Um 502 do proxy do Mercado Pago devolve HTML: sem corpo JSON só sobra o status.
    if (!res.ok) throw new Error(`Mercado Pago: HTTP ${res.status}`);
    throw new Error('Mercado Pago devolveu uma resposta ilegível na devolução.');
  }

  if (!res.ok || !data.id) {
    const detail = data.cause?.[0]?.description || data.message || data.error || `HTTP ${res.status}`;
    throw new Error(`Mercado Pago: ${detail}`);
  }
  const status = String(data.status || '');
  if (status && status !== 'approved') {
    throw new Error(`Mercado Pago não aprovou a devolução (${status}).`);
  }
  return { refundId: String(data.id), status: status || 'approved' };
}

export function parseWebhookPaymentId(body: unknown, query: Record<string, unknown>): string | null {
  const q = query || {};
  const topic = String(q.topic || q.type || '');
  if (topic && topic !== 'payment') return null;

  const b = body as { type?: string; data?: { id?: string | number } } | null;
  if (b?.type && b.type !== 'payment') return null;
  if (b?.data?.id != null) return String(b.data.id);

  const qId = q['data.id'] ?? q.id;
  if (typeof qId === 'string' && qId) return qId;
  if (typeof qId === 'number') return String(qId);
  return null;
}

/**
 * Verifica a assinatura do webhook conforme documentado pelo Mercado Pago:
 * header `x-signature` traz `ts=<epoch>,v1=<hmac hex>` e o manifest assinado é
 * `id:<data.id em minúsculas>;request-id:<x-request-id>;ts:<ts>;`.
 *
 * O segredo é DA LOJA. Cada loja conecta a própria conta do Mercado Pago, e o
 * painel do MP gera um segredo por conta — um segredo global só validaria a
 * assinatura de uma delas, e "assinatura inválida" num webhook de pagamento
 * significa dinheiro que entrou e pedido que nunca foi marcado como pago.
 *
 * `MP_WEBHOOK_SECRET` do ambiente continua valendo como padrão: é o segredo da
 * loja que existia antes do multi-tenant, e tirá-lo derrubaria a verificação
 * dela num deploy.
 *
 * Sem segredo nenhum a verificação fica DESATIVADA (o boot avisa) e a
 * requisição é aceita — o comportamento de antes.
 */
export function verifyWebhookSignature(
  shopId: ShopId,
  xSignature: string | undefined,
  xRequestId: string | undefined,
  dataId: string
): boolean {
  // O env vale SÓ para a loja padrão, como o access token e a public key acima
  // (credencialDoAmbiente): uma loja nova que conecta o próprio Mercado Pago
  // assina com o SEGREDO DELA, e o env da primeira loja rejeitaria — em
  // silêncio — todo webhook dela.
  const secret =
    segredo(shopId, 'mp_webhook_secret') || credencialDoAmbiente(shopId, config.MP_WEBHOOK_SECRET);
  if (!secret) return true;
  if (!xSignature || !dataId) return false;

  const parts: Record<string, string> = {};
  for (const chunk of xSignature.split(',')) {
    const [key, value] = chunk.split('=');
    if (key && value) parts[key.trim()] = value.trim();
  }
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId || ''};ts:${ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');

  let expectedBuf: Buffer;
  let givenBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expected, 'hex');
    givenBuf = Buffer.from(v1, 'hex');
  } catch {
    return false;
  }
  if (expectedBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(expectedBuf, givenBuf);
}
