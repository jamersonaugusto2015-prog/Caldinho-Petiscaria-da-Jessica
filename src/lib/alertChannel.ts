import { useEffect, useMemo, useRef } from 'react';
import { expandVibratePattern, type AlertContext, type OrderAlert } from '../shared/orderAlerts';
import type { Order } from '../types';
import { appRole, isIos } from './appShell';
import { ensurePushSubscription, pushStatus, type PushStatus } from './pushSubscription';
import { playNewOrderSound, playOrderMp3, playPhoneBuzzPattern, primeSpeech, resumeAudio, speakPtBr } from './sound';

/**
 * O canal: por onde o alerta sai.
 *
 * A tabela (`src/shared/orderAlerts.ts`) diz *o quê* e *quão alto*. Aqui mora
 * tudo o que o navegador precisa para isso virar barulho: o AudioContext e o
 * destravamento no primeiro toque, o MP3 da loja, a voz, a vibração e a
 * notificação do sistema. Antes disso a escolha entre bipe, MP3 e voz era feita
 * na loja de estado da cozinha — e por isso o cliente e o motoboy não tinham
 * nem som, nem vibração, nem notificação: ninguém tinha copiado o código pra lá.
 *
 * A interface é estreita de propósito: quem alerta chama `deliver` e pronto.
 * `deliver` aceita `null` porque a tabela responde `null` na maioria dos
 * eventos, e obrigar cada chamador a checar isso só espalharia o mesmo `if`.
 */

export interface AlertChannelOptions {
  /** Som ligado? A cozinha tem um botão; cliente e motoboy respondem sempre sim. */
  soundEnabled?: () => boolean;
  /** `settings.orderSoundUrl` — o áudio gravado pela loja, `''` quando não há. */
  customSoundUrl?: () => string;
  /** A faixa dentro do app. Sempre chamada quando `channels.banner` é true. */
  onBanner: (alert: OrderAlert) => void;
  /**
   * Só o cliente. A sala do push dele é `customer:<id>` e ele não tem token
   * para provar quem é — sem o id o servidor recusa a inscrição com 401.
   * Entra por aqui, e não por um import, para `src/lib` não passar a depender
   * de `src/features`.
   */
  customerId?: () => string;
}

export interface AlertCapabilities {
  sound: boolean;
  voice: boolean;
  vibrate: boolean;
  system: boolean;
}

/** `'unsupported'` cobre o navegador sem `Notification` (Safari em iframe, WebView). */
export type SystemPermission = NotificationPermission | 'unsupported';

export interface AlertChannel {
  /** Entrega o alerta por todos os canais que ele pede. `null` não faz nada. */
  deliver(alert: OrderAlert | null): void;
  /** Primeiro gesto do usuário: destrava áudio e voz. Idempotente. */
  unlock(): void;
  /** Só a partir de um gesto explícito — o navegador recusa (e o usuário odeia)
   *  o pedido de permissão feito no carregamento da página. */
  requestSystemPermission(): Promise<SystemPermission>;
  systemPermission(): SystemPermission;
  capabilities(): AlertCapabilities;
  /**
   * Toca o alerta configurado uma vez, sem banner: é o "testar o som".
   *
   * `customUrl` cobre o áudio que a loja acabou de enviar e ainda NÃO salvou:
   * sem ele o botão de teste tocaria o som antigo, e quem gravou um novo teria
   * ouvido o anterior achando que o upload falhou.
   */
  preview(customUrl?: string): void;
  /**
   * Como está a inscrição de push desta sessão. Vale para a UI distinguir
   * "não dá" de "instale o app": no iPhone fora do app instalado não existe
   * `PushManager`, e sem isso a tela não teria o que dizer.
   */
  pushStatus(): PushStatus;
}

// ---------------------------------------------------------------------------
// Deduplicação
// ---------------------------------------------------------------------------

const DELIVERED_KEYS_CAP = 200;

/**
 * Chaves já entregues, no nível do módulo e não da instância: a mesma página
 * pode montar mais de um canal (o cliente tem um no histórico e outro no chat)
 * e os dois precisam concordar que a corrida X já tocou.
 *
 * O `Set` mantém a ordem de inserção, então descartar o primeiro descarta o
 * mais antigo. O limite existe porque um turno de 12 horas na cozinha passaria
 * milhares de chaves por aqui.
 */
const deliveredKeys = new Set<string>();

function firstDelivery(key: string): boolean {
  if (deliveredKeys.has(key)) return false;
  deliveredKeys.add(key);
  if (deliveredKeys.size > DELIVERED_KEYS_CAP) {
    const oldest = deliveredKeys.values().next();
    if (!oldest.done) deliveredKeys.delete(oldest.value);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Destravamento
// ---------------------------------------------------------------------------

let unlockInstalled = false;

function installUnlock(): void {
  if (unlockInstalled || typeof window === 'undefined') return;
  unlockInstalled = true;
  const wake = () => {
    resumeAudio();
    primeSpeech();
    // O Chrome no Android só vibra depois de um gesto. Este 1 ms não se sente;
    // ele "arma" a ativação pegajosa para o próximo alerta de corrida.
    tryVibrate([1]);
  };
  window.addEventListener('pointerdown', wake, { once: true });
  window.addEventListener('keydown', wake, { once: true });
  if (typeof document !== 'undefined') {
    // O iOS suspende o AudioContext quando a aba vai para o fundo e não o
    // devolve sozinho: sem isto, o pedido que chega depois de o motoboy olhar o
    // mapa e voltar para o app chega mudo.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') resumeAudio();
    });
  }
}

// ---------------------------------------------------------------------------
// Capacidades e permissão
// ---------------------------------------------------------------------------

const NO_CAPABILITIES: AlertCapabilities = { sound: false, voice: false, vibrate: false, system: false };

function readCapabilities(): AlertCapabilities {
  if (typeof window === 'undefined') return NO_CAPABILITIES;
  const audio =
    Boolean(window.AudioContext) ||
    Boolean((window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext) ||
    typeof Audio !== 'undefined';
  return {
    sound: audio,
    voice: 'speechSynthesis' in window,
    // Só Android/Chrome. O Safari do iPhone não tem `navigator.vibrate` — e a
    // detecção evita o `TypeError` que derrubaria o resto da entrega junto.
    vibrate: typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function',
    system: 'Notification' in window,
  };
}

function readSystemPermission(): SystemPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  try {
    return Notification.permission;
  } catch {
    return 'unsupported';
  }
}

async function askSystemPermission(): Promise<SystemPermission> {
  if (readSystemPermission() === 'unsupported') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'unsupported';
  }
}

// ---------------------------------------------------------------------------
// Saídas
// ---------------------------------------------------------------------------

/**
 * Chrome 60+ no Android exige gesto do usuário e devolve `false` se recusar.
 * Timer (`setTimeout`) perde essa ativação: um único padrão concatenado é o
 * único chamado que o motor aceita. `0` cancela um padrão em curso.
 */
function tryVibrate(pattern: number[]): boolean {
  if (isIos()) return false;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  try {
    return navigator.vibrate(pattern) !== false;
  } catch {
    return false;
  }
}

/**
 * Android: um `vibrate()` só, padrão já expandido. Se o Chrome recusar (sem
 * toque ainda, DND), cai no buzz do alto-falante. iPhone: só o buzz.
 */
function haptic(pattern: number[], repeat: number): void {
  const rounds = Math.max(1, repeat);
  if (tryVibrate(expandVibratePattern(pattern, rounds))) return;
  playPhoneBuzzPattern(rounds);
}

function notificationOptions(alert: OrderAlert): NotificationOptions {
  const demand = alert.urgency === 'demand';
  const vibrate =
    demand && alert.channels.vibrate
      ? expandVibratePattern(alert.channels.vibrate, alert.channels.repeat)
      : undefined;
  // `vibrate` existe no Chrome Android e não no lib DOM do TypeScript.
  return {
    body: alert.body,
    // A nova substitui a anterior do mesmo pedido: cinco atualizações de uma
    // corrida viram uma linha na gaveta, não cinco.
    tag: alert.tag,
    data: { href: alert.href, orderId: alert.orderId, key: alert.key },
    // `silent` + `vibrate` juntos o Chrome recusa a notificação inteira.
    silent: demand ? false : true,
    vibrate,
    requireInteraction: demand,
  } as NotificationOptions;
}

async function showSystemNotification(alert: OrderAlert): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (readSystemPermission() !== 'granted') return;
  // Notificação com a pessoa olhando a tela é ruído: o banner já cobre esse caso.
  if (document.visibilityState === 'visible') return;

  const options = notificationOptions(alert);
  try {
    // Com um service worker no comando, a notificação sobrevive à aba fechada e
    // o clique cai no `notificationclick` dele. Sem ele, `new Notification` é o
    // que há — e o Safari chega a lançar aqui, por isso o try/catch envolve tudo.
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(alert.title, options);
      return;
    }
    const notification = new Notification(alert.title, options);
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        /* ignora */
      }
      notification.close();
    };
  } catch {
    /* sem notificação do sistema — o banner e o som já saíram */
  }
}

// ---------------------------------------------------------------------------
// A fábrica
// ---------------------------------------------------------------------------

export function createAlertChannel(options: AlertChannelOptions): AlertChannel {
  const soundEnabled = () => options.soundEnabled?.() ?? true;
  const customSoundUrl = () => options.customSoundUrl?.().trim() ?? '';

  const playSound = (repeat: number, custom: string) => {
    if (custom) playOrderMp3(custom, repeat);
    else playNewOrderSound(repeat);
  };

  /**
   * A permissão concedida é o gatilho da inscrição de push, e o gatilho mora
   * aqui de propósito: o canal já é o dono da permissão e já sabe o papel pela
   * URL (`appRole`). Deixar cada app chamar isso daria três lugares para
   * esquecer — foi exatamente assim que o cliente e o motoboy ficaram sem som
   * antes deste módulo existir.
   */
  const syncPush = () => {
    void ensurePushSubscription({ role: appRole(), customerId: options.customerId?.() });
  };

  return {
    deliver(alert) {
      if (!alert) return;
      if (!firstDelivery(alert.key)) return;

      const { channels } = alert;
      if (channels.banner) options.onBanner(alert);

      const custom = customSoundUrl();
      const audible = soundEnabled();
      if (channels.sound && audible) playSound(channels.repeat, custom);
      // A voz cede o lugar ao áudio da loja: quem gravou o próprio alerta não
      // quer a locutora falando por cima dele.
      if (channels.voice && audible && !custom) speakPtBr(alert.title, channels.repeat);

      if (channels.vibrate) haptic(channels.vibrate, channels.repeat);
      if (channels.system) void showSystemNotification(alert);
    },
    unlock() {
      installUnlock();
      // Permissão já concedida numa visita anterior não dispara evento nenhum:
      // sem tentar na montagem, quem aceitou ontem ficaria para sempre com a
      // permissão ligada e sem nenhuma inscrição gravada no servidor.
      syncPush();
    },
    async requestSystemPermission() {
      const permission = await askSystemPermission();
      if (permission === 'granted') syncPush();
      return permission;
    },
    systemPermission: readSystemPermission,
    capabilities: readCapabilities,
    pushStatus,
    preview(customUrl) {
      resumeAudio();
      const custom = customUrl?.trim() || customSoundUrl();
      if (custom) {
        playOrderMp3(custom, 1);
        return;
      }
      playNewOrderSound();
      speakPtBr('Um novo pedido chegou!');
    },
  };
}

/**
 * O canal de um papel, criado uma vez e destravado na montagem.
 *
 * As opções entram por ref porque o canal é chamado de dentro de handlers de
 * socket: recriar o canal a cada render devolveria um `Set` de deduplicação
 * vazio e o mesmo pedido tocaria de novo a cada re-render.
 */
export function useAlertChannel(options: AlertChannelOptions): AlertChannel {
  const latest = useRef(options);
  latest.current = options;

  const channel = useMemo(
    () =>
      createAlertChannel({
        soundEnabled: () => latest.current.soundEnabled?.() ?? true,
        customSoundUrl: () => latest.current.customSoundUrl?.() ?? '',
        customerId: () => latest.current.customerId?.() ?? '',
        onBanner: (alert) => latest.current.onBanner(alert),
      }),
    []
  );

  useEffect(() => {
    channel.unlock();
  }, [channel]);

  return channel;
}

// ---------------------------------------------------------------------------
// Memória do pedido
// ---------------------------------------------------------------------------

/**
 * O que sabíamos do pedido antes deste evento.
 *
 * A tabela precisa do estado anterior para saber se a notícia é nova — se o
 * status mudou, se o cancelamento já estava pendente. Ler isso do estado do
 * React chegaria atrasado: dois `order:updated` no mesmo tick veriam a mesma
 * lista velha. Um ref atualizado na hora é a única leitura confiável.
 */
export interface AlertMemory {
  contextFor(order: Order): AlertContext;
  remember(order: Order): void;
  seed(orders: Order[]): void;
}

function snapshot(order: Order): AlertContext {
  return {
    previousStatus: order.status,
    hadPendingCancelRequest: order.cancellationRequest?.status === 'pendente',
    hadOpenComplaint: order.complaint?.status === 'aberta',
  };
}

export function createAlertMemory(): AlertMemory {
  const seen = new Map<string, AlertContext>();
  return {
    contextFor(order) {
      return seen.get(order.id) ?? {};
    },
    remember(order) {
      seen.set(order.id, snapshot(order));
    },
    seed(orders) {
      seen.clear();
      orders.forEach((order) => seen.set(order.id, snapshot(order)));
    },
  };
}

export function useAlertMemory(): AlertMemory {
  return useMemo(createAlertMemory, []);
}
