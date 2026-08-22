import { db } from '../db';
import type { ShopId } from '../../contract/shop/types';

/**
 * Os segredos da loja e os do servidor. A única porta para `shop_secrets` e
 * `server_config`.
 *
 * Eles moravam na tabela `meta`, junto do nome da loja e do horário de
 * funcionamento — e `GET /settings` serializa a `meta` inteira para o painel.
 * Toda proteção dependia de alguém lembrar de remover a chave da resposta. Um
 * `io.emit` sem sala em `routes.ts` já vazou a chave PIX para todo mundo
 * conectado exatamente assim.
 *
 * Tabela separada não escorrega junto: para vazar um segredo agora é preciso
 * pedir por ele, por nome.
 */

// ---------------------------------------------------------------------------
// Segredos DA LOJA
// ---------------------------------------------------------------------------

export type ShopSecretKey =
  | 'kitchen_pin_hash'
  | 'role_token_kitchen'
  | 'role_token_driver'
  | 'mp_access_token'
  | 'mp_refresh_token'
  | 'mp_public_key'
  | 'mp_user_id'
  | 'mp_expires_at'
  | 'mp_live_mode'
  | 'mp_token_expires_at'
  | 'mp_connected_at'
  /**
   * O segredo de assinatura do webhook, POR LOJA.
   *
   * Cada loja conecta a própria conta do Mercado Pago, e o painel do MP gera um
   * segredo por conta. Um segredo global só validaria a assinatura de uma delas
   * — e "assinatura inválida" num webhook de pagamento significa dinheiro que
   * entrou e pedido que nunca foi marcado como pago.
   */
  | 'mp_webhook_secret'
  | 'backup_service_account';

export function getSecret(shopId: ShopId, key: ShopSecretKey, fallback = ''): string {
  const row = db
    .prepare('SELECT value FROM shop_secrets WHERE shop_id = ? AND key = ?')
    .get(shopId, key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setSecret(shopId: ShopId, key: ShopSecretKey, value: string): void {
  db.prepare(
    `INSERT INTO shop_secrets (shop_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(shop_id, key) DO UPDATE SET value = excluded.value`
  ).run(shopId, key, value);
}

export function deleteSecret(shopId: ShopId, key: ShopSecretKey): void {
  db.prepare('DELETE FROM shop_secrets WHERE shop_id = ? AND key = ?').run(shopId, key);
}

/** Existe sem revelar o valor. É o que o painel precisa para dizer "configurado". */
export function hasSecret(shopId: ShopId, key: ShopSecretKey): boolean {
  return !!getSecret(shopId, key);
}

/**
 * O token de papel da loja.
 *
 * Devolve `''` quando não há token — e quem compara PRECISA recusar o vazio.
 * `'' === ''` já liberou rota para requisição sem header nenhum.
 */
export function getRoleToken(shopId: ShopId, role: 'kitchen' | 'driver'): string {
  return getSecret(shopId, role === 'kitchen' ? 'role_token_kitchen' : 'role_token_driver');
}

// ---------------------------------------------------------------------------
// Configuração DO SERVIDOR (não é de loja nenhuma)
// ---------------------------------------------------------------------------

/**
 * O par VAPID mora aqui e não em `shop_secrets` porque ele identifica o
 * SERVIDOR DE PUSH para o navegador, não a loja. Uma chave por loja quebraria
 * push de verdade: a inscrição guardada no navegador foi assinada com uma chave
 * pública específica, e trocá-la mata em silêncio todos os inscritos.
 */
export type ServerConfigKey = 'vapid_public_key' | 'vapid_private_key';

export function getServerConfig(key: ServerConfigKey, fallback = ''): string {
  const row = db.prepare('SELECT value FROM server_config WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function setServerConfig(key: ServerConfigKey, value: string): void {
  db.prepare(
    `INSERT INTO server_config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}
