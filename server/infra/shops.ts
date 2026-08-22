import { db } from '../db';
import type { Shop, ShopId } from '../../contract/shop/types';

/**
 * A tabela de lojas. É a raiz do multi-tenant: toda requisição começa por uma
 * consulta daqui.
 *
 * Por isso o cache. A resolução por `Host` acontece em TODA requisição — a de
 * cardápio, a de pedido, a do socket. Sem cache, cada uma delas paga uma
 * consulta ao SQLite antes de fazer qualquer coisa. A tabela é minúscula e muda
 * quase nunca (só quando o painel super-admin cria ou desativa uma loja), então
 * ela cabe inteira na memória.
 *
 * `invalidateShopCache()` é obrigatório em qualquer escrita — está do lado de
 * fora de propósito, para que a rota que cria uma loja tenha que dizer que
 * mudou algo.
 */

let porSlug: Map<string, Shop> | null = null;
let porId: Map<ShopId, Shop> | null = null;

function linhaParaShop(row: {
  id: number;
  slug: string;
  name: string;
  active: number;
  created_at: string;
}): Shop {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

function carregar(): void {
  if (porSlug && porId) return;
  const rows = db.prepare('SELECT id, slug, name, active, created_at FROM shops').all() as {
    id: number;
    slug: string;
    name: string;
    active: number;
    created_at: string;
  }[];
  porSlug = new Map();
  porId = new Map();
  for (const row of rows) {
    const shop = linhaParaShop(row);
    porSlug.set(shop.slug, shop);
    porId.set(shop.id, shop);
  }
}

let aoMudar: (() => void) | null = null;

/**
 * Um único ouvinte, registrado pelo servidor: derrubar os sockets de loja
 * recém-desativada. O HTTP corta sozinho (o cache invalidado faz a próxima
 * requisição enxergar a loja nova) — mas socket vivo não faz "próxima
 * requisição".
 */
export function onShopsChanged(listener: () => void): void {
  aoMudar = listener;
}

/** Chame depois de QUALQUER escrita em `shops`. */
export function invalidateShopCache(): void {
  porSlug = null;
  porId = null;
  aoMudar?.();
}

export function shopBySlug(slug: string): Shop | null {
  carregar();
  return porSlug?.get(slug) ?? null;
}

export function shopById(id: ShopId): Shop | null {
  carregar();
  return porId?.get(id) ?? null;
}

export function listShops(): Shop[] {
  carregar();
  return [...(porId?.values() ?? [])];
}
