import { CartItem, Coupon, DeliveryAddress, Fulfillment, SizeOption, StoreSettings } from '../types';
import { computeDeliveryFee } from './geo';
import { DEFAULT_SIZE_OPTIONS } from './defaults';

export function computeUnitPrice(
  basePrice: number,
  size?: string,
  sizeOptions: SizeOption[] = DEFAULT_SIZE_OPTIONS
): number {
  if (!size) return basePrice;
  const opt = sizeOptions.find((s) => s.label === size);
  return basePrice + (opt?.priceDelta ?? 0);
}

export function computeCartItemTotal(
  item: {
    product: { basePrice: number };
    size?: string;
    selectedExtras: { price: number }[];
    comboChoices?: { priceDelta: number }[];
    quantity: number;
    isFree?: boolean;
  },
  sizeOptions: SizeOption[] = DEFAULT_SIZE_OPTIONS
): number {
  if (item.isFree) return 0;
  const unit = computeUnitPrice(item.product.basePrice, item.size, sizeOptions);
  const extras = item.selectedExtras.reduce((sum, e) => sum + e.price, 0);
  const comboDelta =
    item.comboChoices?.reduce((sum, c) => sum + (c.priceDelta || 0), 0) ?? 0;
  return Math.round((unit + extras + comboDelta) * item.quantity * 100) / 100;
}

export function computeCartTotals(
  cart: CartItem[],
  coupon: Coupon | null,
  address: DeliveryAddress,
  settings: StoreSettings,
  fulfillment: Fulfillment = 'delivery'
): { subtotal: number; discount: number; deliveryFee: number; total: number } {
  const subtotal =
    Math.round(
      cart.reduce((sum, i) => sum + computeCartItemTotal(i, settings.sizeOptions), 0) * 100
    ) / 100;
  let discount = 0;
  if (coupon) {
    if (coupon.discountPercent) discount = Math.round((subtotal * coupon.discountPercent) / 100 * 100) / 100;
    else if (coupon.discountFixed) discount = coupon.discountFixed;
    discount = Math.min(discount, subtotal);
  }
  // Retirada não tem rota: nada de frete e nada de área de entrega.
  if (fulfillment === 'pickup') {
    const pickupTotal = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
    return { subtotal, discount, deliveryFee: 0, total: pickupTotal };
  }
  const rawFee = computeDeliveryFee(address, settings);
  if (rawFee < 0) {
    return { subtotal, discount, deliveryFee: -1, total: -1 };
  }
  let deliveryFee = rawFee;
  if (settings.freeDeliveryAbove > 0 && subtotal >= settings.freeDeliveryAbove) deliveryFee = 0;
  const total = Math.max(0, Math.round((subtotal - discount + deliveryFee) * 100) / 100);
  return { subtotal, discount, deliveryFee, total };
}

export function findCoupon(code: string, coupons: Coupon[]): Coupon | undefined {
  const formatted = code.trim().toUpperCase();
  return coupons.find((c) => c.code === formatted);
}
