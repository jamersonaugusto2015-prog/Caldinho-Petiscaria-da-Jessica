import type { DeliveryAddress } from '../order/types';
import type { OpeningHour, StoreSettings } from '../shop/types';
import { roundMoney } from './money';
const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Distância em linha reta (haversine) entre dois pontos em km. */
export function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const rawA =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  // Erro de ponto flutuante pode empurrar "a" pra pouco acima de 1 perto de
  // pontos antípodas, o que vira sqrt(negativo) = NaN. Trava em [0, 1].
  const a = Math.min(1, Math.max(0, rawA));
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/** Distância efetiva (com fator de rota) entre a loja e o endereço do cliente. */
export function effectiveDistanceKm(address: DeliveryAddress, settings: StoreSettings): number {
  if (
    typeof address.lat === 'number' &&
    typeof address.lng === 'number' &&
    Number.isFinite(address.lat) &&
    Number.isFinite(address.lng) &&
    Number.isFinite(settings.storeLat) &&
    Number.isFinite(settings.storeLng)
  ) {
    const straight = haversineDistanceKm(settings.storeLat, settings.storeLng, address.lat, address.lng);
    const factor = settings.routeFactor > 0 ? settings.routeFactor : 1.35;
    return Math.round(straight * factor * 100) / 100;
  }
  if (address.distanceKm && address.distanceKm > 0) return address.distanceKm;
  return 0;
}

/**
 * Calcula a taxa de entrega baseada na distância:
 * fee = max(taxaMinima, taxaBase + precoPorKm * km)
 * Retorna -1 se estiver fora da área de entrega (raio máximo).
 *
 * Distância zero NÃO é entrega grátis: `lat`/`lng` vêm do corpo da requisição,
 * e devolver 0 aqui deixava qualquer cliente mandar as coordenadas da própria
 * loja e pedir entrega de graça. Sem distância confiável, vale a taxa mínima.
 */
export function computeDeliveryFee(address: DeliveryAddress, settings: StoreSettings): number {
  const km = Math.max(0, effectiveDistanceKm(address, settings));
  if (settings.maxDeliveryKm > 0 && km > settings.maxDeliveryKm) return -1;
  const fee = Math.max(
    settings.deliveryMinFee,
    settings.deliveryBaseFee + settings.deliveryPricePerKm * km
  );
  // A regra ÚNICA de arredondar dinheiro (money.ts). O `Math.round(n*100)/100`
  // que morava aqui era um segundo dialeto, e discordava dela no meio-centavo.
  return roundMoney(fee);
}

export function formatKm(km: number): string {
  if (km >= 10) return `${km.toFixed(0)} km`;
  return `${km.toFixed(1)} km`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

const DIAS_INTL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Dia da semana e minuto do dia NO FUSO DA LOJA. Fuso inválido gravado no
 * banco não derruba nada: cai no fuso do processo, que era o comportamento
 * antigo. */
function localParts(date: Date, timezone?: string): { day: number; minutes: number } {
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(date);
      const get = (tipo: string) => parts.find((p) => p.type === tipo)?.value ?? '';
      const day = DIAS_INTL.indexOf(get('weekday'));
      // O Intl devolve "24" para meia-noite em alguns motores; o `% 24` normaliza.
      const minutes = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
      if (day >= 0 && Number.isFinite(minutes)) return { day, minutes };
    } catch {
      /* fuso inválido: segue o do processo */
    }
  }
  return { day: date.getDay(), minutes: date.getHours() * 60 + date.getMinutes() };
}

/** Verifica se a loja está aberta (chave geral + abertura manual forçada + horário do dia). */
export function isStoreOpen(settings: StoreSettings, date: Date = new Date()): boolean {
  if (!settings.orderEnabled) return false;
  // Abertura manual do dono tem prioridade sobre o horário
  if (settings.forceOpen) return true;
  // O fuso é o DA LOJA, não o do processo: uma loja de Manaus num servidor
  // em São Paulo abriria e fecharia uma hora fora do combinado.
  const { day, minutes: now } = localParts(date, settings.timezone);
  const horarios = settings.openingHours;

  // O turno de HOJE.
  const hoje = horarios?.[day] as OpeningHour | null | undefined;
  if (hoje && hoje.open && hoje.close) {
    const open = timeToMinutes(hoje.open);
    const close = timeToMinutes(hoje.close);
    if (open === close) return true; // 24h
    if (close > open) {
      if (now >= open && now < close) return true;
    } else if (now >= open || now < close) {
      return true; // turno que vira a meia-noite
    }
  }

  // O turno de ONTEM que atravessou a meia-noite AINDA cobre esta madrugada,
  // mesmo que HOJE não tenha horário próprio. Sem isto, um "sex 23h→sáb 02h"
  // fechava à meia-noite quando sábado estava sem horário: a loja aparecia
  // fechada com a cozinha aberta. Só a parte que cruza (fecha < abre) conta.
  const ontem = horarios?.[(day + 6) % 7] as OpeningHour | null | undefined;
  if (ontem && ontem.open && ontem.close) {
    const open = timeToMinutes(ontem.open);
    const close = timeToMinutes(ontem.close);
    if (close < open && now < close) return true;
  }

  return false;
}

export function formatHourRange(hours: OpeningHour | null): string {
  if (!hours) return 'Fechado';
  return `${hours.open} às ${hours.close}`;
}
