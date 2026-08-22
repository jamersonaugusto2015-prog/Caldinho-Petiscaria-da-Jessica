/**
 * O cardápio: o que a loja vende e por quanto.
 *
 * Saiu de `src/types.ts`, um arquivo de 418 linhas que misturava cardápio,
 * pedido, motoboy, loja e relatório — e que 91 arquivos importavam. Quem
 * mexia num tipo de promoção recompilava a tela de mapa junto.
 */

// Categoria de produto (id estável; rótulo/emoji/cor são editáveis no painel)
export type CategoryId = string;

// Categoria editável no painel da cozinha
export interface Category {
  id: string;
  label: string;
  emoji: string;
  color: string;
  sort: number;
}

export interface ExtraOption {
  id: string;
  name: string;
  price: number;
}

// Tamanho configurável no admin (rótulo + acréscimo de preço)
export interface SizeOption {
  label: string; // ex: 'Médio (500ml)'
  priceDelta: number; // acréscimo sobre o preço base
}

// Opção de sabor dentro de um slot de combo
export interface ComboSlotOption {
  id: string;
  label: string; // ex: 'Caldinho de Feijão Preto'
  priceDelta?: number; // acréscimo opcional
}

// Slot de escolha de um combo (ex: "1º Caldinho")
export interface ComboSlot {
  id: string;
  label: string; // ex: '1º Caldinho'
  options: ComboSlotOption[];
  required: boolean;
  /** Quantas opções o cliente precisa escolher neste slot (default: required ? 1 : 0). */
  minChoices?: number;
  /** Quantas opções o cliente pode escolher no máximo (default: minChoices, ou seja, escolha exata). */
  maxChoices?: number;
}

// Escolha feita pelo cliente em um slot do combo
export interface ComboChoice {
  slotId: string;
  slotLabel: string;
  optionId: string;
  optionLabel: string;
  priceDelta: number;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  category: CategoryId;
  basePrice: number;
  image: string;
  isPopular?: boolean;
  isFeatured?: boolean;
  isFlashPromo?: boolean;
  originalPrice?: number;
  /** Quanto o prato custa para a loja. Alimenta o guarda de margem das promoções. */
  costPrice?: number;
  available: boolean;
  rating: number;
  reviewsCount: number;
  prepTimeMinutes: number;
  allowedExtras?: ExtraOption[];
  hasSizeOption?: boolean;
  comboSlots?: ComboSlot[];
}

export interface Coupon {
  code: string;
  discountPercent?: number;
  discountFixed?: number;
  minOrderValue: number;
  description: string;
}

/** O que a promoção faz com o preço. */
export type PromotionKind =
  | 'desconto' // tira % ou R$ do item, ou fixa um "por apenas"
  | 'leve_pague' // leve 3 pague 2 dentro do mesmo grupo de itens
  | 'brinde' // acima de X reais, um produto vai junto sem custo
  | 'frete';

/** Em quais itens a promoção pega. */
export type PromotionScope = 'produtos' | 'categorias' | 'todos';

/** Canal de venda: entrega, retirada ou os dois. */
export type PromotionChannel = 'ambos' | 'delivery' | 'pickup';

/** Quando a promoção vale. Campos vazios = sem restrição. */
export interface PromotionWindow {
  startDate?: string; // 'YYYY-MM-DD'
  endDate?: string; // 'YYYY-MM-DD'
  weekdays: number[]; // 0=domingo ... 6=sábado; vazio = todo dia
  startTime?: string; // 'HH:MM'
  endTime?: string; // 'HH:MM'; menor que startTime = cruza a meia-noite
}

export interface Promotion {
  id: string;
  name: string;
  kind: PromotionKind;
  enabled: boolean;

  scope: PromotionScope;
  productIds: string[];
  categoryIds: string[];

  // kind = 'desconto' (usa só um dos três)
  discountPercent?: number;
  discountFixed?: number;
  fixedPrice?: number;

  // kind = 'leve_pague'
  buyQty?: number;
  payQty?: number;

  // kind = 'brinde'
  giftProductId?: string;

  // kind = 'frete'
  deliveryFree?: boolean;
  deliveryDiscount?: number;

  minOrderValue: number;
  channel: PromotionChannel;
  /** 0 = sem limite. Conta pedidos, não itens. */
  maxUses: number;
  usedCount: number;
  /** false = o cliente escolhe entre a promoção e o cupom, nunca os dois. */
  stacksWithCoupon: boolean;
  /** Aparece na vitrine do cardápio do cliente. */
  highlight: boolean;
  /** Selo curto mostrado ao cliente (ex.: 'HAPPY HOUR'). */
  badge?: string;
  window: PromotionWindow;
  createdAt: string;

  // Resultado acumulado, gravado a cada pedido que usou a promoção.
  totalDiscount: number;
  totalRevenue: number;
  totalOrders: number;
}

/** Registro leve do que a promoção fez em um pedido. */
export interface AppliedPromotion {
  id: string;
  name: string;
  kind: PromotionKind;
  /** Quanto de desconto esta promoção deu neste pedido. */
  discount: number;
  /** Preenchido só em kind = 'brinde'. */
  giftProductId?: string;
  giftProductName?: string;
}
