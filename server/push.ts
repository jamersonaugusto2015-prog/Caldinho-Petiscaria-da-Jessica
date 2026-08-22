import webpush from 'web-push';
import type { ChatMessage, Order } from '../contract/order/types';
import { AlertContext, OrderAlert, OrderAlertEvent, chatAlertFor, orderAlertFor } from '../contract/order/alerts';
import { db, getMetaValue, getSettings } from './db';
import { AudienceRole, OrderRecipient, orderAudience } from '../contract/order/audience';
import { config } from './config';
import type { ShopId } from '../contract/shop/types';
import { getServerConfig, setServerConfig, type ServerConfigKey } from './infra/secrets';
import { driverRoom, driversRoom } from '../contract/shop/rooms';

/**
 * Push: o segundo transporte da audiência do pedido.
 *
 * O socket só alcança quem está com o app aberto. A cozinha fecha a aba, o
 * motoboy bloqueia o celular e o cliente sai do navegador — e o pedido novo
 * ficava tocando para ninguém. Este módulo pega a MESMA audiência que
 * `orderEvents.ts` usa (`orderAudience`) e a MESMA tabela de alertas que o
 * navegador usa (`src/shared/orderAlerts.ts`), então a notificação que chega
 * com o app fechado diz exatamente o que o banner diria com o app aberto.
 *
 * A regra que não pode ser quebrada: o payload é montado a partir de
 * `recipient.order`, a vista já redigida (ADR-0010). Montar a partir do pedido
 * cru faria a notificação do pool carregar nome, telefone e rua do cliente para
 * o time inteiro — o mesmo vazamento que a vista fechou no socket e no HTTP,
 * reaberto por um cano novo.
 */

// ---------------------------------------------------------------------------
// Chaves VAPID
// ---------------------------------------------------------------------------

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

let cachedVapid: VapidKeys | null = null;

/**
 * O par VAPID sai de `server_config`, não de `meta`.
 *
 * Ele identifica o SERVIDOR DE PUSH para o navegador — não a loja. Uma chave
 * por loja quebraria push de verdade: a inscrição guardada no navegador foi
 * assinada com uma chave pública específica, e trocá-la mata em silêncio todos
 * os inscritos daquela loja.
 */
function metaGet(key: string): string | null {
  return getServerConfig(key as ServerConfigKey) || null;
}

function metaPutIfAbsent(key: string, value: string): void {
  if (!getServerConfig(key as ServerConfigKey)) setServerConfig(key as ServerConfigKey, value);
}

/**
 * As chaves vêm do ambiente quando alguém as define; senão nascem aqui, uma vez
 * só, e ficam no `meta`.
 *
 * Persistir não é comodidade: a inscrição do navegador é assinada com a chave
 * PÚBLICA que ele recebeu no dia em que aceitou. Gerar um par novo a cada boot
 * (ou a cada deploy, num disco efêmero) invalida em silêncio todas as
 * inscrições já gravadas — ninguém recebe nada e nada aparece como erro, porque
 * o servidor continua "funcionando". Chave rotacionada = base de inscritos
 * morta.
 */
export function vapidKeys(): VapidKeys {
  if (cachedVapid) return cachedVapid;

  const subject =
    config.VAPID_SUBJECT || config.APP_URL || 'mailto:contato@caldinhodajessica.com.br';

  const envPublic = config.VAPID_PUBLIC_KEY;
  const envPrivate = config.VAPID_PRIVATE_KEY;
  if (envPublic && envPrivate) {
    cachedVapid = { publicKey: envPublic, privateKey: envPrivate, subject };
    return cachedVapid;
  }

  let publicKey = metaGet('vapid_public_key');
  let privateKey = metaGet('vapid_private_key');
  if (!publicKey || !privateKey) {
    const generated = webpush.generateVAPIDKeys();
    // INSERT ... DO NOTHING e releitura: dois processos subindo juntos não podem
    // gravar pares diferentes por cima um do outro.
    metaPutIfAbsent('vapid_public_key', generated.publicKey);
    metaPutIfAbsent('vapid_private_key', generated.privateKey);
    publicKey = metaGet('vapid_public_key');
    privateKey = metaGet('vapid_private_key');
  }

  cachedVapid = { publicKey: publicKey ?? '', privateKey: privateKey ?? '', subject };
  return cachedVapid;
}

/** Chave pública em base64 url-safe, do jeito que o `PushManager` espera. */
export function pushPublicKey(): string {
  return vapidKeys().publicKey;
}

// ---------------------------------------------------------------------------
// Inscrições
// ---------------------------------------------------------------------------

export interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface SubscriptionRow {
  endpoint: string;
  data: string;
}

/** O corpo chega do navegador: nada aqui é confiável até ter a forma certa. */
export function isPushSubscription(value: unknown): value is StoredSubscription {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  return (
    typeof candidate.endpoint === 'string' &&
    candidate.endpoint.startsWith('https://') &&
    typeof candidate.keys?.p256dh === 'string' &&
    typeof candidate.keys?.auth === 'string'
  );
}

/**
 * A sala NUNCA vem do corpo (ADR-0009): quem chama resolve a identidade pela
 * credencial e passa a sala já decidida. Aceitar `room` do cliente seria dar a
 * qualquer navegador a chave da sala privada de um motoboy.
 */
export function savePushSubscription(input: {
  shopId: ShopId;
  room: string;
  role: AudienceRole;
  subscription: StoredSubscription;
}): void {
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, shop_id, room, role, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       shop_id = excluded.shop_id,
       room = excluded.room,
       role = excluded.role,
       data = excluded.data`
  ).run(
    input.subscription.endpoint,
    input.shopId,
    input.room,
    input.role,
    JSON.stringify(input.subscription),
    new Date().toISOString()
  );
}

export function deletePushSubscription(endpoint: string): void {
  if (!endpoint) return;
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

/**
 * Demitir tem que calar o celular junto. Sem isso o ex-funcionário continuava
 * recebendo cada corrida nova no bolso — com o token já revogado, mas com o
 * bairro, a distância e a taxa de toda a operação.
 */
export function deletePushSubscriptionsForDriver(shopId: ShopId, driverId: string): void {
  if (!driverId) return;
  // A sala vem de `driverRoom`, não de um template escrito à mão. Quando o
  // prefixo da loja entrou nas salas, esta linha ainda montava `driver:<id>` e
  // deixou de casar com nada: demitir alguém parou de apagar o push dele, e o
  // celular do ex-funcionário continuaria recebendo cada corrida nova.
  db.prepare('DELETE FROM push_subscriptions WHERE shop_id = ? AND room = ?').run(
    shopId,
    driverRoom(shopId, driverId)
  );
}

export function countPushSubscriptions(shopId: ShopId, room: string): number {
  return (
    db
      .prepare('SELECT COUNT(*) AS c FROM push_subscriptions WHERE shop_id = ? AND room = ?')
      .get(shopId, room) as { c: number }
  ).c;
}

/**
 * O motoboy grava UMA linha, na sala privada dele — o endpoint é chave primária
 * e um navegador é um navegador só. A sala compartilhada `drivers` é derivada:
 * é todo mundo com papel de motoboy, menos a sala que o `except` desconta. É
 * assim que o dono da corrida não recebe a versão redigida por cima da dele.
 */
function rowsFor(shopId: ShopId, room: string, except?: string): SubscriptionRow[] {
  // A sala compartilhada dos motoboys é DERIVADA do papel, não guardada: nenhum
  // navegador se inscreve nela. Sem o `shop_id` na consulta, ela alcançaria os
  // motoboys de todas as lojas — cada corrida nova de uma tocando no celular da
  // equipe da outra, com bairro, distância e taxa.
  if (room === driversRoom(shopId)) {
    return except
      ? (db
          .prepare(
            "SELECT endpoint, data FROM push_subscriptions WHERE shop_id = ? AND role = 'driver' AND room <> ?"
          )
          .all(shopId, except) as SubscriptionRow[])
      : (db
          .prepare(
            "SELECT endpoint, data FROM push_subscriptions WHERE shop_id = ? AND role = 'driver'"
          )
          .all(shopId) as SubscriptionRow[]);
  }
  return db
    .prepare('SELECT endpoint, data FROM push_subscriptions WHERE shop_id = ? AND room = ?')
    .all(shopId, room) as SubscriptionRow[];
}

// ---------------------------------------------------------------------------
// Montagem do payload — puro, testável sem banco e sem rede
// ---------------------------------------------------------------------------

/**
 * O que o servidor sabe do estado ANTERIOR do pedido.
 *
 * `driverId` fica de fora de propósito: ele é por destinatário e sai da
 * audiência, nunca do chamador. Um campo onde a rota declara "o motoboy é este"
 * é exatamente a entrada não provada que a ADR-0009 apagou.
 *
 * `hadPendingCancelRequest` e `hadOpenComplaint` o servidor consegue ler do
 * pedido antes do evento; quem chama de um lugar que não tem o "antes" na mão
 * simplesmente não passa nada, e a tabela de alertas trata a ausência como
 * "primeira vez que vejo isto". Não inventamos estado para preencher campo.
 */
export type OrderPushContext = Omit<AlertContext, 'driverId'>;

export interface PushEnvelope {
  /**
   * A loja dona deste envio. Sem ela, a sala derivada `drivers` alcançaria a
   * equipe de TODAS as lojas — cada corrida nova de uma tocando no bolso da
   * outra, com bairro, distância e taxa.
   */
  shopId: ShopId;
  room: string;
  except?: string;
  role: AudienceRole;
  alert: OrderAlert;
  payload: string;
}

/**
 * A marca da loja que o `sw.js` precisa para desenhar a notificação: hoje ele
 * carrega "Caldinho da Jessica" e os ícones de UMA loja só, gravados em
 * constantes fixas (ver `public/sw.js`). Sem isto no payload, o push da
 * pizzaria chegava com o nome e o ícone do caldinho.
 */
interface PushBranding {
  storeName: string;
  /** Prefixo dos ícones da loja (ex.: `/api/uploads/2/icons`). Vazio = os padrões do `sw.js`. */
  iconBase: string;
}

function pushBrandingFor(shopId: ShopId): PushBranding {
  return {
    storeName: getSettings(shopId).storeName,
    iconBase: getMetaValue(shopId, 'brand_icon_base'),
  };
}

function envelopeFor(
  shopId: ShopId,
  recipient: OrderRecipient,
  alert: OrderAlert | null,
  branding: PushBranding
): PushEnvelope | null {
  // `null` é a resposta mais comum da tabela: a maior parte dos eventos é
  // sincronização de estado, não notícia. E `system: false` é o alerta que
  // existe na tela mas não vale atravessar o app fechado.
  if (!alert || !alert.channels.system) return null;
  return {
    shopId,
    room: recipient.room,
    except: recipient.except,
    role: recipient.role,
    alert,
    // `storeName`/`iconBase` viajam ao lado dos campos do alerta — não dentro
    // dele — para o `sw.js` continuar lendo `payload.title` etc. direto, sem
    // reestruturar nada. `iconBase` vazio vira `undefined` e o `JSON.stringify`
    // o omite: um push de loja sem ícone próprio não engorda por um campo inútil.
    payload: JSON.stringify({ ...alert, storeName: branding.storeName, iconBase: branding.iconBase || undefined }),
  };
}

/**
 * Os envelopes que este evento gera. Puro: sem banco, sem rede, sem `io`. É
 * aqui que a redação encontra o push — cada alerta é montado sobre
 * `recipient.order`, a vista do destinatário, nunca sobre o pedido cru.
 */
export function orderPushEnvelopes(
  shopId: ShopId,
  event: OrderAlertEvent,
  order: Order,
  ctx: OrderPushContext = {}
): PushEnvelope[] {
  const envelopes: PushEnvelope[] = [];
  // Uma consulta só para o evento inteiro, não uma por destinatário: um pedido
  // pode ter três ou quatro destinatários (cozinha, cliente, pool de motoboys).
  const branding = pushBrandingFor(shopId);
  for (const recipient of orderAudience(shopId, order)) {
    const alert = orderAlertFor(recipient.role, event, recipient.order, {
      ...ctx,
      // A identidade do motoboy sai da audiência. O pool não tem dono, então
      // vai sem `driverId` e só recebe o alerta de corrida oferecida.
      driverId: recipient.driverId,
    });
    const envelope = envelopeFor(shopId, recipient, alert, branding);
    if (envelope) envelopes.push(envelope);
  }
  return envelopes;
}

/** Mensagem do chat. O motoboy não recebe: `chatAlertFor` já devolve `null`. */
export function chatPushEnvelopes(
  shopId: ShopId,
  order: Order,
  message: ChatMessage
): PushEnvelope[] {
  const envelopes: PushEnvelope[] = [];
  const branding = pushBrandingFor(shopId);
  for (const recipient of orderAudience(shopId, order)) {
    if (recipient.room === driversRoom(shopId)) continue;
    const envelope = envelopeFor(shopId, recipient, chatAlertFor(recipient.role, message), branding);
    if (envelope) envelopes.push(envelope);
  }
  return envelopes;
}

// ---------------------------------------------------------------------------
// Entrega
// ---------------------------------------------------------------------------

function statusCodeOf(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'statusCode' in err) {
    const code = (err as { statusCode?: unknown }).statusCode;
    if (typeof code === 'number') return code;
  }
  return undefined;
}

async function deliver(envelope: PushEnvelope): Promise<void> {
  const { subject, publicKey, privateKey } = vapidKeys();
  if (!publicKey || !privateKey) return;

  const rows = rowsFor(envelope.shopId, envelope.room, envelope.except);
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          JSON.parse(row.data) as webpush.PushSubscription,
          envelope.payload,
          { vapidDetails: { subject, publicKey, privateKey }, TTL: 600 }
        );
      } catch (err) {
        const status = statusCodeOf(err);
        // 404/410 é o serviço de push dizendo que o navegador jogou a inscrição
        // fora. Manter a linha é acumular lixo que falha para sempre e atrasa
        // todo envio seguinte.
        if (status === 404 || status === 410) {
          deletePushSubscription(row.endpoint);
          return;
        }
        console.error('[push] falha ao enviar', envelope.room, status ?? err);
      }
    })
  );
}

/**
 * Dispara e esquece, de propósito e por inteiro.
 *
 * O push é o transporte menos confiável dos dois: depende de um serviço de
 * terceiro que pode estar fora do ar. Se uma falha dele subisse, ela derrubaria
 * o `emitOrder` — e a cozinha perderia o pedido na tela por causa de uma
 * notificação que ninguém ia sentir falta. Nada aqui pode quebrar o socket nem
 * a resposta HTTP: o corpo inteiro é síncrono-seguro e a parte assíncrona vive
 * dentro do próprio try/catch.
 */
export function sendPushEnvelopes(envelopes: PushEnvelope[]): void {
  if (!envelopes.length) return;
  try {
    void (async () => {
      for (const envelope of envelopes) {
        try {
          await deliver(envelope);
        } catch (err) {
          console.error('[push] falha na sala', envelope.room, err);
        }
      }
    })();
  } catch (err) {
    console.error('[push] falha ao despachar', err);
  }
}

export function sendOrderPush(
  shopId: ShopId,
  order: Order,
  event: OrderAlertEvent,
  ctx: OrderPushContext = {}
): void {
  try {
    sendPushEnvelopes(orderPushEnvelopes(shopId, event, order, ctx));
  } catch (err) {
    console.error('[push] falha ao montar o alerta do pedido', err);
  }
}

export function sendChatPush(shopId: ShopId, order: Order, message: ChatMessage): void {
  try {
    sendPushEnvelopes(chatPushEnvelopes(shopId, order, message));
  } catch (err) {
    console.error('[push] falha ao montar o alerta do chat', err);
  }
}
