import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '../../lib/socket';
import { subscribePageLifecycle } from '../../lib/pageLifecycle';

const MOVEMENT_THRESHOLD_DEG = 0.00015;
const WATCH_TIMEOUT_MS = 20000;

/**
 * Mesmo parado, o app manda um ponto a cada 25 s. Ele é o "estou vivo" do
 * watch: sem ele o servidor não tem como distinguir o motoboy no farol do
 * motoboy cujo GPS calou — os dois mandam nada.
 */
const HEARTBEAT_MS = 25000;

/**
 * Silêncio maior que o dobro do timeout do watch não é demora de fixo, é watch
 * parado. É o que acontece quando a tela apaga: o navegador suspende o
 * `watchPosition` sem nunca chamar o callback de erro, e o app seguia dizendo
 * `active` com o cliente vendo um pino congelado.
 */
const QUIET_AFTER_MS = 45000;
const QUIET_CHECK_MS = 10000;

/** Recomeço do watch depois de timeout/indisponível, sem martelar a bateria. */
const RESTART_BACKOFF_MS = [5000, 15000, 30000, 60000];

export type DriverLocationStatus =
  | 'idle'
  | 'active'
  | 'denied'
  | 'unavailable'
  | 'searching'
  /** O watch está de pé mas calou: o que o cliente vê é o último ponto. */
  | 'stale';

export interface DriverLocationHandle {
  status: DriverLocationStatus;
  /** Quando chegou o último fixo, em ms. `null` = nenhum ainda. */
  lastFixAt: number | null;
  start: () => void;
  stop: () => void;
}

/**
 * Owns the geolocation adapter for the driver app: one watch, movement dedup and
 * explicit error classification, so callers only ever start/stop tracking.
 *
 * `driverId` não vai mais no emit (a identidade vem da sessão do socket); ele fica
 * só como porteiro: sem perfil carregado ainda não há sessão, então não emitimos.
 *
 * O watch não pode mentir. Antes ele mentia de dois jeitos: um `TIMEOUT` (20 s
 * sem fixo, coisa de garagem e de viaduto) travava em `unavailable` para sempre,
 * já que nada reiniciava o watch; e o watch suspenso pela tela bloqueada
 * continuava reportando `active`, sem faixa nenhuma na tela do motoboy.
 */
export function useDriverLocation(driverId: string | undefined): DriverLocationHandle {
  const [status, setStatus] = useState<DriverLocationStatus>('idle');
  const [lastFixAt, setLastFixAt] = useState<number | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastEmitAtRef = useRef(0);
  const lastFixAtRef = useRef<number | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const wantedRef = useRef(false);
  const driverIdRef = useRef(driverId);
  driverIdRef.current = driverId;

  // Declarados antes de `beginWatch` porque o callback de erro do watch precisa
  // reiniciar o watch — e quem reinicia é definido depois dele.
  const scheduleRestartRef = useRef<() => void>(() => {});
  const beginWatchRef = useRef<() => void>(() => {});

  const clearWatch = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (restartTimerRef.current != null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const emitPoint = useCallback((lat: number, lng: number, volatile: boolean) => {
    // Sem perfil carregado a sessão do socket ainda não vale: não emite.
    if (!driverIdRef.current) return;
    lastEmitAtRef.current = Date.now();
    // Volatile no fluxo: uma rajada segurada durante uma queda voltaria como
    // rota velha fingindo ser atual. A exceção é o ponto de recuperação da
    // reconexão (abaixo), que é um só e é o mais novo que temos.
    if (volatile) socket.volatile.emit('driver:location', { lat, lng });
    else socket.emit('driver:location', { lat, lng });
  }, []);

  const beginWatch = useCallback(() => {
    if (watchIdRef.current != null) return;
    if (!navigator.geolocation) {
      setStatus('unavailable');
      return;
    }
    // Recriar o watch não é notícia boa por si só: manter o aviso que já estava
    // na tela evita a faixa piscar a cada tentativa do backoff.
    setStatus((previous) =>
      previous === 'stale' || previous === 'unavailable' ? previous : 'searching'
    );
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        attemptRef.current = 0;
        lastFixAtRef.current = now;
        setLastFixAt(now);
        setStatus('active');
        const { latitude: lat, longitude: lng } = pos.coords;
        const last = lastPosRef.current;
        const still =
          last &&
          Math.abs(last.lat - lat) < MOVEMENT_THRESHOLD_DEG &&
          Math.abs(last.lng - lng) < MOVEMENT_THRESHOLD_DEG;
        lastPosRef.current = { lat, lng };
        // Parado ainda vale um ponto de vez em quando: é o que renova a idade
        // da posição no servidor e tira o motoboy de "sem sinal" na cozinha.
        if (still && now - lastEmitAtRef.current < HEARTBEAT_MS) return;
        emitPoint(lat, lng, true);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          // Único erro terminal: nenhuma tentativa nossa vira permissão.
          clearWatch();
          setStatus('denied');
          return;
        }
        // TIMEOUT não é "sem GPS", é "ainda sem fixo": prédio, garagem, túnel.
        // Latir `unavailable` aqui — e nunca mais reiniciar o watch — deixava o
        // motoboy invisível pro cliente pelo resto da corrida.
        setStatus(
          err.code === err.TIMEOUT
            ? lastFixAtRef.current
              ? 'stale'
              : 'searching'
            : 'unavailable'
        );
        scheduleRestartRef.current();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: WATCH_TIMEOUT_MS }
    );
  }, [clearWatch, emitPoint]);

  beginWatchRef.current = beginWatch;

  /**
   * Alguns Android nunca voltam a entregar posição num watch que deu timeout ou
   * que a tela apagou: o handle continua vivo e mudo. Recriar é o que traz o
   * fixo de volta — com espera crescente para não fritar a bateria.
   */
  const scheduleRestart = useCallback(() => {
    if (!wantedRef.current || restartTimerRef.current != null) return;
    const wait = RESTART_BACKOFF_MS[Math.min(attemptRef.current, RESTART_BACKOFF_MS.length - 1)];
    attemptRef.current += 1;
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      if (!wantedRef.current) return;
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      beginWatchRef.current();
    }, wait);
  }, []);

  scheduleRestartRef.current = scheduleRestart;

  const start = useCallback(() => {
    wantedRef.current = true;
    attemptRef.current = 0;
    beginWatchRef.current();
  }, []);

  const stop = useCallback(() => {
    wantedRef.current = false;
    clearWatch();
    lastPosRef.current = null;
    lastFixAtRef.current = null;
    attemptRef.current = 0;
    setLastFixAt(null);
    setStatus('idle');
  }, [clearWatch]);

  /** O watch calou? Ninguém avisa — só dá pra perceber pelo relógio. */
  const checkQuiet = useCallback(() => {
    if (!wantedRef.current || watchIdRef.current == null) return;
    const last = lastFixAtRef.current;
    if (last == null || Date.now() - last <= QUIET_AFTER_MS) return;
    setStatus((previous) => (previous === 'denied' ? previous : 'stale'));
    scheduleRestartRef.current();
  }, []);

  useEffect(() => {
    const id = window.setInterval(checkQuiet, QUIET_CHECK_MS);
    return () => window.clearInterval(id);
  }, [checkQuiet]);

  // Voltar pra frente é o momento em que dá pra confiar no relógio de novo: com
  // a aba oculta o próprio `setInterval` acima é estrangulado, então a checagem
  // que importa é esta.
  useEffect(
    () =>
      subscribePageLifecycle((state) => {
        if (state !== 'foreground') return;
        checkQuiet();
      }),
    [checkQuiet]
  );

  // Recuperação na reconexão: um ponto só, não a rajada. O último ponto vale
  // mais que o silêncio — sem ele o mapa do cliente retomava de uma coordenada
  // de minutos atrás, porque tudo que foi emitido com o socket fora se perdeu.
  useEffect(() => {
    const onConnect = () => {
      const last = lastPosRef.current;
      if (!last || !wantedRef.current) return;
      emitPoint(last.lat, last.lng, false);
    };
    socket.on('connect', onConnect);
    return () => {
      socket.off('connect', onConnect);
    };
  }, [emitPoint]);

  useEffect(() => stop, [stop]);

  return { status, lastFixAt, start, stop };
}

/**
 * Mantém a tela acesa enquanto há corrida na rua.
 *
 * Tela apagada é `watchPosition` suspenso e websocket caído — o motoboy some do
 * mapa do cliente no meio do trajeto. Não existe pedido de permissão para wake
 * lock, mas existe navegador sem a API (Safari antigo) e existe negativa do SO
 * (bateria baixa), então tudo aqui é silencioso: falhou, ficou como antes.
 *
 * O lock é solto pelo navegador toda vez que a página é escondida; por isso ele
 * é pedido de novo ao voltar pra frente.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const acquire = async () => {
      if (released || sentinel || document.visibilityState !== 'visible') return;
      try {
        sentinel = await navigator.wakeLock.request('screen');
        sentinel.addEventListener('release', () => {
          sentinel = null;
        });
      } catch {
        // Bateria baixa, aba em segundo plano ou navegador sem suporte de fato:
        // seguir sem o lock é pior, mas quebrar a tela do motoboy é bem pior.
      }
    };

    void acquire();
    const unsubscribe = subscribePageLifecycle((state) => {
      if (state === 'foreground') void acquire();
    });

    return () => {
      released = true;
      unsubscribe();
      const held = sentinel;
      sentinel = null;
      void held?.release().catch(() => {});
    };
  }, [enabled]);
}
