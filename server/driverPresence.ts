import { Driver } from '../src/types';

/**
 * Presença do Entregador, lado servidor.
 *
 * "Online é intenção mais um socket vivo" continua valendo — o que mudou é o
 * peso do socket. Ele era um interruptor: o websocket caía, `online` virava
 * `false` na hora e a cozinha perdia o motoboy. Só que o socket cai o tempo
 * todo sem ninguém ir embora — tela bloqueada, celular no bolso, elevador,
 * túnel, troca de 4G para Wi-Fi. Pior: na volta as salas eram refeitas e
 * `online` **não**, então o app do motoboy dizia ONLINE e a cozinha OFFLINE,
 * sem nada reconciliando os dois.
 *
 * Aqui a queda do socket vira uma *suspeita agendada*, não uma sentença, e a
 * volta do motoboy reconcilia a presença a partir da credencial (ADR-0009).
 */

/**
 * Janela de graça entre o socket cair e a presença desligar.
 *
 * Curto demais e a cozinha perde um motoboy em cada semáforo com sinal ruim —
 * eram 8 s, o suficiente só para um reload. Longo demais e a cozinha continua
 * oferecendo corrida para quem já foi pra casa. 75 s cobre um bloqueio de tela,
 * um túnel e uma troca de rede, e ainda tira do quadro quem fechou o app antes
 * do próximo pedido ficar pronto.
 */
export const DRIVER_OFFLINE_GRACE_MS = 75_000;

export type TimerHandle = unknown;

export interface DriverPresenceDeps {
  /** Resolve o dono do token. Nenhum id chega de fora (ADR-0009). */
  resolveDriver: (token: string) => Driver | null;
  loadDriver: (id: string) => Driver | null;
  saveDriver: (driver: Driver) => void;
  /** Quantos sockets ainda estão na sala privada do motoboy. */
  countSessions: (driverId: string) => Promise<number>;
  /** Avisa a cozinha (a lista de motoboys mudou). */
  onPresenceChanged: (driver: Driver) => void;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  graceMs?: number;
}

export interface DriverPresence {
  /**
   * Chegada de um socket de motoboy: resolve o dono pelo token, cancela o
   * desligamento agendado e reconcilia a intenção declarada pelo app.
   * Devolve o motoboy (para quem chamou entrar nas salas) ou `null`.
   */
  join: (token: string, intent: unknown) => Driver | null;
  /** Saída de um socket. Agenda o desligamento se foi a última aba. */
  disconnect: (driverId: string) => Promise<void>;
  /** Executa a decisão agendada. Exposto para o teste não depender do relógio. */
  flush: (driverId: string) => Promise<void>;
  /** Há desligamento agendado para este motoboy? */
  isPending: (driverId: string) => boolean;
}

export function createDriverPresence(deps: DriverPresenceDeps): DriverPresence {
  const graceMs = deps.graceMs ?? DRIVER_OFFLINE_GRACE_MS;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ?? ((handle: TimerHandle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const pending = new Map<string, TimerHandle>();

  function cancelPending(driverId: string): void {
    const handle = pending.get(driverId);
    if (handle === undefined) return;
    clearTimer(handle);
    pending.delete(driverId);
  }

  /**
   * O motoboy é relido antes de gravar: entre a queda do socket e a volta cabe
   * um toque em "ficar offline" pela rota de presença, e escrever o objeto
   * antigo inteiro ressuscitaria o que o motoboy acabou de desligar.
   */
  function setOnline(driverId: string, online: boolean): void {
    const fresh = deps.loadDriver(driverId);
    if (!fresh || !fresh.active) return;
    if (Boolean(fresh.online) === online) return;
    fresh.online = online;
    deps.saveDriver(fresh);
    deps.onPresenceChanged(fresh);
  }

  function join(token: string, intent: unknown): Driver | null {
    const driver = deps.resolveDriver(typeof token === 'string' ? token : '');
    if (!driver) return null;

    // Reload, nova aba ou volta do bolso: cancela o offline agendado pelo
    // disconnect anterior antes de qualquer coisa.
    cancelPending(driver.id);

    // A intenção é **declarada pelo app**, não deduzida da reconexão.
    // Reconectar sozinho não prova nada: o socket também volta para o motoboy
    // que tocou OFFLINE e deixou o app aberto, e ressuscitar a presença dele
    // colocaria de volta no quadro da cozinha alguém que já encerrou o turno.
    // Quem é ele continua vindo do token; só o "ainda estou trabalhando" vem do
    // payload — e isso é estado do próprio app, não identidade.
    if (intent === true) setOnline(driver.id, true);
    else if (intent === false) setOnline(driver.id, false);

    return driver;
  }

  async function flush(driverId: string): Promise<void> {
    pending.delete(driverId);
    // Reconfere: dentro da janela o motoboy pode ter voltado por outra aba sem
    // passar pelo `join` (reconexão que só refez as salas).
    const remaining = await deps.countSessions(driverId);
    if (remaining > 0) return;
    setOnline(driverId, false);
  }

  async function disconnect(driverId: string): Promise<void> {
    if (!driverId) return;
    // O app do motoboy pode ter mais de uma aba aberta; só a última a fechar
    // conta. A sala privada é a contagem certa: ela tem um socket por aba.
    const remaining = await deps.countSessions(driverId);
    if (remaining > 0) return;
    cancelPending(driverId);
    pending.set(
      driverId,
      setTimer(() => {
        void flush(driverId);
      }, graceMs)
    );
  }

  return {
    join,
    disconnect,
    flush,
    isPending: (driverId: string) => pending.has(driverId),
  };
}
