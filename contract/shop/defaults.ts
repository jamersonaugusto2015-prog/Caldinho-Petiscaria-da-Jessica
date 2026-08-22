import type { SizeOption } from '../catalog/types';
import type { OpeningHour, StoreSettings } from './types';
export const DEFAULT_SIZE_OPTIONS: SizeOption[] = [
  { label: 'Pequeno (300ml)', priceDelta: 0 },
  { label: 'Médio (500ml)', priceDelta: 4.0 },
  { label: 'Grande (700ml na Garrafa)', priceDelta: 9.0 },
];

export const DEFAULT_OPENING_HOURS: (OpeningHour | null)[] = [
  { open: '17:00', close: '23:00' }, // domingo
  { open: '18:00', close: '23:00' }, // segunda
  { open: '18:00', close: '23:00' }, // terça
  { open: '18:00', close: '23:00' }, // quarta
  { open: '18:00', close: '23:30' }, // quinta
  { open: '18:00', close: '23:30' }, // sexta
  { open: '16:00', close: '23:30' }, // sábado
];

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  /**
   * Neutro: este é o TEMPLATE de uma loja nova, e `createShop` sempre grava o
   * nome de verdade por cima. Um nome próprio aqui reaparece em toda tela que
   * lê a configuração antes de ela chegar do servidor.
   */
  storeName: 'Delivery',
  city: 'Recife - PE',
  storeAddress: '',
  storeLat: -8.0476,
  storeLng: -34.877,
  pickupEnabled: true,
  pickupReadyMinutes: 20,
  deliveryPricePerKm: 2.0,
  deliveryBaseFee: 2.0,
  deliveryMinFee: 4.0,
  freeDeliveryAbove: 60,
  maxDeliveryKm: 12,
  minOrderValue: 15,
  routeFactor: 1.35,
  driverFeePerDelivery: 0,
  pixProvider: 'mercadopago',
  pixKey: '',
  pixMerchantName: 'Delivery',
  pixMerchantCity: 'Recife',
  cardOnDeliveryEnabled: true,
  storeWhatsApp: '',
  orderSoundUrl: '',
  openingHours: DEFAULT_OPENING_HOURS,
  sizeOptions: DEFAULT_SIZE_OPTIONS,
  loyaltyStampCost: 10,
  loyaltyRedeemCategory: 'caldinhos',
  timezone: 'America/Recife',
  orderEnabled: true,
  forceOpen: false,
};

export const RECIFE_CENTER = { lat: -8.0476, lng: -34.877 };
