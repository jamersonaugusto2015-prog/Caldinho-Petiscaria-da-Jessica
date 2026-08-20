import { useSyncExternalStore } from 'react';

/**
 * Ciclo de vida da página — o terceiro sinal da presença do motoboy.
 *
 * Até aqui a única coisa no app que reparava na página ir pra trás era o
 * `socket.ts`, e ele reagia do único jeito que sabia: reconectar. Presença
 * virou efeito colateral do transporte — o motoboy guardava o celular no
 * bolso, o websocket caía, a cozinha marcava OFFLINE e o app do motoboy
 * continuava dizendo ONLINE, sem ninguém para reconciliar os dois.
 *
 * Tela bloqueada é **background**, não **offline**. São coisas diferentes:
 * - `background` — a aba está oculta/congelada. O navegador estrangula timers,
 *   pode suspender o `watchPosition` e derrubar o websocket. A intenção do
 *   motoboy não mudou: ele continua trabalhando.
 * - `offline` — o SO diz que não há rede. Também não muda a intenção, mas aqui
 *   nem adianta tentar falar com o servidor.
 * - `foreground` — a aba está na frente e com rede: hora de reconectar e de
 *   reconferir com o servidor tudo que pode ter mudado enquanto estávamos fora.
 *
 * Um dono só para a pergunta "onde a página está?", e quem precisa (transporte,
 * presença, GPS) apenas escuta.
 */
export type PageLifecycle = 'foreground' | 'background' | 'offline';

type Listener = (state: PageLifecycle) => void;

const listeners = new Set<Listener>();

function readLifecycle(): PageLifecycle {
  // `navigator.onLine === false` é a única resposta confiável dessa API: o
  // `true` mente com frequência (Wi-Fi de padaria sem saída). Por isso só o
  // negativo vira estado; o positivo é apenas "não sabemos que caiu".
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return 'background';
  return 'foreground';
}

let current: PageLifecycle = readLifecycle();

function publish(next: PageLifecycle): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener(next);
}

const refresh = () => publish(readLifecycle());

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', refresh);
  // `pagehide` é o único aviso que o iOS dá antes de congelar a aba: em
  // Safari/iOS o `visibilitychange` pode não chegar quando o app vai pro
  // fundo pelo botão home ou pela tela de bloqueio.
  window.addEventListener('pagehide', () => publish('background'));
  window.addEventListener('pageshow', refresh);
  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
}

export function pageLifecycle(): PageLifecycle {
  return current;
}

/** Devolve a função que cancela a inscrição. */
export function subscribePageLifecycle(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const subscribeSnapshot = (onChange: () => void) => subscribePageLifecycle(() => onChange());
const serverSnapshot = (): PageLifecycle => 'foreground';

export function usePageLifecycle(): PageLifecycle {
  return useSyncExternalStore(subscribeSnapshot, pageLifecycle, serverSnapshot);
}
