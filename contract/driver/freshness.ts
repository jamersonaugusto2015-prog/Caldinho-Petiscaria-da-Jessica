/**
 * Idade da posição do motoboy — a regra, num lugar só.
 *
 * `lat`/`lng` sozinhos não dizem *quando*. Com a tela do celular apagada o
 * `watchPosition` para de entregar pontos sem dar erro nenhum, e o último ponto
 * continuava no mapa do cliente com exatamente a mesma cara de um ponto ao vivo:
 * o cliente ficava dez minutos olhando uma moto parada sem saber se era trânsito
 * ou GPS morto.
 *
 * A regra nasceu no servidor (`server/driverLocation.ts`), mas o navegador não
 * pode importar de `server/`. Copiá-la para a tela seria exatamente o erro que
 * este trabalho todo veio desfazer — duas cópias da mesma ideia, livres para
 * discordar sobre quando um ponto envelhece. Então ela mora aqui, na zona pura
 * que os dois lados já dividem (o `server/orderEvents.ts` já importa de
 * `../src/shared/fulfillment`), e cozinha, cliente e servidor leem daqui.
 */

/**
 * Idade a partir da qual o pino é "último ponto conhecido", não "onde ele está".
 * O watch do app tem timeout de 20 s e manda um ponto de vida a cada ~25 s mesmo
 * parado; 60 s de silêncio já são três batidas perdidas — não é semáforo, é a
 * tela apagada ou o GPS mudo.
 */
export const LOCATION_STALE_AFTER_MS = 60_000;

export type LocationFreshness = 'live' | 'stale' | 'unknown';

/** Instante em que a posição foi tomada, em ms. `null` = ponto sem idade. */
export function parseTakenAt(takenAt: string | undefined | null): number | null {
  if (typeof takenAt !== 'string') return null;
  const ms = new Date(takenAt).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * `unknown` é de propósito o veredito de um ponto sem carimbo: são as linhas
 * gravadas antes deste campo existir e a posição semeada no `assign` (um chute,
 * não um fixo). Um pino de idade desconhecida nunca pode ser desenhado como se
 * fosse ao vivo — ausência de carimbo não é prova de frescor.
 */
export function locationFreshness(
  takenAt: string | undefined | null,
  now: number = Date.now()
): LocationFreshness {
  const at = parseTakenAt(takenAt);
  if (at === null) return 'unknown';
  return now - at <= LOCATION_STALE_AFTER_MS ? 'live' : 'stale';
}

/**
 * A idade em palavras, para as três telas dizerem a mesma coisa.
 *
 * Devolve `null` quando não há carimbo: quem chama tem de escolher outra frase,
 * porque "há 0 min" seria inventar um frescor que ninguém mediu. Relógio do
 * cliente adiantado dá diferença negativa — vira "agora", nunca "há -2 min".
 */
export function locationAgeLabel(
  takenAt: string | undefined | null,
  now: number = Date.now()
): string | null {
  const at = parseTakenAt(takenAt);
  if (at === null) return null;
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `há ${hours} h`;
}
