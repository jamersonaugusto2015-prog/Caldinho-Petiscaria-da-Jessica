import {
  db,
  getLoyaltyPoints,
  addLoyaltyPoints,
  deductLoyaltyPoints,
  createFreeRedeem,
  peekFreeRedeem,
  consumeFreeRedeem,
} from './db';
import { loadProduct } from './orderStore';
import { DomainError } from './errors';
import { LOYALTY_STAMP_COST } from '../src/shared/constants';
import { CartItem } from '../src/types';

export const getCustomerStamps = (customerId: string): number => getLoyaltyPoints(customerId);
export const hasFreeRedeem = (token: string, productId: string): boolean => peekFreeRedeem(token, productId);

export function earnStamp(customerId: string): number | null {
  if (!customerId || customerId === 'anon') return null;
  return addLoyaltyPoints(customerId, 1);
}

export function redeemFreeCaldinho(
  customerId: string,
  productId: string
): { points: number; token: string } {
  if (!customerId || customerId === 'anon') {
    throw new DomainError(400, 'Cliente inválido.');
  }
  const points = getLoyaltyPoints(customerId);
  if (points < LOYALTY_STAMP_COST) {
    throw new DomainError(400, 'Selos insuficientes.');
  }
  const product = loadProduct(productId);
  if (!product || product.category !== 'caldinhos') {
    throw new DomainError(400, 'Produto inválido para resgate.');
  }
  let newPoints = points;
  let token = '';
  try {
    db.transaction(() => {
      newPoints = deductLoyaltyPoints(customerId, LOYALTY_STAMP_COST);
      token = createFreeRedeem(productId);
    })();
  } catch {
    throw new DomainError(400, 'Não foi possível resgatar.');
  }
  return { points: newPoints, token };
}


export function consumeFreeItems(items: CartItem[]): void {
  for (const it of items) {
    if (!it.isFree) continue;
    if (!it.freeToken || !consumeFreeRedeem(it.freeToken, it.product.id)) {
      throw new DomainError(400, 'Item grátis de fidelidade inválido. Verifique seus selos.');
    }
  }
}

/** Undoes consumeFreeItems when a charge or persistence fails after the token was reserved. */
export function releaseFreeItems(items: CartItem[]): void {
  for (const it of items) {
    if (!it.isFree || !it.freeToken) continue;
    db.prepare('UPDATE free_redeems SET used = 0 WHERE token = ? AND product_id = ?').run(
      it.freeToken,
      it.product.id
    );
  }
}
