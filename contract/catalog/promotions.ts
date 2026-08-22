import type { AppliedPromotion, Product, Promotion, PromotionChannel, PromotionKind, PromotionWindow } from './types';
import { formatMoney, roundMoney } from '../pricing/money';
/**
 * Motor de promoções automáticas.
 *
 * O cupom precisa que o cliente digite um código; a promoção vale sozinha
 * quando a regra bate. Todas as funções aqui são puras e rodam nos dois lados:
 * o cliente vê o mesmo preço que o servidor grava no pedido.
 */

export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const PROMOTION_KIND_LABELS: Record<PromotionKind, string> = {
  desconto: 'Desconto em itens',
  leve_pague: 'Leve mais, pague menos',
  brinde: 'Compre e ganhe',
  frete: 'Frete',
};

export type PromotionStatus =
  | 'ativa'
  | 'pausada'
  | 'agendada'
  | 'expirada'
  | 'esgotada'
  | 'fora_da_janela';

export const PROMOTION_STATUS_LABELS: Record<PromotionStatus, string> = {
  ativa: 'Valendo agora',
  pausada: 'Pausada',
  agendada: 'Agendada',
  expirada: 'Encerrada',
  esgotada: 'Limite atingido',
  fora_da_janela: 'Fora do horário',
};

export const EMPTY_PROMOTION_WINDOW: PromotionWindow = { weekdays: [] };

/** Apelido local do arredondamento ÚNICO do sistema (`contract/pricing/money.ts`). */
const round = roundMoney;

const timeToMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

/** 'YYYY-MM-DD' no fuso local — comparar strings de data evita erro de UTC. */
export const localDateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** A janela de horário pode virar a meia-noite (ex.: 22:00 às 02:00). */
function isInsideTimeRange(window: PromotionWindow, date: Date): boolean {
  if (!window.startTime || !window.endTime) return true;
  const now = date.getHours() * 60 + date.getMinutes();
  const start = timeToMinutes(window.startTime);
  const end = timeToMinutes(window.endTime);
  if (start === end) return true;
  if (end > start) return now >= start && now < end;
  return now >= start || now < end;
}

export function promotionStatus(promo: Promotion, at: Date = new Date()): PromotionStatus {
  if (!promo.enabled) return 'pausada';
  if (promo.maxUses > 0 && promo.usedCount >= promo.maxUses) return 'esgotada';

  const today = localDateKey(at);
  const window = promo.window ?? EMPTY_PROMOTION_WINDOW;
  if (window.endDate && today > window.endDate) return 'expirada';
  if (window.startDate && today < window.startDate) return 'agendada';

  const weekdays = window.weekdays ?? [];
  if (weekdays.length > 0 && !weekdays.includes(at.getDay())) return 'fora_da_janela';
  if (!isInsideTimeRange(window, at)) return 'fora_da_janela';

  return 'ativa';
}

export const isPromotionLive = (promo: Promotion, at: Date = new Date()): boolean =>
  promotionStatus(promo, at) === 'ativa';

export function promotionAcceptsChannel(promo: Promotion, channel: 'delivery' | 'pickup'): boolean {
  const target: PromotionChannel = promo.channel ?? 'ambos';
  return target === 'ambos' || target === channel;
}

/** A promoção pega neste produto? 'todos' vale para o cardápio inteiro. */
export function promotionMatchesProduct(
  promo: Promotion,
  product: { id: string; category: string }
): boolean {
  if (promo.kind === 'frete' || promo.kind === 'brinde') return false;
  if (promo.scope === 'todos') return true;
  if (promo.scope === 'produtos') return promo.productIds.includes(product.id);
  return promo.categoryIds.includes(product.category);
}

/** Preço unitário depois do desconto do tipo 'desconto'. Nunca fica negativo. */
export function discountedUnitPrice(promo: Promotion, unitPrice: number): number {
  if (promo.kind !== 'desconto') return unitPrice;
  if (typeof promo.fixedPrice === 'number' && promo.fixedPrice >= 0) {
    return round(Math.min(unitPrice, promo.fixedPrice));
  }
  if (promo.discountPercent && promo.discountPercent > 0) {
    return round(Math.max(0, unitPrice * (1 - promo.discountPercent / 100)));
  }
  if (promo.discountFixed && promo.discountFixed > 0) {
    return round(Math.max(0, unitPrice - promo.discountFixed));
  }
  return unitPrice;
}

/** Margem em % sobre o preço de venda. null quando o custo não foi informado. */
export function marginPercent(price: number, cost?: number): number | null {
  if (typeof cost !== 'number' || cost <= 0 || price <= 0) return null;
  // Margem é porcentagem, não dinheiro: não passa pelo arredondamento de
  // centavos. Duas casas decimais, como qualquer percentual na tela.
  return Math.round(((price - cost) / price) * 10000) / 100;
}

// ---------- Aplicação no carrinho ----------

/** Uma linha do carrinho já resolvida: preço unitário com tamanho e adicionais. */
export interface PromotionCartLine {
  productId: string;
  categoryId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  isFree?: boolean;
}

export interface PromotionContext {
  lines: PromotionCartLine[];
  subtotal: number;
  /** -1 significa endereço fora da área: o frete não é mexido. */
  deliveryFee: number;
  channel: 'delivery' | 'pickup';
  hasCoupon: boolean;
  at?: Date;
  /** Cardápio, só para resolver o produto do brinde. */
  products?: Pick<Product, 'id' | 'name' | 'basePrice'>[];
}

export interface PromotionOutcome {
  /** Desconto sobre os itens, já limitado ao subtotal. */
  itemDiscount: number;
  /** Abatimento no frete, já limitado à taxa cobrada. */
  deliveryDiscount: number;
  applied: AppliedPromotion[];
  /** Promoções que ficariam de fora porque o cliente escolheu usar cupom. */
  blockedByCoupon: Promotion[];
}

const EMPTY_OUTCOME: PromotionOutcome = {
  itemDiscount: 0,
  deliveryDiscount: 0,
  applied: [],
  blockedByCoupon: [],
};

function eligiblePromotions(
  promotions: Promotion[],
  ctx: PromotionContext
): { usable: Promotion[]; blockedByCoupon: Promotion[] } {
  const at = ctx.at ?? new Date();
  const usable: Promotion[] = [];
  const blockedByCoupon: Promotion[] = [];
  for (const promo of promotions) {
    if (!isPromotionLive(promo, at)) continue;
    if (!promotionAcceptsChannel(promo, ctx.channel)) continue;
    if (ctx.subtotal < (promo.minOrderValue || 0)) continue;
    if (ctx.hasCoupon && !promo.stacksWithCoupon) {
      blockedByCoupon.push(promo);
      continue;
    }
    usable.push(promo);
  }
  return { usable, blockedByCoupon };
}

/** Soma um desconto na promoção que já entrou na lista, ou cria a entrada. */
function addApplied(applied: AppliedPromotion[], promo: Promotion, discount: number): void {
  const existing = applied.find((entry) => entry.id === promo.id);
  if (existing) existing.discount = round(existing.discount + discount);
  else applied.push({ id: promo.id, name: promo.name, kind: promo.kind, discount: round(discount) });
}

export function applyPromotions(promotions: Promotion[], ctx: PromotionContext): PromotionOutcome {
  if (!promotions?.length) return { ...EMPTY_OUTCOME };

  const { usable, blockedByCoupon } = eligiblePromotions(promotions, ctx);
  if (!usable.length) return { ...EMPTY_OUTCOME, blockedByCoupon };

  const applied: AppliedPromotion[] = [];
  const paidLines = ctx.lines.filter((line) => !line.isFree && line.quantity > 0);

  // Passo 1 — desconto por item. Cada item recebe só a melhor promoção: duas
  // promoções empilhadas no mesmo prato viram prejuízo sem ninguém perceber.
  const effectiveUnit = paidLines.map((line) => line.unitPrice);
  const discountPromos = usable.filter((promo) => promo.kind === 'desconto');
  let itemDiscount = 0;
  paidLines.forEach((line, index) => {
    let best: { promo: Promotion; unit: number } | null = null;
    for (const promo of discountPromos) {
      if (!promotionMatchesProduct(promo, { id: line.productId, category: line.categoryId })) continue;
      const unit = discountedUnitPrice(promo, line.unitPrice);
      if (unit >= line.unitPrice) continue;
      if (!best || unit < best.unit) best = { promo, unit };
    }
    if (!best) return;
    effectiveUnit[index] = best.unit;
    const saved = round((line.unitPrice - best.unit) * line.quantity);
    itemDiscount = round(itemDiscount + saved);
    addApplied(applied, best.promo, saved);
  });

  // Passo 2 — leve N pague M. As unidades grátis saem das mais baratas do grupo,
  // que é como a loja perde menos e o cliente ainda vê o desconto prometido.
  //
  // MELHOR-DE, não ordem do array: a cada rodada escolhe a promoção leve-pague
  // que rende MAIS desconto sobre as linhas ainda livres, aplica e consome. Sem
  // isto, duas promoções que disputam as mesmas linhas eram resolvidas pela
  // ordem em que vinham no array, e o cliente podia levar menos grátis do que a
  // melhor promoção daria. Cada linha é consumida uma vez só — não há desconto
  // em dobro. O laço acaba quando nenhuma promoção livre ainda rende algo.
  const consumed = new Set<number>();
  const levePague = usable.filter((promo) => promo.kind === 'leve_pague');
  const jaAplicadas = new Set<string>();
  for (;;) {
    let melhor: { promo: Promotion; saved: number; matched: number[] } | null = null;
    for (const promo of levePague) {
      if (jaAplicadas.has(promo.id)) continue;
      const buyQty = Math.max(2, Math.floor(promo.buyQty || 0));
      const payQty = Math.max(1, Math.floor(promo.payQty || 0));
      if (payQty >= buyQty) continue;

      const units: number[] = [];
      const matched: number[] = [];
      paidLines.forEach((line, index) => {
        if (consumed.has(index)) return;
        if (!promotionMatchesProduct(promo, { id: line.productId, category: line.categoryId })) return;
        matched.push(index);
        for (let i = 0; i < line.quantity; i += 1) units.push(effectiveUnit[index]);
      });
      if (units.length < buyQty) continue;

      const freeUnits = Math.floor(units.length / buyQty) * (buyQty - payQty);
      if (freeUnits <= 0) continue;
      units.sort((a, b) => a - b);
      const saved = round(units.slice(0, freeUnits).reduce((sum, price) => sum + price, 0));
      if (saved <= 0) continue;
      if (!melhor || saved > melhor.saved) melhor = { promo, saved, matched };
    }
    if (!melhor) break;
    jaAplicadas.add(melhor.promo.id);
    for (const index of melhor.matched) consumed.add(index);
    itemDiscount = round(itemDiscount + melhor.saved);
    addApplied(applied, melhor.promo, melhor.saved);
  }

  // Passo 3 — brinde. Vale um por pedido: o valor do brinde vira desconto para
  // que subtotal, comprovante e relatório continuem batendo.
  // "Vale um por pedido" sempre foi a regra escrita — mas o laço pagava todos
  // os brindes ativos. Fica só o mais valioso, que é o que o cliente escolheria.
  let melhorBrinde: { promo: Promotion; giftId: string; giftName: string; value: number } | null =
    null;
  for (const promo of usable) {
    if (promo.kind !== 'brinde' || !promo.giftProductId) continue;
    const gift = ctx.products?.find((product) => product.id === promo.giftProductId);
    if (!gift) continue;
    const value = round(Math.max(0, gift.basePrice));
    if (value <= 0) continue;
    if (!melhorBrinde || value > melhorBrinde.value) {
      melhorBrinde = { promo, giftId: gift.id, giftName: gift.name, value };
    }
  }
  if (melhorBrinde) {
    itemDiscount = round(itemDiscount + melhorBrinde.value);
    addApplied(applied, melhorBrinde.promo, melhorBrinde.value);
    const entry = applied.find((item) => item.id === melhorBrinde!.promo.id);
    if (entry) {
      entry.giftProductId = melhorBrinde.giftId;
      entry.giftProductName = melhorBrinde.giftName;
    }
  }

  itemDiscount = round(Math.min(itemDiscount, ctx.subtotal));

  // Passo 4 — frete. Fora da área (-1) o pedido nem sai: não há o que abater.
  let deliveryDiscount = 0;
  if (ctx.channel === 'delivery' && ctx.deliveryFee > 0) {
    for (const promo of usable) {
      if (promo.kind !== 'frete') continue;
      const cut = promo.deliveryFree
        ? ctx.deliveryFee
        : round(Math.max(0, promo.deliveryDiscount || 0));
      if (cut <= 0) continue;
      const remaining = round(ctx.deliveryFee - deliveryDiscount);
      const effective = round(Math.min(cut, remaining));
      if (effective <= 0) continue;
      deliveryDiscount = round(deliveryDiscount + effective);
      addApplied(applied, promo, effective);
    }
  }

  return {
    itemDiscount,
    deliveryDiscount,
    applied: applied.filter((entry) => entry.discount > 0),
    blockedByCoupon,
  };
}

/**
 * Melhor promoção de preço valendo agora para um produto do cardápio.
 * O cliente vê o preço já com desconto; o "leve e pague" não muda o preço
 * unitário, então volta só como selo.
 */
export function bestProductPromotion(
  product: { id: string; category: string; basePrice: number },
  promotions: Promotion[],
  options: { at?: Date; channel?: 'delivery' | 'pickup' } = {}
): { promo: Promotion; price: number } | null {
  const at = options.at ?? new Date();
  let best: { promo: Promotion; price: number } | null = null;
  for (const promo of promotions) {
    if (promo.kind !== 'desconto') continue;
    // Desconto condicionado ao valor do pedido não pode virar preço de
    // vitrine: na vitrine ainda não existe carrinho, e o preço dobraria no
    // checkout quando a condição não fechasse.
    if (promo.minOrderValue && promo.minOrderValue > 0) continue;
    if (!isPromotionLive(promo, at)) continue;
    if (options.channel && !promotionAcceptsChannel(promo, options.channel)) continue;
    if (!promotionMatchesProduct(promo, product)) continue;
    const price = discountedUnitPrice(promo, product.basePrice);
    if (price >= product.basePrice) continue;
    if (!best || price < best.price) best = { promo, price };
  }
  return best;
}

/** Selos ('LEVE 3 PAGUE 2') que valem para o produto mas não mudam o preço. */
export function productPromotionBadges(
  product: { id: string; category: string },
  promotions: Promotion[],
  at: Date = new Date(),
  channel?: 'delivery' | 'pickup'
): string[] {
  return promotions
    .filter(
      (promo) =>
        promo.kind === 'leve_pague' &&
        isPromotionLive(promo, at) &&
        (!channel || promotionAcceptsChannel(promo, channel)) &&
        promotionMatchesProduct(promo, product)
    )
    .map((promo) => promo.badge || `LEVE ${promo.buyQty} PAGUE ${promo.payQty}`);
}

// ---------- Texto para a tela ----------

/** Apelido local do formatador ÚNICO (`contract/pricing/money.ts`). */
const money = formatMoney;

/** Frase curta que explica a regra da promoção, usada na lista e na vitrine. */
export function describePromotion(promo: Promotion): string {
  switch (promo.kind) {
    case 'desconto':
      if (typeof promo.fixedPrice === 'number' && promo.fixedPrice > 0)
        return `Por apenas ${money(promo.fixedPrice)}`;
      if (promo.discountPercent) return `${promo.discountPercent}% de desconto`;
      if (promo.discountFixed) return `${money(promo.discountFixed)} de desconto`;
      return 'Desconto sem valor definido';
    case 'leve_pague':
      return `Leve ${promo.buyQty ?? 0}, pague ${promo.payQty ?? 0}`;
    case 'brinde':
      return promo.minOrderValue > 0
        ? `Brinde acima de ${money(promo.minOrderValue)}`
        : 'Brinde no pedido';
    case 'frete':
      return promo.deliveryFree
        ? `Frete grátis acima de ${money(promo.minOrderValue)}`
        : `${money(promo.deliveryDiscount || 0)} de desconto no frete`;
    default:
      return '';
  }
}

/** Quando a promoção vale, em uma linha ('Sex e Sáb, 18:00 às 22:00'). */
export function describeWindow(window: PromotionWindow | undefined): string {
  const w = window ?? EMPTY_PROMOTION_WINDOW;
  const parts: string[] = [];
  const weekdays = w.weekdays ?? [];
  parts.push(
    weekdays.length === 0 || weekdays.length === 7
      ? 'Todos os dias'
      : [...weekdays].sort((a, b) => a - b).map((day) => WEEKDAY_LABELS[day]).join(', ')
  );
  if (w.startTime && w.endTime) parts.push(`${w.startTime} às ${w.endTime}`);
  if (w.startDate || w.endDate) {
    const from = w.startDate ? w.startDate.split('-').reverse().join('/') : 'hoje';
    const to = w.endDate ? w.endDate.split('-').reverse().join('/') : 'sem fim';
    parts.push(`${from} → ${to}`);
  }
  return parts.join(' · ');
}
