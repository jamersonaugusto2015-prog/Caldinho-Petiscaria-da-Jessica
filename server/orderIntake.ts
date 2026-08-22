import crypto from 'node:crypto';
import type { Coupon, Product, Promotion } from '../contract/catalog/types';
import type { CartItem, DeliveryAddress, Fulfillment, Order, PaymentDetails, PaymentMethod } from '../contract/order/types';
import type { StoreSettings } from '../contract/shop/types';
import { computeCartItemTotal, computeCartTotals, findCoupon } from '../contract/pricing/pricing';
import { effectiveDistanceKm, isStoreOpen } from '../contract/pricing/geo';
import { normalizeFulfillment, pickupAddress } from '../contract/order/fulfillment';
import { normalizePaymentTiming, requiresOnlineCharge } from '../contract/payment/payment';
import { DomainError } from './errors';
import { formatMoney } from '../contract/pricing/money';

export interface OrderIntakeInput {
  items?: unknown;
  couponCode?: unknown;
  address?: unknown;
  fulfillment?: unknown;
  paymentMethod?: unknown;
  paymentTiming?: unknown;
  changeForAmount?: unknown;
  customerName?: unknown;
  customerPhone?: unknown;
  customerId?: unknown;
  cardToken?: unknown;
  cardPaymentMethodId?: unknown;
  cardInstallments?: unknown;
  cardIssuerId?: unknown;
  cardEmail?: unknown;
  cardDocType?: unknown;
  cardDocNumber?: unknown;
  notificationUrl?: string;
}

export interface PixPaymentInput {
  orderId: string;
  amount: number;
  settings: StoreSettings;
  payerName: string;
  notificationUrl: string;
}

export interface CardPaymentInput {
  orderId: string;
  amount: number;
  settings: StoreSettings;
  cardToken: string;
  paymentMethodId: string;
  installments: number;
  issuerId?: string;
  payerEmail: string;
  identificationType: string;
  identificationNumber: string;
  notificationUrl: string;
}

export type PixPaymentPatch = Pick<
  PaymentDetails,
  'mpPaymentId' | 'pixCopyPaste' | 'pixQrCode' | 'mpTicketUrl'
>;

export type CardPaymentPatch = Pick<PaymentDetails, 'mpPaymentId' | 'cardBrand'> & {
  isPaid: boolean;
};

/** Payment is deliberately an adapter: live Mercado Pago and tests use the same intake path. */
export interface OrderPaymentAdapter {
  collectPix(input: PixPaymentInput): Promise<PixPaymentPatch>;
  isCardAvailable(): boolean;
  collectCard(input: CardPaymentInput): Promise<CardPaymentPatch>;
}

export interface OrderIntakeDependencies {
  settings: StoreSettings | (() => StoreSettings);
  loadProduct(id: string): Product | null;
  listCoupons(): Coupon[];
  /** Promoções automáticas ativas. Ausente = nenhuma (usado por testes antigos). */
  listPromotions?: () => Promotion[];
  /** Cardápio completo, usado só para resolver o produto de um brinde. */
  listProducts?: () => Product[];
  /** Sobe o contador da promoção dentro da transação do pedido. */
  registerPromotionUses?: (applied: Order['appliedPromotions'], orderTotal: number) => void;
  /** Segura a vaga da promoção antes da cobrança. */
  reservePromotionUses(applied: Order['appliedPromotions']): void;
  /** Devolve a vaga quando a cobrança falha. */
  releasePromotionUses(applied: Order['appliedPromotions']): void;
  /** Grava o faturamento da promoção depois que a cobrança passa. */
  recordPromotionSale(applied: Order['appliedPromotions'], orderTotal: number): void;
  payment: OrderPaymentAdapter;
  peekFreeRedeem(token: string, productId: string, customerId?: string): boolean;
  consumeFreeItems(items: CartItem[], customerId?: string): void;
  /** The callback runs in the repository transaction immediately before insert. */
  persistOrder(order: Order, beforePersist: () => void): void;
  getLoyaltyPoints(customerId: string): number;
  createOrderId?: () => string;
  now?: () => string;
  /**
   * Confere se o id sorteado já existe. O id do pedido é único no MUNDO (não por
   * loja): é ele que o webhook do Mercado Pago devolve em `external_reference`.
   */
  orderIdExists(id: string): boolean;
  /**
   * Grava o resultado da cobrança na linha já reservada.
   *
   * Deixou de ser opcional na Fase 5: o atalho para `orderStore.saveOrder` não
   * existe mais porque gravar passou a exigir saber a loja — e o domínio não
   * sabe, de propósito. Quem amarra é `server/domain/deps.ts`.
   */
  updateOrder(order: Order): void;
  /** Apaga a linha reservada de um pedido cuja cobrança falhou. */
  releaseOrder(id: string): void;
  /** Devolve o vale-brinde reservado antes de uma cobrança que falhou. */
  releaseFreeItems(items: CartItem[]): void;
}

export interface OrderIntakeResult {
  order: Order;
  loyaltyPoints: number;
}

function getSettings(deps: OrderIntakeDependencies): StoreSettings {
  return typeof deps.settings === 'function' ? deps.settings() : deps.settings;
}

function invalidFreeRedeem(): DomainError {
  return new DomainError(400, 'Item grátis de fidelidade inválido. Verifique seus selos.');
}

export function resolveCartItem(
  raw: CartItem,
  settings: StoreSettings,
  loadProduct: (id: string) => Product | null
): CartItem {
  if (!raw || typeof raw.quantity !== 'number' || raw.quantity < 1 || raw.quantity > 20) {
    throw new DomainError(400, 'Quantidade inválida.');
  }

  const product = loadProduct(raw.product?.id);
  if (!product) throw new DomainError(400, 'Produto não encontrado no cardápio.');
  if (!product.available && !raw.isFree) {
    throw new DomainError(400, `${product.name} está indisponível no momento.`);
  }

  const allowed = product.allowedExtras || [];
  const selectedExtras: CartItem['selectedExtras'] = [];
  for (const extra of Array.isArray(raw.selectedExtras) ? raw.selectedExtras : []) {
    if (!extra || typeof extra !== 'object') {
      throw new DomainError(400, `Adicional inválido em ${product.name}.`);
    }
    const found = allowed.find((e) => e.id === extra.id || e.name === extra.name);
    if (!found) throw new DomainError(400, `Adicional inválido em ${product.name}.`);
    selectedExtras.push({ id: found.id, name: found.name, price: found.price });
  }

  let comboChoices: CartItem['comboChoices'];
  if (Array.isArray(raw.comboChoices) && raw.comboChoices.length > 0) {
    const slots = product.comboSlots || [];
    comboChoices = [];
    for (const choice of raw.comboChoices) {
      if (!choice || typeof choice !== 'object') {
        throw new DomainError(400, `Combo inválido em ${product.name}.`);
      }
      const slot = slots.find((s) => s.id === choice.slotId);
      if (!slot) throw new DomainError(400, `Combo inválido em ${product.name}.`);
      const opt = slot.options.find((o) => o.id === choice.optionId);
      if (!opt) throw new DomainError(400, `Opção de combo inválida em ${product.name}.`);
      comboChoices.push({
        slotId: slot.id,
        slotLabel: slot.label,
        optionId: opt.id,
        optionLabel: opt.label,
        priceDelta: opt.priceDelta || 0,
      });
    }
    for (const slot of slots) {
      const count = comboChoices.filter((c) => c.slotId === slot.id).length;
      const min = slot.minChoices ?? (slot.required ? 1 : 0);
      const max = slot.maxChoices ?? slot.minChoices ?? (slot.required ? 1 : 0);
      if (count < min) {
        throw new DomainError(400, `Combo incompleto em ${product.name}: escolha pelo menos ${min} em “${slot.label}”.`);
      }
      if (count > max) {
        throw new DomainError(400, `Combo com escolhas demais em ${product.name}: no máximo ${max} em “${slot.label}”.`);
      }
    }
  } else {
    // Combo enviado sem escolhas: os slots obrigatórios ainda precisam estar preenchidos.
    const slots = product.comboSlots || [];
    for (const slot of slots) {
      const min = slot.minChoices ?? (slot.required ? 1 : 0);
      if (min > 0) {
        throw new DomainError(400, `Combo incompleto em ${product.name}: escolha pelo menos ${min} em “${slot.label}”.`);
      }
    }
  }

  let size: string | undefined;
  if (raw.size) {
    const opt = settings.sizeOptions.find((s) => s.label === raw.size);
    if (!opt || !product.hasSizeOption) {
      throw new DomainError(400, `Tamanho inválido em ${product.name}.`);
    }
    size = opt.label;
  }

  const item: CartItem = {
    id: raw.id || 'item-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    product,
    size,
    selectedExtras,
    comboChoices,
    observation: raw.observation,
    quantity: Math.floor(raw.quantity),
    isFree: !!raw.isFree,
    freeToken: raw.freeToken,
    itemTotalPrice: 0,
  };
  item.itemTotalPrice = computeCartItemTotal(item, settings.sizeOptions);
  return item;
}

const ORDER_ID_MAX_ATTEMPTS = 8;

function randomOrderSuffix(): string {
  return BigInt('0x' + crypto.randomBytes(5).toString('hex')).toString(36).toUpperCase();
}

/**
 * `CX-` stays short so kitchen staff can read it aloud, but the suffix has enough entropy
 * (40 random bits) that a collision is very unlikely; the uniqueness check + bounded retry
 * make sure a collision is retried instead of used as an idempotency key / DB primary key.
 */
function generateOrderId(exists: (id: string) => boolean): string {
  for (let attempt = 0; attempt < ORDER_ID_MAX_ATTEMPTS; attempt++) {
    const id = `CX-${randomOrderSuffix()}`;
    if (!exists(id)) return id;
  }
  throw new DomainError(500, 'Não foi possível gerar um código de pedido único. Tente novamente.');
}

/** A porta de entrada de um pedido, com as dependências de uma loja já amarradas. */
export interface OrderIntake {
  placeOrder(input: OrderIntakeInput): Promise<OrderIntakeResult>;
}

export function createOrderIntake(deps: OrderIntakeDependencies): OrderIntake {
  return {
    placeOrder: (input: OrderIntakeInput) => placeOrder(input, deps),
  };
}

export async function placeOrder(
  input: OrderIntakeInput,
  deps: OrderIntakeDependencies
): Promise<OrderIntakeResult> {
  const fulfillment: Fulfillment = normalizeFulfillment(input.fulfillment);
  const isPickupOrder = fulfillment === 'pickup';

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new DomainError(400, 'Seu carrinho está vazio. Adicione itens do cardápio antes de fechar o pedido.');
  }
  if (!isPickupOrder && !input.address) {
    throw new DomainError(400, 'Preencha rua, número e bairro antes de fechar o pedido.');
  }

  const settings = getSettings(deps);
  if (!isStoreOpen(settings)) {
    throw new DomainError(400, 'A loja está fechada agora. Confira os horários no cardápio.');
  }
  if (isPickupOrder && !settings.pickupEnabled) {
    throw new DomainError(400, 'A retirada na loja está desativada no momento. Escolha entrega.');
  }

  // Na retirada o endereço do cliente não existe: o pedido guarda o endereço da própria loja.
  const address = isPickupOrder ? pickupAddress(settings) : (input.address as DeliveryAddress);
  if (
    typeof address.lat !== 'number' ||
    typeof address.lng !== 'number' ||
    !Number.isFinite(address.lat) ||
    !Number.isFinite(address.lng)
  ) {
    throw new DomainError(
      400,
      isPickupOrder
        ? 'A loja está sem localização cadastrada. Fale com a loja.'
        : 'Endereço sem localização. Informe o CEP ou ajuste o pino no mapa.'
    );
  }

  const cartItems = (input.items as CartItem[]).map((raw) =>
    resolveCartItem(raw, settings, deps.loadProduct)
  );
  // O vale-brinde é de quem resgatou: valida já com o dono para um cliente não
  // gastar o token de outro.
  const redeemCustomerId = String(input.customerId || 'anon').slice(0, 80);
  const freeItems = cartItems.filter((item) => item.isFree);
  for (const item of freeItems) {
    if (!item.freeToken || !deps.peekFreeRedeem(item.freeToken, item.product.id, redeemCustomerId)) {
      throw invalidFreeRedeem();
    }
  }

  const coupon = findCoupon(String(input.couponCode ?? ''), deps.listCoupons());
  // O preço promocional é recalculado aqui: o carrinho do cliente é só uma
  // sugestão, quem decide o que o pedido custa é o servidor.
  const totals = computeCartTotals(cartItems, coupon ?? null, address, settings, fulfillment, {
    promotions: deps.listPromotions?.() ?? [],
    products: deps.listProducts?.(),
  });
  const distanceKm = isPickupOrder ? 0 : effectiveDistanceKm(address, settings);
  if (!isPickupOrder && settings.maxDeliveryKm > 0 && distanceKm > settings.maxDeliveryKm) {
    throw new DomainError(
      400,
      `O endereço está fora da área de entrega (máx. ${settings.maxDeliveryKm} km da loja).`
    );
  }
  if (totals.deliveryFee < 0) {
    throw new DomainError(400, 'O endereço está fora da área de entrega.');
  }
  if (coupon && totals.subtotal < coupon.minOrderValue) {
    throw new DomainError(
      400,
      `Valor mínimo para o cupom ${coupon.code} é ${formatMoney(coupon.minOrderValue)}.`
    );
  }

  const paidSubtotal = cartItems
    .filter((item) => !item.isFree)
    .reduce((sum, item) => sum + computeCartItemTotal(item, settings.sizeOptions), 0);
  if (settings.minOrderValue > 0 && paidSubtotal > 0 && paidSubtotal < settings.minOrderValue) {
    throw new DomainError(
      400,
      `Pedido mínimo de ${formatMoney(settings.minOrderValue)}. Adicione mais itens.`
    );
  }

  const id = deps.createOrderId?.() || generateOrderId(deps.orderIdExists);
  // Cair no PIX por padrão esconderia o erro: o cliente escolheria dinheiro e a
  // cozinha ficaria esperando um pagamento que nunca chega.
  if (input.paymentMethod !== 'cash' && input.paymentMethod !== 'card' && input.paymentMethod !== 'pix') {
    throw new DomainError(400, 'Forma de pagamento inválida.');
  }
  const method: PaymentMethod = input.paymentMethod;
  const timing = normalizePaymentTiming(method, input.paymentTiming);
  // Sem adaptador de cartão o pedido seria gravado como não pago e em silêncio:
  // a cozinha entregaria achando que o cliente já pagou. Na maquininha isso não
  // vale: ninguém cobra nada agora, o motoboy passa o cartão na porta.
  if (method === 'card' && timing === 'online' && !deps.payment.isCardAvailable()) {
    throw new DomainError(
      400,
      'Cartão online indisponível. Conecte o Mercado Pago na cozinha, pague na maquininha da entrega ou escolha PIX ou dinheiro.'
    );
  }
  if (method === 'card' && timing === 'delivery' && !settings.cardOnDeliveryEnabled) {
    throw new DomainError(400, 'A loja não leva maquininha na entrega. Escolha outra forma de pagamento.');
  }
  const payment: PaymentDetails = {
    method,
    timing,
    isPaid: false,
    // Troco só existe em dinheiro: guardá-lo no cartão faria o motoboy levar
    // dinheiro à toa e a cozinha ler um valor que ninguém pediu.
    changeForAmount:
      method === 'cash' && typeof input.changeForAmount === 'number' ? input.changeForAmount : undefined,
  };

  const customerId = String(input.customerId || 'anon').slice(0, 80);
  const createdAt = deps.now?.() || new Date().toISOString();
  const order: Order = {
    id,
    customerId,
    customerName: String(input.customerName || '').trim() || 'Cliente',
    customerPhone: String(input.customerPhone || '').trim() || '',
    address: { ...address, distanceKm },
    fulfillment,
    items: cartItems,
    subtotal: totals.subtotal,
    discount: totals.discount,
    promoDiscount: totals.promoDiscount,
    appliedPromotions: totals.appliedPromotions,
    deliveryFee: totals.deliveryFee,
    total: totals.total,
    distanceKm,
    status: 'recebido',
    payment,
    createdAt,
    estimatedDeliveryMinutes: isPickupOrder
      ? Math.max(5, Math.round(settings.pickupReadyMinutes))
      : Math.max(15, Math.round(12 + distanceKm * 2 + 3)),
    loyaltyPointsEarned: 0,
  };

  const willCharge = requiresOnlineCharge(method, timing);

  if (!willCharge) {
    deps.persistOrder(order, () => {
      deps.consumeFreeItems(freeItems, customerId);
      deps.registerPromotionUses?.(totals.appliedPromotions, totals.total);
    });
    return { order, loyaltyPoints: deps.getLoyaltyPoints(customerId) };
  }

  /**
   * Reserve the order row and consume the loyalty tokens atomically, in one transaction,
   * BEFORE any money moves. This closes both the orphan-charge window (a charge is never
   * initiated without a durable order to attach it to — a failed insert can no longer follow
   * a successful charge) and the loyalty double-spend window (a replayed request that re-uses
   * a freeToken fails here, before collectPix/collectCard ever runs).
   */
  // A VAGA da promoção é segurada aqui, junto com os selos, antes de qualquer
  // dinheiro se mexer. Contar só depois do `await` da cobrança deixava dois
  // pedidos simultâneos levarem a mesma última vaga e estourarem o teto. O
  // FATURAMENTO continua sendo gravado só depois da cobrança passar — se ela
  // falhar, a linha é apagada e a vaga volta em `releasePromotionUses`.
  deps.persistOrder(order, () => {
    deps.consumeFreeItems(freeItems, customerId);
    deps.reservePromotionUses(totals.appliedPromotions);
  });

  try {
    if (method === 'pix') {
      Object.assign(
        payment,
        await deps.payment.collectPix({
          orderId: id,
          amount: totals.total,
          settings,
          payerName: String(input.customerName || 'Cliente'),
          notificationUrl: input.notificationUrl || '',
        })
      );
    } else {
      const card = await deps.payment.collectCard({
        orderId: id,
        amount: totals.total,
        settings,
        cardToken: typeof input.cardToken === 'string' ? input.cardToken : '',
        paymentMethodId: String(input.cardPaymentMethodId || 'visa'),
        installments: Number(input.cardInstallments) || 1,
        issuerId: input.cardIssuerId ? String(input.cardIssuerId) : undefined,
        payerEmail:
          String(input.cardEmail || '').trim() || `pedido.${id.toLowerCase()}@caldinho.app`,
        identificationType: String(input.cardDocType || 'CPF'),
        identificationNumber: String(input.cardDocNumber || ''),
        notificationUrl: input.notificationUrl || '',
      });
      Object.assign(payment, card);
    }
  } catch (err) {
    deps.releaseOrder(id);
    if (freeItems.length > 0) deps.releaseFreeItems(freeItems);
    if (totals.appliedPromotions.length > 0) {
      deps.releasePromotionUses(totals.appliedPromotions);
    }
    throw err;
  }

  deps.recordPromotionSale(totals.appliedPromotions, totals.total);

  try {
    deps.updateOrder(order);
  } catch {
    // The charge already succeeded and the reserved row still exists (unpaid) — this is a
    // recoverable state, not an orphan charge: the shop can find order `id` and reconcile it.
    throw new DomainError(
      500,
      `Pagamento confirmado, mas o pedido ${id} não pôde ser finalizado. Contate a loja informando este código.`
    );
  }

  return { order, loyaltyPoints: deps.getLoyaltyPoints(customerId) };
}

export function createFakePaymentAdapter(options: {
  pixCopyPaste?: string;
  cardAvailable?: boolean;
  cardApproved?: boolean;
} = {}): OrderPaymentAdapter {
  return {
    async collectPix(input) {
      return { pixCopyPaste: options.pixCopyPaste || `FAKE-PIX-${input.orderId}` };
    },
    isCardAvailable: () => options.cardAvailable ?? true,
    async collectCard(input) {
      return {
        mpPaymentId: `fake-${input.orderId}`,
        cardBrand: input.paymentMethodId,
        isPaid: options.cardApproved ?? true,
      };
    },
  };
}
