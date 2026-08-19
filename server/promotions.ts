import { db } from './db';
import { DomainError } from './errors';
import type {
  AppliedPromotion,
  Promotion,
  PromotionChannel,
  PromotionKind,
  PromotionScope,
  PromotionWindow,
} from '../src/types';

const KINDS: PromotionKind[] = ['desconto', 'leve_pague', 'brinde', 'frete'];
const SCOPES: PromotionScope[] = ['produtos', 'categorias', 'todos'];
const CHANNELS: PromotionChannel[] = ['ambos', 'delivery', 'pickup'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const round = (value: number) => Math.round(value * 100) / 100;
const positive = (value: unknown) => Math.max(0, round(Number(value) || 0));

function ids(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id): id is string => typeof id === 'string' && !!id.trim()).map((id) => id.trim()))].slice(0, 200);
}

function normalizeWindow(raw: unknown): PromotionWindow {
  const w = (raw ?? {}) as Record<string, unknown>;
  const weekdays = Array.isArray(w.weekdays)
    ? [...new Set(w.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [];
  const date = (value: unknown) =>
    typeof value === 'string' && DATE_RE.test(value) ? value : undefined;
  const time = (value: unknown) =>
    typeof value === 'string' && TIME_RE.test(value) ? value : undefined;
  return {
    startDate: date(w.startDate),
    endDate: date(w.endDate),
    weekdays,
    startTime: time(w.startTime),
    endTime: time(w.endTime),
  };
}

/**
 * O corpo vem do painel, mas nada impede um POST cru: cada campo é conferido e
 * o que não faz sentido para o tipo escolhido é jogado fora, para a promoção
 * gravada nunca contradizer o que a tela mostrou.
 */
export function normalizePromotion(body: unknown, existing?: Promotion): Promotion {
  const b = (body ?? {}) as Record<string, unknown>;

  const name = typeof b.name === 'string' ? b.name.trim() : existing?.name ?? '';
  if (!name) throw new DomainError(400, 'Dê um nome para a promoção.');

  const kind = KINDS.includes(b.kind as PromotionKind)
    ? (b.kind as PromotionKind)
    : existing?.kind ?? 'desconto';
  const scope = SCOPES.includes(b.scope as PromotionScope)
    ? (b.scope as PromotionScope)
    : existing?.scope ?? 'produtos';
  const channel = CHANNELS.includes(b.channel as PromotionChannel)
    ? (b.channel as PromotionChannel)
    : existing?.channel ?? 'ambos';

  const promo: Promotion = {
    id: existing?.id || 'promo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    name: name.slice(0, 60),
    kind,
    enabled: typeof b.enabled === 'boolean' ? b.enabled : existing?.enabled ?? true,
    scope,
    productIds: b.productIds !== undefined ? ids(b.productIds) : existing?.productIds ?? [],
    categoryIds: b.categoryIds !== undefined ? ids(b.categoryIds) : existing?.categoryIds ?? [],
    minOrderValue: b.minOrderValue !== undefined ? positive(b.minOrderValue) : existing?.minOrderValue ?? 0,
    channel,
    maxUses: b.maxUses !== undefined ? Math.max(0, Math.floor(Number(b.maxUses) || 0)) : existing?.maxUses ?? 0,
    usedCount: existing?.usedCount ?? 0,
    stacksWithCoupon:
      typeof b.stacksWithCoupon === 'boolean' ? b.stacksWithCoupon : existing?.stacksWithCoupon ?? false,
    highlight: typeof b.highlight === 'boolean' ? b.highlight : existing?.highlight ?? true,
    badge:
      typeof b.badge === 'string' && b.badge.trim() ? b.badge.trim().slice(0, 20) : existing?.badge,
    window: b.window !== undefined ? normalizeWindow(b.window) : existing?.window ?? { weekdays: [] },
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    totalDiscount: existing?.totalDiscount ?? 0,
    totalRevenue: existing?.totalRevenue ?? 0,
    totalOrders: existing?.totalOrders ?? 0,
  };

  if (kind === 'desconto') {
    const percent = positive(b.discountPercent ?? existing?.discountPercent);
    const fixed = positive(b.discountFixed ?? existing?.discountFixed);
    const price = positive(b.fixedPrice ?? existing?.fixedPrice);
    // Só uma forma de preço por promoção: com duas, o desconto mostrado ao
    // cliente dependeria da ordem em que o motor leu os campos.
    if (price > 0) promo.fixedPrice = price;
    else if (percent > 0) promo.discountPercent = Math.min(100, percent);
    else if (fixed > 0) promo.discountFixed = fixed;
    else throw new DomainError(400, 'Informe o desconto: porcentagem, valor fixo ou "por apenas".');
  }

  if (kind === 'leve_pague') {
    const buyQty = Math.floor(Number(b.buyQty ?? existing?.buyQty) || 0);
    const payQty = Math.floor(Number(b.payQty ?? existing?.payQty) || 0);
    if (buyQty < 2 || payQty < 1 || payQty >= buyQty) {
      throw new DomainError(400, 'No "leve e pague", o leve precisa ser maior que o pague (ex.: leve 3, pague 2).');
    }
    promo.buyQty = buyQty;
    promo.payQty = payQty;
  }

  if (kind === 'brinde') {
    const giftProductId = typeof b.giftProductId === 'string' ? b.giftProductId.trim() : existing?.giftProductId;
    if (!giftProductId) throw new DomainError(400, 'Escolha o produto que vai de brinde.');
    promo.giftProductId = giftProductId;
    promo.scope = 'todos';
  }

  if (kind === 'frete') {
    const free = typeof b.deliveryFree === 'boolean' ? b.deliveryFree : existing?.deliveryFree ?? true;
    promo.deliveryFree = free;
    promo.deliveryDiscount = free ? 0 : positive(b.deliveryDiscount ?? existing?.deliveryDiscount);
    if (!free && promo.deliveryDiscount <= 0) {
      throw new DomainError(400, 'Informe quanto abater do frete, ou marque frete grátis.');
    }
    promo.channel = 'delivery';
    promo.scope = 'todos';
  }

  if (promo.scope === 'produtos' && promo.productIds.length === 0 && (kind === 'desconto' || kind === 'leve_pague')) {
    throw new DomainError(400, 'Escolha ao menos um produto para a promoção.');
  }
  if (promo.scope === 'categorias' && promo.categoryIds.length === 0) {
    throw new DomainError(400, 'Escolha ao menos uma categoria para a promoção.');
  }

  return promo;
}

export function listPromotions(): Promotion[] {
  const rows = db.prepare('SELECT data FROM promotions ORDER BY rowid').all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Promotion);
}

export function getPromotion(id: string): Promotion | null {
  const row = db.prepare('SELECT data FROM promotions WHERE id = ?').get(id) as
    | { data: string }
    | undefined;
  return row ? (JSON.parse(row.data) as Promotion) : null;
}

function write(promo: Promotion): Promotion {
  db.prepare(
    'INSERT INTO promotions (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data'
  ).run(promo.id, JSON.stringify(promo));
  return promo;
}

export function createPromotion(body: unknown): Promotion {
  return write(normalizePromotion(body));
}

export function updatePromotion(id: string, body: unknown): Promotion {
  const existing = getPromotion(id);
  if (!existing) throw new DomainError(404, 'Promoção não encontrada.');
  return write(normalizePromotion(body, existing));
}

export function deletePromotion(id: string): void {
  const existing = getPromotion(id);
  if (!existing) throw new DomainError(404, 'Promoção não encontrada.');
  db.prepare('DELETE FROM promotions WHERE id = ?').run(id);
}

/** Zera o contador de usos sem apagar o histórico de faturamento. */
export function resetPromotionUses(id: string): Promotion {
  const existing = getPromotion(id);
  if (!existing) throw new DomainError(404, 'Promoção não encontrada.');
  return write({ ...existing, usedCount: 0 });
}

/**
 * Grava o resultado de um pedido nas promoções que pegaram. Roda dentro da
 * transação do pedido: se o pedido não entrar, o contador não sobe.
 */
export function registerPromotionUses(applied: AppliedPromotion[], orderTotal: number): void {
  for (const entry of applied) {
    const promo = getPromotion(entry.id);
    if (!promo) continue;
    write({
      ...promo,
      usedCount: promo.usedCount + 1,
      totalOrders: (promo.totalOrders ?? 0) + 1,
      totalDiscount: round((promo.totalDiscount ?? 0) + entry.discount),
      totalRevenue: round((promo.totalRevenue ?? 0) + orderTotal),
    });
  }
}
