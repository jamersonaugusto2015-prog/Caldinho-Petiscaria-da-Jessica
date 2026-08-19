import type { Category, Product, Promotion, PromotionKind } from '../../types';
import { discountedUnitPrice, marginPercent } from '../../shared/promotions';

/**
 * Rascunho e contas da tela de Promoções.
 *
 * Separado da tela porque a parte que decide se a promoção dá prejuízo é a que
 * mais precisa de teste e a que menos precisa de React.
 */

export function emptyPromotion(kind: PromotionKind = 'desconto'): Promotion {
  return {
    id: `promo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    kind,
    enabled: true,
    scope: kind === 'frete' || kind === 'brinde' ? 'todos' : 'produtos',
    productIds: [],
    categoryIds: [],
    minOrderValue: 0,
    channel: kind === 'frete' ? 'delivery' : 'ambos',
    maxUses: 0,
    usedCount: 0,
    stacksWithCoupon: false,
    highlight: true,
    window: { weekdays: [] },
    createdAt: new Date().toISOString(),
    totalDiscount: 0,
    totalRevenue: 0,
    totalOrders: 0,
    ...(kind === 'desconto' ? { discountPercent: 15 } : {}),
    ...(kind === 'leve_pague' ? { buyQty: 3, payQty: 2 } : {}),
    ...(kind === 'frete' ? { deliveryFree: true } : {}),
  };
}

/**
 * Receitas prontas. O dono da loja raramente sabe qual promoção montar; começar
 * de um modelo que já funciona é mais rápido que preencher oito campos em branco.
 */
export interface PromotionPreset {
  id: string;
  title: string;
  hint: string;
  emoji: string;
  build: () => Promotion;
}

export const PROMOTION_PRESETS: PromotionPreset[] = [
  {
    id: 'happy-hour',
    title: 'Happy hour',
    hint: '20% de desconto de segunda a quinta, das 17h às 20h — enche a casa na hora parada.',
    emoji: '🍻',
    build: () => ({
      ...emptyPromotion('desconto'),
      name: 'Happy hour',
      badge: 'HAPPY HOUR',
      discountPercent: 20,
      scope: 'categorias',
      window: { weekdays: [1, 2, 3, 4], startTime: '17:00', endTime: '20:00' },
    }),
  },
  {
    id: 'leve-3-pague-2',
    title: 'Leve 3, pague 2',
    hint: 'A terceira unidade sai de graça. Sobe o número de itens por pedido sem baixar o preço da tabela.',
    emoji: '🎁',
    build: () => ({
      ...emptyPromotion('leve_pague'),
      name: 'Leve 3, pague 2',
      badge: 'LEVE 3 PAGUE 2',
      buyQty: 3,
      payQty: 2,
      scope: 'categorias',
    }),
  },
  {
    id: 'frete-gratis',
    title: 'Frete grátis acima de R$ 60',
    hint: 'O cliente completa o carrinho para não pagar a entrega. Sobe o ticket médio.',
    emoji: '🛵',
    build: () => ({
      ...emptyPromotion('frete'),
      name: 'Frete grátis acima de R$ 60',
      badge: 'FRETE GRÁTIS',
      deliveryFree: true,
      minOrderValue: 60,
    }),
  },
  {
    id: 'fim-de-semana',
    title: 'Fim de semana',
    hint: 'Preço fixo em produtos escolhidos, só sábado e domingo.',
    emoji: '🔥',
    build: () => ({
      ...emptyPromotion('desconto'),
      name: 'Promoção de fim de semana',
      badge: 'SÓ NO FDS',
      discountPercent: 0,
      fixedPrice: 19.9,
      scope: 'produtos',
      window: { weekdays: [0, 6] },
    }),
  },
  {
    id: 'brinde',
    title: 'Compre e ganhe',
    hint: 'Acima de R$ 80, um item vai de brinde. Funciona bem com bebida ou sobremesa.',
    emoji: '🥤',
    build: () => ({
      ...emptyPromotion('brinde'),
      name: 'Brinde acima de R$ 80',
      badge: 'BRINDE',
      minOrderValue: 80,
    }),
  },
];

// ---------- Guarda de margem ----------

export interface MarginRow {
  productId: string;
  name: string;
  basePrice: number;
  promoPrice: number;
  cost?: number;
  marginBefore: number | null;
  marginAfter: number | null;
  /** Lucro em reais por unidade vendida na promoção. null sem custo cadastrado. */
  profit: number | null;
  belowCost: boolean;
}

export interface MarginReport {
  rows: MarginRow[];
  /** Produtos alvo sem custo cadastrado: a conta não fecha sem eles. */
  missingCost: number;
  /** Pior caso: o item que mais aperta a margem. */
  worst: MarginRow | null;
  /** Algum item vende abaixo do custo. */
  hasLoss: boolean;
}

/** Produtos que a promoção atinge, já resolvidos do escopo escolhido. */
export function targetProducts(promo: Promotion, products: Product[]): Product[] {
  if (promo.kind === 'brinde') {
    const gift = products.find((product) => product.id === promo.giftProductId);
    return gift ? [gift] : [];
  }
  if (promo.kind === 'frete') return [];
  if (promo.scope === 'todos') return products;
  if (promo.scope === 'produtos') return products.filter((product) => promo.productIds.includes(product.id));
  return products.filter((product) => promo.categoryIds.includes(product.category));
}

/** Preço unitário médio que a promoção produz — é o que decide a margem. */
function effectivePrice(promo: Promotion, product: Product): number {
  if (promo.kind === 'desconto') return discountedUnitPrice(promo, product.basePrice);
  if (promo.kind === 'leve_pague') {
    const buyQty = Math.max(2, promo.buyQty || 0);
    const payQty = Math.max(1, promo.payQty || 0);
    return Math.round((product.basePrice * payQty) / buyQty * 100) / 100;
  }
  if (promo.kind === 'brinde') return 0; // o brinde sai sem receita nenhuma
  return product.basePrice;
}

/**
 * Diz, antes de publicar, quanto sobra em cada item da promoção. É a conta que
 * o dono faz de cabeça e erra: 40% de desconto num prato de 55% de margem ainda
 * dá lucro, mas num de 30% vende no prejuízo.
 */
export function marginReport(promo: Promotion, products: Product[]): MarginReport {
  const rows: MarginRow[] = targetProducts(promo, products).map((product) => {
    const promoPrice = effectivePrice(promo, product);
    const cost = typeof product.costPrice === 'number' && product.costPrice > 0 ? product.costPrice : undefined;
    return {
      productId: product.id,
      name: product.name,
      basePrice: product.basePrice,
      promoPrice,
      cost,
      marginBefore: marginPercent(product.basePrice, cost),
      marginAfter: marginPercent(promoPrice, cost),
      profit: cost === undefined ? null : Math.round((promoPrice - cost) * 100) / 100,
      belowCost: cost !== undefined && promoPrice < cost,
    };
  });

  const withCost = rows.filter((row) => row.profit !== null);
  const worst = withCost.length
    ? withCost.reduce((low, row) => ((row.profit ?? 0) < (low.profit ?? 0) ? row : low))
    : null;

  return {
    rows,
    missingCost: rows.filter((row) => row.cost === undefined).length,
    worst,
    hasLoss: rows.some((row) => row.belowCost),
  };
}

/** Resumo em uma linha do que a promoção atinge ('4 produtos', 'Caldinhos, Bebidas'). */
export function describeTarget(promo: Promotion, products: Product[], categories: Category[]): string {
  if (promo.kind === 'frete') return 'Taxa de entrega';
  if (promo.kind === 'brinde') {
    const gift = products.find((product) => product.id === promo.giftProductId);
    return gift ? `Brinde: ${gift.name}` : 'Brinde não escolhido';
  }
  if (promo.scope === 'todos') return 'Cardápio inteiro';
  if (promo.scope === 'categorias') {
    const labels = promo.categoryIds
      .map((id) => categories.find((category) => category.id === id)?.label || id)
      .filter(Boolean);
    return labels.length ? labels.join(', ') : 'Nenhuma categoria escolhida';
  }
  const names = promo.productIds
    .map((id) => products.find((product) => product.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  if (!names.length) return 'Nenhum produto escolhido';
  return names.length <= 2 ? names.join(', ') : `${names[0]} e mais ${names.length - 1}`;
}
