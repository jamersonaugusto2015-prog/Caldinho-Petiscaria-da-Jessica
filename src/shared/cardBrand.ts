export type Brand = 'visa' | 'master' | 'amex' | 'elo' | 'hipercard' | 'unknown';

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

// Elo e Hipercard compartilham prefixos com Visa e Amex (ex.: 4011 é Elo, 3841 é
// Hipercard), então as bandeiras nacionais têm que ser testadas primeiro.
export function detectBrand(digits: string): Brand {
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(digits)) {
    return 'elo';
  }
  if (/^(606282|3841)/.test(digits)) return 'hipercard';
  if (/^4/.test(digits)) return 'visa';
  if (/^3[47]/.test(digits)) return 'amex';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'master';
  return 'unknown';
}

export function formatNumber(digits: string, brand: Brand): string {
  if (brand === 'amex') {
    return [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)].filter(Boolean).join(' ');
  }
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

export function formatExpiry(digits: string): string {
  const mm = digits.slice(0, 2);
  const yy = digits.slice(2, 4);
  if (digits.length <= 2) return mm;
  return `${mm}/${yy}`;
}

export const BRAND_FACE: Record<Brand, { bg: string; ink: string; muted: string; label: string }> = {
  visa: { bg: '#1B2A4A', ink: '#F5F0E6', muted: '#C4B8A4', label: 'VISA' },
  master: { bg: '#1C1917', ink: '#F5F5F4', muted: '#A8A29E', label: 'mastercard' },
  amex: { bg: '#0F3D6E', ink: '#F4F7FB', muted: '#B7C7D9', label: 'AMEX' },
  elo: { bg: '#2A1810', ink: '#F8EFE4', muted: '#C9B29A', label: 'elo' },
  hipercard: { bg: '#5C1212', ink: '#FDECEC', muted: '#E8B4B4', label: 'HIPERCARD' },
  unknown: { bg: '#7F1D1D', ink: '#FAF6F1', muted: '#E7C8C8', label: 'CARTÃO' },
};
