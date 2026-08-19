import { DeliveryAddress, Fulfillment, Order, StoreSettings } from '../types';

/** Pedido antigo não tem o campo: sem ele, o pedido sempre foi de entrega. */
export function isPickup(order: Pick<Order, 'fulfillment'> | { fulfillment?: Fulfillment }): boolean {
  return order.fulfillment === 'pickup';
}

export function normalizeFulfillment(value: unknown): Fulfillment {
  return value === 'pickup' ? 'pickup' : 'delivery';
}

export const FULFILLMENT_LABEL: Record<Fulfillment, string> = {
  delivery: 'Entrega',
  pickup: 'Retirada na loja',
};

/** Linha de endereço da loja para quem vai retirar o pedido. */
export function storeAddressLine(settings: Pick<StoreSettings, 'storeAddress' | 'city' | 'storeName'>): string {
  const street = (settings.storeAddress || '').trim();
  const city = (settings.city || '').trim();
  if (street && city) return `${street} — ${city}`;
  return street || city || settings.storeName;
}

/**
 * Um pedido de retirada não tem endereço do cliente, mas o resto do app (cozinha, recibo,
 * mapa) lê `order.address`. Guardamos o endereço da própria loja no lugar.
 */
export function pickupAddress(
  settings: Pick<StoreSettings, 'storeAddress' | 'city' | 'storeName' | 'storeLat' | 'storeLng'>
): DeliveryAddress {
  return {
    id: 'retirada-loja',
    label: 'Retirada na loja',
    street: (settings.storeAddress || '').trim() || settings.storeName,
    number: '',
    neighborhood: '',
    city: settings.city,
    lat: settings.storeLat,
    lng: settings.storeLng,
    distanceKm: 0,
  };
}
