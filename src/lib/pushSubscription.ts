import { api, driverApi, kitchenApi, type ApiClient } from './api';
import { appRole, isIos, isStandalone, type AppRole } from './appShell';

/**
 * A última perna do push: quem cria a inscrição DENTRO do navegador.
 *
 * O servidor já sabia enviar (`server/push.ts`) e o service worker já sabia
 * desenhar a notificação (`public/sw.js`), mas ninguém nunca chamava
 * `pushManager.subscribe`. A tabela `push_subscriptions` nascia vazia e ficava
 * vazia: com o app fechado o alerta não saía de lugar nenhum — e é justamente
 * com o app fechado que ele vale alguma coisa. O pedido novo às 21h com a aba
 * da cozinha fechada não tocava para ninguém.
 *
 * Tudo aqui tenta e desiste calado. Push é o transporte extra; o pedido é o
 * produto, e nenhuma falha de notificação pode derrubar a tela.
 */

// ---------------------------------------------------------------------------
// Estado visível para a UI
// ---------------------------------------------------------------------------

export type PushStatus =
  /** Ainda não tentamos nesta sessão. */
  | 'idle'
  /** Inscrito e gravado no servidor. */
  | 'subscribed'
  /** iPhone no navegador: só o app instalado tem `PushManager` (iOS 16.4+). */
  | 'needs-install'
  /** `Notification.permission` não é `granted` — e permissão se pede num gesto. */
  | 'needs-permission'
  /** Navegador sem service worker ou sem push. Não há o que oferecer. */
  | 'unsupported'
  /** Rede fora, servidor recusou, endpoint negado. Tenta de novo na próxima. */
  | 'failed';

export interface PushSubscribeResult {
  status: PushStatus;
  /** Presente só em `subscribed`; útil para depurar qual aparelho gravou. */
  endpoint?: string;
}

export interface PushIdentity {
  role: AppRole;
  /** Só o cliente: a sala do servidor é `customer:<id>`. `anon` é recusado lá. */
  customerId?: string;
}

/**
 * O que este navegador consegue fazer, antes de pedir qualquer coisa.
 *
 * `needs-install` é o caso do iPhone e existe separado de propósito: no Safari
 * do iOS o `PushManager` só aparece quando a página roda como app instalado.
 * Tratar isso como "não suportado" faria o cliente de iPhone ver um botão morto
 * — ou, pior, nada — sem nunca descobrir que bastava adicionar à tela de início.
 */
export function pushAvailability(): 'ready' | 'needs-install' | 'unsupported' {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
    if (!('serviceWorker' in navigator)) return 'unsupported';
    if (!('PushManager' in window)) {
      return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
    }
    return 'ready';
  } catch {
    return 'unsupported';
  }
}

// ---------------------------------------------------------------------------
// Identidade do cliente
// ---------------------------------------------------------------------------

let registeredCustomerId = '';

/**
 * O id do cliente entra por aqui, vindo do app do cliente.
 *
 * `src/lib` não pode importar `src/features` — seria inverter a direção das
 * dependências e amarrar a camada base a uma tela. Quem sabe o id é o app do
 * cliente (`getOrCreateCustomerId`), então ele empurra o valor para cá em vez
 * de este módulo ir buscar. Sem o id o servidor responde 401 e o cliente fica
 * sem push: é o único papel que não tem token para provar quem é.
 */
export function setPushCustomerId(id: string): void {
  const trimmed = id.trim();
  // `anon` é o valor de emergência de `getOrCreateCustomerId` quando não há
  // localStorage. Guardá-lo só geraria um 401 garantido a cada tentativa.
  registeredCustomerId = trimmed === 'anon' ? '' : trimmed;
}

function resolveCustomerId(identity: PushIdentity): string {
  const explicit = identity.customerId?.trim() ?? '';
  const chosen = explicit && explicit !== 'anon' ? explicit : registeredCustomerId;
  return chosen;
}

// ---------------------------------------------------------------------------
// Chave VAPID
// ---------------------------------------------------------------------------

let cachedKey: string | null = null;

async function fetchServerKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  const result = await api.get<{ key?: string }>('/push/key');
  const key = typeof result?.key === 'string' ? result.key.trim() : '';
  // Só o sucesso é guardado: cachear `''` de uma falha de rede deixaria o app
  // sem push até a próxima recarga da página, sem nada explicando por quê.
  if (key) cachedKey = key;
  return key;
}

/**
 * A chave chega em base64 url-safe (é assim que o VAPID a publica) e o
 * `PushManager` só aceita bytes. Passar a string direto é aceito por alguns
 * navegadores e recusado por outros — converter sempre remove a diferença.
 */
function urlBase64ToBytes(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

/**
 * A inscrição guardada foi assinada com a chave pública do dia em que o usuário
 * aceitou. Se o servidor rotacionou o par VAPID, essa inscrição continua
 * existindo no navegador e nunca mais recebe nada — viva por fora, morta por
 * dentro, e sem erro em lugar nenhum. Comparar é o único jeito de perceber.
 *
 * Chave ilegível (alguns navegadores devolvem `null` em `options`) NÃO conta
 * como divergência: refazer a inscrição a cada abertura por falta de prova
 * geraria um endpoint novo por dia e lixo permanente no banco.
 */
function matchesServerKey(subscription: PushSubscription, expected: Uint8Array): boolean {
  try {
    const current = subscription.options?.applicationServerKey;
    if (!current) return true;
    const bytes = new Uint8Array(current);
    if (bytes.length !== expected.length) return false;
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] !== expected[index]) return false;
    }
    return true;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Credencial por papel
// ---------------------------------------------------------------------------

/**
 * A sala é decidida no servidor, pela credencial (ADR-0009). Aqui só escolhemos
 * QUAL credencial acompanha o POST: mandar o token errado põe o motoboy na sala
 * da cozinha — ou deixa a cozinha sem nenhuma.
 */
function apiFor(role: AppRole): ApiClient {
  if (role === 'kitchen') return kitchenApi;
  if (role === 'driver') return driverApi;
  return api;
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

async function registrationFor(): Promise<ServiceWorkerRegistration | null> {
  // `navigator.serviceWorker.ready` NUNCA resolve quando não há registro — e em
  // `vite dev` não há, de propósito. Esperar por ele penduraria a promessa para
  // sempre; `getRegistration` responde `undefined` e a gente segue a vida.
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  if (registration.active) return registration;
  // Existe registro mas ele ainda está instalando: agora `ready` resolve.
  return navigator.serviceWorker.ready;
}

let inFlight: Promise<PushSubscribeResult> | null = null;
let lastStatus: PushStatus = 'idle';

/** O que a última tentativa desta sessão devolveu. */
export function pushStatus(): PushStatus {
  return lastStatus;
}

async function subscribeNow(identity: PushIdentity): Promise<PushSubscribeResult> {
  const availability = pushAvailability();
  if (availability !== 'ready') {
    return { status: availability === 'needs-install' ? 'needs-install' : 'unsupported' };
  }

  // A permissão pertence ao gesto do usuário (`alertChannel.requestSystemPermission`).
  // Pedir daqui, no meio da montagem, é o pedido que o navegador recusa e que o
  // usuário bloqueia — e bloqueio não tem segunda chance.
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return { status: 'needs-permission' };
  }

  const registration = await registrationFor();
  if (!registration) return { status: 'unsupported' };

  const serverKey = await fetchServerKey();
  if (!serverKey) return { status: 'failed' };
  const keyBytes = urlBase64ToBytes(serverKey);

  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !matchesServerKey(subscription, keyBytes)) {
    try {
      await subscription.unsubscribe();
    } catch {
      /* o navegador pode recusar; a inscrição nova por cima resolve do mesmo jeito */
    }
    subscription = null;
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      // Obrigatório no Chrome: sem ele o `subscribe` é recusado. E é honesto —
      // todo push nosso vira notificação visível.
      userVisibleOnly: true,
      applicationServerKey: keyBytes,
    });
  }

  const customerId = resolveCustomerId(identity);
  if (identity.role === 'client' && !customerId) {
    // Sem id não há sala: o servidor devolveria 401 e nós teríamos uma inscrição
    // no navegador que ninguém consegue endereçar.
    return { status: 'failed' };
  }

  // Reenviar uma inscrição que já existia não é desperdício: o navegador guarda
  // a dele para sempre, mas a linha do servidor some num restore de backup ou
  // numa limpeza de endpoints mortos. O servidor faz upsert pelo `endpoint`,
  // então repetir é seguro e é o que conserta a linha perdida.
  await apiFor(identity.role).post<{ ok: boolean; rooms: string[] }>('/push/subscribe', {
    subscription: subscription.toJSON(),
    customerId: customerId || undefined,
  });

  return { status: 'subscribed', endpoint: subscription.endpoint };
}

/**
 * Garante a inscrição deste navegador. Dispara e esquece: nada aqui lança.
 *
 * Chamadas simultâneas compartilham a mesma tentativa — o cliente monta mais de
 * um canal de alerta na mesma página, e duas inscrições em paralelo geram dois
 * endpoints e a notificação chega duas vezes.
 */
export function ensurePushSubscription(identity?: PushIdentity): Promise<PushSubscribeResult> {
  if (inFlight) return inFlight;
  const target: PushIdentity = identity ?? { role: appRole() };

  inFlight = subscribeNow(target)
    .catch((): PushSubscribeResult => ({ status: 'failed' }))
    .then((result) => {
      lastStatus = result.status;
      return result;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * Desfaz a inscrição: primeiro no servidor, depois no navegador.
 *
 * A ordem importa. Apagando primeiro no navegador, o endpoint some da mão antes
 * de chegar ao servidor — e a linha fica lá, recebendo envios que falham para
 * sempre até algum 410 limpar por acaso.
 */
export async function dropPushSubscription(): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;

    await api.post<{ ok: boolean }>('/push/unsubscribe', { endpoint: subscription.endpoint }).catch(() => undefined);
    await subscription.unsubscribe().catch(() => undefined);
    lastStatus = 'idle';
  } catch {
    /* sair sem conseguir desinscrever não pode travar o logout */
  }
}
