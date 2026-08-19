import { DeliveryAddress, OpeningHour, StoreSettings } from '../types';

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

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Calcula a taxa de entrega baseada na distância:
 * fee = max(taxaMinima, taxaBase + precoPorKm * km)
 * Retorna -1 se estiver fora da área de entrega (raio máximo).
 */
export function computeDeliveryFee(address: DeliveryAddress, settings: StoreSettings): number {
  const km = effectiveDistanceKm(address, settings);
  if (km <= 0) return 0;
  if (settings.maxDeliveryKm > 0 && km > settings.maxDeliveryKm) return -1;
  const fee = Math.max(
    settings.deliveryMinFee,
    settings.deliveryBaseFee + settings.deliveryPricePerKm * km
  );
  return round2(fee);
}

export function formatKm(km: number): string {
  if (km >= 10) return `${km.toFixed(0)} km`;
  return `${km.toFixed(1)} km`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Verifica se a loja está aberta (chave geral + abertura manual forçada + horário do dia). */
export function isStoreOpen(settings: StoreSettings, date: Date = new Date()): boolean {
  if (!settings.orderEnabled) return false;
  // Abertura manual do dono tem prioridade sobre o horário
  if (settings.forceOpen) return true;
  const day = date.getDay();
  const hours = settings.openingHours?.[day] as OpeningHour | null | undefined;
  if (!hours || !hours.open || !hours.close) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  const open = timeToMinutes(hours.open);
  const close = timeToMinutes(hours.close);
  if (open === close) return true; // 24h
  if (close > open) return now >= open && now < close;
  return now >= open || now < close; // turno que vira a meia-noite
}

export function formatHourRange(hours: OpeningHour | null): string {
  if (!hours) return 'Fechado';
  return `${hours.open} às ${hours.close}`;
}
