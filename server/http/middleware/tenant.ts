import type { NextFunction, Request, Response } from 'express';
import type { Shop } from '../../../contract/shop/types';
import { isValidShopSlug, slugFromHost } from '../../../contract/shop/tenant';
import { shopBySlug } from '../../infra/shops';
import { config } from '../../config';
import { LOJA_PADRAO } from '../../db';
import { shopById } from '../../infra/shops';

/**
 * O coração do multi-tenant: quem descobre de que loja é a requisição.
 *
 * A regra que não pode ser quebrada: **`shopId` nunca vem do corpo nem da
 * query**. Ele vem do `Host` — e o `Host` o navegador não escolhe, o DNS
 * escolhe. Um `shopId` que o cliente informa seria a chave de leitura dos
 * pedidos de qualquer loja.
 *
 * A ordem é deliberada:
 *
 * 1. **O `Host`.** É a fonte de verdade em produção.
 * 2. **O header `x-shop-slug`, SÓ fora de produção.** Em desenvolvimento o
 *    endereço é `localhost:3000`, que não tem subdomínio para carregar a loja.
 *    Aceitar esse header em produção daria de volta exatamente o que a regra
 *    acima proíbe: a loja escolhida pelo cliente.
 * 3. **A loja padrão, SÓ fora de produção.** Para o `npm run dev` continuar
 *    subindo sem configurar nada.
 *
 * Loja inexistente ou desativada = 404, e não um erro genérico: o domínio
 * simplesmente não atende ninguém.
 */

declare module 'express-serve-static-core' {
  interface Request {
    /** A loja desta requisição. Presente depois do `resolveTenant`. */
    shop?: Shop;
  }
}

/**
 * A resolução em si, sem `express`.
 *
 * Vive separada porque o socket.io também precisa dela: o handshake tem `Host`
 * mas não tem `Request`. Uma resolução para os dois transportes é o que impede
 * o socket de entrar numa loja diferente da que o HTTP autenticou.
 */
export function resolveShop(entrada: {
  host?: string;
  headerSlug?: string;
}): Shop | null | 'plataforma' {
  // Lido a cada chamada, e não guardado numa constante do módulo: uma cópia
  // congelada no import ignora qualquer mudança de configuração depois — e é
  // exatamente o que faz um teste passar por acidente.
  const slug = slugFromHost(entrada.host, config.SHOP_BASE_DOMAIN);

  if (slug) {
    if (!isValidShopSlug(slug)) return null;
    return shopBySlug(slug);
  }

  // Sem subdomínio. Em produção isto é o domínio raiz: a plataforma, não uma
  // loja. É lá que o painel super-admin vai morar (Fase 9).
  if (config.isProduction) return 'plataforma';

  const doHeader = String(entrada.headerSlug || '').trim().toLowerCase();
  if (doHeader) {
    return isValidShopSlug(doHeader) ? shopBySlug(doHeader) : null;
  }

  return shopById(LOJA_PADRAO);
}

export function resolveShopFromRequest(req: Request): Shop | null | 'plataforma' {
  // `req.get('host')` de propósito, NUNCA `req.hostname`: com `trust proxy`
  // ligado, `req.hostname` honra `X-Forwarded-Host` — um header que o cliente
  // escreve. Trocar esta linha entrega a escolha da loja ao cliente.
  return resolveShop({ host: req.get('host'), headerSlug: req.get('x-shop-slug') });
}

/**
 * Põe `req.shop` ou responde 404. Toda rota de loja depende dele.
 */
export function resolveTenant(req: Request, res: Response, next: NextFunction): void {
  const resolvido = resolveShopFromRequest(req);

  if (resolvido === 'plataforma') {
    res.status(404).json({
      error: 'Este endereço não atende nenhuma loja. Use o endereço da loja.',
    });
    return;
  }
  if (!resolvido) {
    res.status(404).json({ error: 'Loja não encontrada.' });
    return;
  }
  if (!resolvido.active) {
    // Desativada não é "não existe": a diferença importa para o dono, que
    // precisa entender por que o próprio endereço parou de responder.
    res.status(404).json({ error: 'Esta loja está desativada no momento.' });
    return;
  }

  req.shop = resolvido;
  next();
}

/**
 * A loja da requisição. Lança se o `resolveTenant` não rodou antes — em vez de
 * devolver a loja 1 em silêncio, que é o erro que faz uma loja servir dados da
 * outra sem ninguém perceber.
 */
export function currentShop(req: Request): Shop {
  if (!req.shop) {
    throw new Error('currentShop chamado numa rota sem resolveTenant');
  }
  return req.shop;
}

/** Atalho: só o id, que é o que quase todo chamador quer. */
export function shopIdOf(req: Request): number {
  return currentShop(req).id;
}
