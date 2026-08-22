/**
 * Números que valem uma regra de negócio e que os dois lados precisam saber.
 *
 * Estavam escondidos no meio de `src/types.ts` (um arquivo de tipos) e de
 * `src/shared/constants.ts` (um arquivo de mensagens). Regra de negócio
 * escondida em arquivo de tipo é regra que ninguém acha quando precisa mudar.
 */

/** Minutos que a cozinha tem para responder um pedido de cancelamento. */
export const CANCEL_REQUEST_RESPONSE_MINUTES = 5;

/** Horas que o cliente tem para reclamar, contadas da criação do pedido. */
export const COMPLAINT_WINDOW_HOURS = 24;

/** Selos para resgatar 1 item grátis. */
export const LOYALTY_STAMP_COST = 10;
