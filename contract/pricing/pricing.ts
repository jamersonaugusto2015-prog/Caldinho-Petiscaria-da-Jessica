import type { AppliedPromotion, Coupon, Product, Promotion, SizeOption } from '../catalog/types';
import type { CartItem, DeliveryAddress, Fulfillment } from '../order/types';
import type { StoreSettings } from '../shop/types';
import { computeDeliveryFee } from './geo';
import { DEFAULT_SIZE_OPTIONS } from '../shop/defaults';
import { applyPromotions, PromotionCartLine } from '../catalog/promotions';
import { percentOf, roundMoney, toCents, toReais } from './money';

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
  return roundMoney((unit + extras + comboDelta) * item.quantity);
}

/** Entradas opcionais das promoções automáticas — pedidos antigos não as têm. */
export interface PricingPromotionInput {
  promotions?: Promotion[];
  /** Cardápio completo, usado só para resolver o produto de um brinde. */
  products?: Pick<Product, 'id' | 'name' | 'basePrice'>[];
  /** Momento da conta; injetável para os testes. */
  at?: Date;
}

export interface CartTotals {
  subtotal: number;
  /** Desconto do cupom digitado pelo cliente. */
  discount: number;
  /** Desconto dos itens vindo das promoções automáticas. */
  promoDiscount: number;
  /** Quanto a promoção abateu do frete (o deliveryFee já vem descontado). */
  promoDeliveryDiscount: number;
  appliedPromotions: AppliedPromotion[];
  /** Promoções que ficariam de fora porque o cliente aplicou um cupom. */
  blockedPromotions: Promotion[];
  deliveryFee: number;
  total: number;
}

/** Converte o carrinho em linhas com preço unitário resolvido para o motor de promoções. */
function toPromotionLines(cart: CartItem[], sizeOptions: SizeOption[]): PromotionCartLine[] {
  return cart.map((item) => ({
    productId: item.product.id,
    categoryId: item.product.category,
    name: item.product.name,
    quantity: item.quantity,
    unitPrice: item.quantity > 0 ? computeCartItemTotal(item, sizeOptions) / item.quantity : 0,
    isFree: item.isFree,
  }));
}

export function computeCartTotals(
  cart: CartItem[],
  coupon: Coupon | null,
  address: DeliveryAddress,
  settings: StoreSettings,
  fulfillment: Fulfillment = 'delivery',
  promotionInput: PricingPromotionInput = {}
): CartTotals {
  const subtotal = roundMoney(
    cart.reduce((sum, i) => sum + computeCartItemTotal(i, settings.sizeOptions), 0)
  );
  let discount = 0;
  if (coupon) {
    if (coupon.discountPercent) discount = toReais(percentOf(toCents(subtotal), coupon.discountPercent));
    else if (coupon.discountFixed) discount = coupon.discountFixed;
    discount = Math.min(discount, subtotal);
  }

  const runPromotions = (deliveryFee: number, channel: 'delivery' | 'pickup') =>
    applyPromotions(promotionInput.promotions ?? [], {
      lines: toPromotionLines(cart, settings.sizeOptions),
      subtotal,
      deliveryFee,
      channel,
      hasCoupon: Boolean(coupon),
      at: promotionInput.at,
      products: promotionInput.products,
    });

  // Retirada não tem rota: nada de frete e nada de área de entrega.
  if (fulfillment === 'pickup') {
    const promo = runPromotions(0, 'pickup');
    const pickupTotal = Math.max(0, roundMoney(subtotal - discount - promo.itemDiscount));
    return {
      subtotal,
      discount,
      promoDiscount: promo.itemDiscount,
      promoDeliveryDiscount: 0,
      appliedPromotions: promo.applied,
      blockedPromotions: promo.blockedByCoupon,
      deliveryFee: 0,
      total: pickupTotal,
    };
  }

  const rawFee = computeDeliveryFee(address, settings);
  if (rawFee < 0) {
    return {
      subtotal,
      discount,
      promoDiscount: 0,
      promoDeliveryDiscount: 0,
      appliedPromotions: [],
      blockedPromotions: [],
      deliveryFee: -1,
      total: -1,
    };
  }
  let deliveryFee = rawFee;
  if (settings.freeDeliveryAbove > 0 && subtotal >= settings.freeDeliveryAbove) deliveryFee = 0;

  const promo = runPromotions(deliveryFee, 'delivery');
  deliveryFee = roundMoney(deliveryFee - promo.deliveryDiscount);

  const total = Math.max(0, roundMoney(subtotal - discount - promo.itemDiscount + deliveryFee));
  return {
    subtotal,
    discount,
    promoDiscount: promo.itemDiscount,
    promoDeliveryDiscount: promo.deliveryDiscount,
    appliedPromotions: promo.applied,
    blockedPromotions: promo.blockedByCoupon,
    deliveryFee,
    total,
  };
}

export function findCoupon(code: string, coupons: Coupon[]): Coupon | undefined {
  const formatted = code.trim().toUpperCase();
  return coupons.find((c) => c.code === formatted);
}
