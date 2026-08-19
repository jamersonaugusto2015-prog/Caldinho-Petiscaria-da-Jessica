import { DeliveryAddress } from '../types';

export function isUsableAddress(addr?: Partial<DeliveryAddress> | null): boolean {
  if (!addr) return false;
  const street = typeof addr.street === 'string' ? addr.street.trim() : '';
  const number = typeof addr.number === 'string' ? addr.number.trim() : '';
  return (
    street.length > 0 &&
    number.length > 0 &&
    typeof addr.lat === 'number' &&
    Number.isFinite(addr.lat) &&
    typeof addr.lng === 'number' &&
    Number.isFinite(addr.lng)
  );
}

export function formatAddressLine(addr?: Partial<DeliveryAddress> | null): string {
  if (!addr) return '';
  const street = typeof addr.street === 'string' ? addr.street.trim() : '';
  const number = typeof addr.number === 'string' ? addr.number.trim() : '';
  const neighborhood = typeof addr.neighborhood === 'string' ? addr.neighborhood.trim() : '';
  const label = typeof addr.label === 'string' ? addr.label.trim() : '';
  if (!street) return '';
  const line = [street, number].filter(Boolean).join(', ');
  const place = [label, neighborhood].filter(Boolean).join(' · ');
  return place ? `${place} — ${line}` : line;
}
