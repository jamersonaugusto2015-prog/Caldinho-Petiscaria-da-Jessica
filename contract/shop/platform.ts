import { z } from 'zod';
import { isValidShopSlug } from './tenant';

/**
 * O que o painel super-admin manda ao criar ou mexer numa loja.
 *
 * Mora no contrato porque o formulário do painel e a rota precisam concordar
 * sobre o que é um `slug` válido — e um `slug` inválido não é um erro de
 * digitação qualquer: ele vira um subdomínio que ninguém consegue acessar.
 */

/** Rótulos que não podem virar loja: são endereços da própria plataforma. */
export const SLUGS_RESERVADOS = [
  'www',
  'api',
  'admin',
  'app',
  'painel',
  'plataforma',
  'static',
  'assets',
  'cdn',
  'mail',
  'ftp',
];

/**
 * O endereço sugerido a partir do nome da loja: "Hamburgueria do Zé" vira
 * "hamburgueria-do-ze".
 *
 * Existe porque pedir ao dono da plataforma que invente um subdomínio é pedir
 * um erro de digitação num endereço que não pode ser trocado depois sem quebrar
 * o link que os clientes já salvaram.
 *
 * `normalize('NFD')` separa a letra do acento, e o `replace` seguinte joga os
 * acentos fora — `ç` vira `c`, `é` vira `e`. Sem isso o subdomínio sairia com
 * caracteres que o DNS não aceita.
 */
export function slugSugerido(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
}

export const novaLojaSchema = z.object({
  /**
   * O subdomínio. É o endereço da loja no mundo — `loja-x.dominio.com.br` — e
   * não pode ser trocado depois sem quebrar o link que os clientes salvaram.
   */
  slug: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .refine(isValidShopSlug, 'use letras minúsculas, números e hífen (sem começar nem terminar com hífen)')
    .refine((v) => !SLUGS_RESERVADOS.includes(v), 'este endereço é reservado pela plataforma'),
  name: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length >= 2, 'o nome da loja precisa ter ao menos 2 letras')
    .refine((v) => v.length <= 80, 'o nome da loja passou de 80 caracteres'),
  /** PIN inicial da cozinha. Vazio = `1234`, que o painel manda trocar. */
  kitchenPin: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v === '' || /^\d{4,8}$/.test(v), 'o PIN precisa ter de 4 a 8 números')
    .optional(),
  /** Cor da marca, em `#RRGGBB`. */
  brandPrimaryColor: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v === '' || /^#[0-9a-fA-F]{6}$/.test(v), 'use uma cor no formato #RRGGBB')
    .optional(),
  city: z.string().transform((v) => v.trim().slice(0, 80)).optional(),
  pixKey: z.string().transform((v) => v.trim().slice(0, 140)).optional(),
});

export type NovaLoja = z.infer<typeof novaLojaSchema>;

export const alterarLojaSchema = z
  .object({
    active: z.boolean(),
    name: z
      .string()
      .transform((v) => v.trim())
      .refine((v) => v.length >= 2, 'nome curto demais')
      .refine((v) => v.length <= 80, 'o nome da loja passou de 80 caracteres'),
  })
  .partial()
  .strict();

export const loginPlataformaSchema = z.object({
  email: z.string().transform((v) => v.trim()),
  password: z.string(),
});

/**
 * O endereço da loja no mundo, ou `null` quando a plataforma ainda não sabe qual
 * é o domínio dela.
 *
 * `null` é uma resposta de verdade, não um erro: sem `SHOP_BASE_DOMAIN` não
 * existe endereço nenhum para essa loja. O painel precisa DIZER isso, e não
 * inventar um link — `/?loja=slug` funciona só em desenvolvimento (o header
 * `x-shop-slug` é ignorado em produção, de propósito), então entregá-lo ao dono
 * da loja é entregar um link quebrado com cara de link bom.
 */
export function shopUrl(slug: string, baseDomain: string | undefined): string | null {
  return baseDomain ? `https://${slug}.${baseDomain}` : null;
}

/** O que o painel vê de cada loja na lista. */
export interface ShopStatus {
  id: number;
  slug: string;
  name: string;
  active: boolean;
  createdAt: string;
  /** Quantos pedidos entraram hoje. É o sinal de "esta loja está viva". */
  ordersToday: number;
  /** Faturamento de hoje, em centavos. */
  revenueTodayCents: number;
  mercadoPagoConnected: boolean;
  /** O endereço da loja no mundo. `null` = a plataforma está sem domínio configurado. */
  url: string | null;
}
