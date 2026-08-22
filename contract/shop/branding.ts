import type { StoreSettings } from './types';

/**
 * A identidade visual de uma loja, por app.
 *
 * Os três manifestos eram arquivos ESTÁTICOS em `public/` com "Caldinho da
 * Jessica" escrito dentro. Toda loja da plataforma instalaria um atalho com o
 * nome e a cor da primeira — e um PWA instalado guarda esse nome no aparelho,
 * então não é um detalhe que se conserta depois.
 *
 * Este módulo é puro: monta o manifesto a partir das configurações. Quem serve
 * a rota é `server/http/routers/appShell.ts`.
 */

export type AppRole = 'client' | 'kitchen' | 'driver';

export const APP_ROLES: AppRole[] = ['client', 'kitchen', 'driver'];

/** O caminho de cada app dentro do domínio da loja. */
export const ROLE_PATH: Record<AppRole, string> = {
  client: '/',
  kitchen: '/cozinha',
  driver: '/entregador',
};

/**
 * A cor da barra de status no modo instalado. Ela SEPARA os três apps na tela
 * do aparelho: o dono da loja tem os três instalados no mesmo celular, e sem
 * cores distintas ele abre o do cliente achando que é a cozinha.
 *
 * A do cliente vem da marca da loja; as outras duas são fixas de propósito — a
 * cozinha e o motoboy são ferramentas de trabalho, não vitrine.
 */
export const ROLE_THEME: Record<AppRole, string> = {
  client: '#B91C1C',
  kitchen: '#1C1917',
  driver: '#7C3AED',
};

export interface ShopBranding {
  /** Cor da marca da loja. Vazio = o vermelho padrão. */
  primaryColor?: string;
  /** Prefixo dos ícones desta loja, ex.: `/api/uploads/2/icons`. Vazio = os padrões. */
  iconBase?: string;
}

/** O sufixo que aparece sob o ícone, por app. */
function tituloDoApp(role: AppRole, storeName: string): string {
  if (role === 'kitchen') return `Cozinha · ${storeName}`;
  if (role === 'driver') return `Entrega · ${storeName}`;
  return storeName;
}

/**
 * O nome sob o ícone tem pouco espaço: o iOS corta por volta de 12 caracteres e
 * o Android por volta de 12 também. Um nome longo vira reticências, e três apps
 * da mesma loja ficam indistinguíveis.
 */
function nomeCurto(role: AppRole, storeName: string): string {
  if (role === 'kitchen') return 'Cozinha';
  if (role === 'driver') return 'Entrega';
  if (storeName.length <= 12) return storeName;

  // Corta na palavra, não no caractere: "Pizzaria do " com espaço solto no fim
  // fica pior do que "Pizzaria". Se nem a primeira palavra couber, aí sim corta.
  const cortado = storeName.slice(0, 12);
  const ultimoEspaco = cortado.lastIndexOf(' ');
  return (ultimoEspaco > 0 ? cortado.slice(0, ultimoEspaco) : cortado).trim();
}

/**
 * Sem artigo antes do nome ("no ${nome}", "do ${nome}"): o nome da loja pode ser
 * masculino, feminino ou plural, e um artigo fixo acerta um terço das vezes
 * ("Peça no Pizzaria do João").
 */
const DESCRICAO: Record<AppRole, (nome: string) => string> = {
  client: (nome) => `${nome}: peça e acompanhe a entrega em tempo real.`,
  kitchen: (nome) => `${nome} — painel da cozinha: pedidos, cardápio e entregas.`,
  driver: (nome) => `${nome} — app de entrega: corridas, rota e status.`,
};

const ICONES_PADRAO: Record<AppRole, string> = {
  client: '/icons/cliente',
  kitchen: '/icons/cozinha',
  driver: '/icons/entregador',
};

/** O manifesto de um app desta loja, pronto para virar JSON. */
export function buildManifest(
  role: AppRole,
  settings: Pick<StoreSettings, 'storeName'>,
  branding: ShopBranding = {}
): Record<string, unknown> {
  const nome = settings.storeName.trim() || 'Delivery';
  // `iconBase` só vale como CAMINHO RELATIVO (`/algo`): uma URL absoluta
  // (`https://...`) faria cada ícone do manifesto e da notificação ser buscado
  // de outro host no aparelho do cliente.
  const iconeSeguro =
    typeof branding.iconBase === 'string' && /^\/[^/]/.test(branding.iconBase.trim())
      ? branding.iconBase.trim()
      : null;
  const icones = iconeSeguro || ICONES_PADRAO[role];
  const escopo = ROLE_PATH[role];

  return {
    // O `id` separa os três apps para o navegador. Sem ele, instalar o segundo
    // substituiria o primeiro — eles saem do mesmo domínio.
    id: escopo,
    name: tituloDoApp(role, nome),
    short_name: nomeCurto(role, nome),
    description: DESCRICAO[role](nome),
    start_url: escopo,
    scope: escopo,
    display: 'standalone',
    orientation: 'portrait',
    theme_color: role === 'client' ? branding.primaryColor || ROLE_THEME.client : ROLE_THEME[role],
    background_color: '#F5F5F4',
    lang: 'pt-BR',
    dir: 'ltr',
    categories: ['food', 'shopping'],
    icons: [
      { src: `${icones}-icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${icones}-icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${icones}-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

/** O rótulo de `role` usado na URL do manifesto. */
export const ROLE_SLUG: Record<AppRole, string> = {
  client: 'cliente',
  kitchen: 'cozinha',
  driver: 'entregador',
};

export function roleFromSlug(slug: string): AppRole | null {
  const achado = APP_ROLES.find((role) => ROLE_SLUG[role] === slug);
  return achado ?? null;
}
