/**
 * A loja escolhida à mão, SÓ em desenvolvimento.
 *
 * Em produção a loja sai da ORIGEM: `loja-a.dominio.com.br` é a loja A, e o
 * navegador nem precisa saber que existe uma loja B. As 18 chaves de
 * `localStorage`, os cookies e o service worker já ficam separados por origem,
 * de graça.
 *
 * Em `npm run dev` o endereço é `localhost:3000` — uma origem só, sem
 * subdomínio. Sem uma forma de dizer "quero a loja B", não dá para testar
 * multi-loja na máquina.
 *
 * A trava está no SERVIDOR, não aqui: `middleware/tenant.ts` só olha o header
 * `x-shop-slug` quando `NODE_ENV !== 'production'`. Mandar este header contra o
 * servidor de produção não muda nada — o que é a regra inteira do multi-tenant:
 * a loja nunca é escolhida pelo cliente.
 */

const CHAVE = 'ce_dev_shop_slug';

/** `true` quando o app está rodando pelo `vite dev`. */
export function isDev(): boolean {
  return import.meta.env?.DEV === true;
}

/** O rótulo da loja escolhida para o desenvolvimento, ou `''`. */
export function devShopSlug(): string {
  if (!isDev()) return '';
  try {
    // A query vence o guardado: `?loja=pizzaria` na barra de endereço é como se
    // troca de loja durante o desenvolvimento, sem abrir o console.
    const daUrl = new URLSearchParams(location.search).get('loja');
    if (daUrl) {
      localStorage.setItem(CHAVE, daUrl.trim());
      return daUrl.trim();
    }
    return localStorage.getItem(CHAVE) || '';
  } catch {
    return '';
  }
}

/** O header a acrescentar em toda requisição, ou `{}` em produção. */
export function devShopHeader(): Record<string, string> {
  const slug = devShopSlug();
  return slug ? { 'x-shop-slug': slug } : {};
}
