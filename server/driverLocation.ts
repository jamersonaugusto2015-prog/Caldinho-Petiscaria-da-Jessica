import type { Driver } from '../contract/driver/types';
import type { Order } from '../contract/order/types';
import { LOCATION_STALE_AFTER_MS, locationFreshness as freshnessOf, parseTakenAt, type LocationFreshness } from '../contract/driver/freshness';
/**
 * Localização do Entregador, lado servidor — o par do `useDriverLocation` do app.
 *
 * A ADR-0005 aprofundou o lado do navegador e deixou o servidor raso: o ponto de
 * GPS chegava por um handler de socket sem dono, era gravado em dois lugares
 * (a linha do motoboy e o pedido) e reemitido duas vezes, uma delas para um
 * evento que ninguém escuta. Aqui a política de rastreamento tem um dono só.
 *
 * A posição também passa a ser lembrada: o `assign` semeava a corrida com a
 * coordenada da LOJA mesmo quando o servidor já sabia onde o motoboy estava,
 * então o cliente via o motoboy parado na loja até ele andar o suficiente para
 * vencer a deduplicação do app.
 *
 * E toda posição passa a ter idade. `lat`/`lng` sozinhos não dizem *quando*:
 * com a tela bloqueada o `watchPosition` do celular simplesmente para de
 * entregar pontos, e o último ponto continuava no mapa do cliente com a mesma
 * cara de um ponto ao vivo. O carimbo é o que separa "está ali" de "estava ali".
 */

export interface DriverLocationDeps {
  loadDriver: (id: string) => Driver | null;
  saveDriver: (driver: Driver) => void;
  listOrdersByStatus: (status: string) => Order[];
  /** Aplica a regra de domínio do movimento (orderLifecycle) e persiste. */
  applyMove: (order: Order, driverId: string, lat: number, lng: number, at: string) => Order;
}

export interface Coordinate {
  lat: number;
  lng: number;
}

/**
 * O motoboy gravado é um documento JSON (`drivers.data`), então o carimbo cabe
 * na linha existente sem migração e sem inventar tabela. Fica declarado aqui,
 * junto de quem escreve o campo, em vez de virar mais um `?` no `Driver` que a
 * cozinha inteira precisa entender. `publicDriver` copia o resto do documento,
 * então o carimbo chega à cozinha pelo mesmo caminho de sempre.
 */
export type LocatedDriver = Driver & { locationAt?: string };

/**
 * A idade a partir da qual o pino é "último ponto conhecido" mora em
 * `src/shared/driverFreshness.ts`, junto da regra que a lê. Servidor, mapa do
 * cliente e lista da cozinha respondem a mesma pergunta — enquanto cada um
 * tinha a sua cópia do número, bastava um deles mudar para o cliente ver o pino
 * apagar num instante e a cozinha em outro. Reexportado porque quem já importa
 * daqui não precisa saber que a regra se mudou.
 */
export { LOCATION_STALE_AFTER_MS };
export type { LocationFreshness };

/**
 * De quanto em quanto tempo o carimbo é renovado quando o motoboy não saiu do
 * lugar. Sem isso o motoboy parado no farol apareceria "sem sinal" na cozinha;
 * renovando a cada ponto, um motoboy em rua daria uma escrita a cada segundo.
 */
export const LOCATION_TOUCH_MS = 30_000;

/** Quando a posição gravada foi tomada, em ms. `null` = ponto sem idade. */
export function locationTakenAt(driver: Driver | null | undefined): number | null {
  return parseTakenAt((driver as LocatedDriver | null | undefined)?.locationAt);
}

/**
 * `unknown` é de propósito o veredito de um ponto sem carimbo: são as linhas
 * gravadas antes deste campo existir, e um pino de idade desconhecida nunca
 * pode ser desenhado como se fosse ao vivo.
 */
export function locationFreshness(
  driver: Driver | null | undefined,
  now: number = Date.now()
): LocationFreshness {
  // Sem coordenada não há o que envelhecer.
  if (!lastKnownPosition(driver)) return 'unknown';
  return freshnessOf((driver as LocatedDriver | null | undefined)?.locationAt, now);
}

/** Um `lat` de 1e12 entrava no banco e no mapa. Fora da faixa não é posição. */
export function isValidCoordinate(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function lastKnownPosition(driver: Driver | null | undefined): Coordinate | null {
  if (!driver) return null;
  return isValidCoordinate(driver.lat, driver.lng)
    ? { lat: driver.lat as number, lng: driver.lng as number }
    : null;
}

/**
 * Grava o ponto e devolve as corridas que se moveram, para quem chamou emitir.
 *
 * O motoboy é relido antes de gravar: entre a leitura do socket e a gravação
 * cabe um toque em "ficar offline", e escrever o objeto antigo inteiro ressuscita
 * a presença que o motoboy acabou de desligar.
 */
export function recordDriverLocation(
  driverId: string,
  lat: unknown,
  lng: unknown,
  deps: DriverLocationDeps,
  now: number = Date.now()
): Order[] {
  if (!driverId || !isValidCoordinate(lat, lng)) return [];

  const driver = deps.loadDriver(driverId) as LocatedDriver | null;
  if (!driver || !driver.active) return [];

  const moved: Order[] = [];
  // O mesmo instante vai para o pedido e para o motoboy: dois relógios para o
  // mesmo ponto deixariam o pino da cozinha e o do cliente discordando sobre há
  // quanto tempo ele está parado.
  const takenIso = new Date(now).toISOString();
  for (const order of deps.listOrdersByStatus('saiu_entrega')) {
    if (order.driverId !== driverId) continue;
    try {
      moved.push(deps.applyMove(order, driverId, lat as number, lng as number, takenIso));
    } catch {
      // A corrida pode ter sido entregue ou cancelada entre a leitura e o ponto.
    }
  }

  // Parado também é notícia: o motoboy no farol manda o mesmo ponto, e sem
  // renovar o carimbo ele apareceria "sem sinal" na cozinha. Mas renovar a cada
  // ponto seria uma escrita por segundo por motoboy em rua — daí a janela.
  const takenAt = locationTakenAt(driver);
  const movedPin = driver.lat !== lat || driver.lng !== lng;
  const staleStamp = takenAt === null || now - takenAt >= LOCATION_TOUCH_MS;

  if (movedPin || staleStamp) {
    driver.lat = lat as number;
    driver.lng = lng as number;
    driver.locationAt = takenIso;
    deps.saveDriver(driver);
  }

  return moved;
}
