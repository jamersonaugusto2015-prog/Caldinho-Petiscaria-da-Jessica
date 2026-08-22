import type { PublicStoreSettings } from '../../../contract/shop/types';
/**
 * O que o formulário de configurações edita. Segredos (PIN, service account)
 * entram como campos vazios: o servidor só recebe o que foi digitado agora.
 */
export type SettingsDraft = Pick<
  PublicStoreSettings,
  | 'storeName'
  | 'city'
  | 'storeAddress'
  | 'storeLat'
  | 'storeLng'
  | 'pickupEnabled'
  | 'pickupReadyMinutes'
  | 'deliveryPricePerKm'
  | 'deliveryBaseFee'
  | 'deliveryMinFee'
  | 'freeDeliveryAbove'
  | 'maxDeliveryKm'
  | 'minOrderValue'
  | 'routeFactor'
  | 'driverFeePerDelivery'
  | 'pixProvider'
  | 'pixKey'
  | 'pixMerchantName'
  | 'pixMerchantCity'
  | 'cardOnDeliveryEnabled'
  | 'storeWhatsApp'
  | 'orderSoundUrl'
  | 'openingHours'
  | 'orderEnabled'
  | 'forceOpen'
  | 'backupEnabled'
  | 'backupFrequencyDays'
  | 'backupFolderId'
> & { kitchenPin: string; backupServiceAccount: string };

export type SetSettingsField = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => void;

export const makeDraft = (settings: PublicStoreSettings): SettingsDraft => ({
  storeName: settings.storeName,
  city: settings.city,
  storeAddress: settings.storeAddress,
  storeLat: settings.storeLat,
  storeLng: settings.storeLng,
  pickupEnabled: settings.pickupEnabled,
  pickupReadyMinutes: settings.pickupReadyMinutes,
  deliveryPricePerKm: settings.deliveryPricePerKm,
  deliveryBaseFee: settings.deliveryBaseFee,
  deliveryMinFee: settings.deliveryMinFee,
  freeDeliveryAbove: settings.freeDeliveryAbove,
  maxDeliveryKm: settings.maxDeliveryKm,
  minOrderValue: settings.minOrderValue,
  routeFactor: settings.routeFactor,
  driverFeePerDelivery: settings.driverFeePerDelivery,
  pixProvider: settings.pixProvider === 'local' ? 'local' : 'mercadopago',
  pixKey: settings.pixKey,
  pixMerchantName: settings.pixMerchantName,
  pixMerchantCity: settings.pixMerchantCity,
  cardOnDeliveryEnabled: settings.cardOnDeliveryEnabled !== false,
  storeWhatsApp: settings.storeWhatsApp,
  orderSoundUrl: settings.orderSoundUrl,
  openingHours: settings.openingHours.map((hour) => (hour ? { ...hour } : null)),
  orderEnabled: settings.orderEnabled,
  forceOpen: settings.forceOpen,
  backupEnabled: settings.backupEnabled,
  backupFrequencyDays: settings.backupFrequencyDays,
  backupFolderId: settings.backupFolderId,
  kitchenPin: '',
  backupServiceAccount: '',
});

/**
 * A barra de salvar só aparece quando existe algo para salvar. Segredos contam
 * como alteração assim que recebem qualquer texto — eles nunca voltam do servidor.
 */
export const draftChanged = (draft: SettingsDraft, settings: PublicStoreSettings): boolean => {
  if (draft.kitchenPin.trim() || draft.backupServiceAccount.trim()) return true;
  const { kitchenPin: _pin, backupServiceAccount: _key, ...current } = draft;
  const { kitchenPin: _basePin, backupServiceAccount: _baseKey, ...base } = makeDraft(settings);
  return JSON.stringify(current) !== JSON.stringify(base);
};
