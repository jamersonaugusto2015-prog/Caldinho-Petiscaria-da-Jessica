/**
 * De onde vem a loja de uma requisição.
 *
 * A regra que não pode ser quebrada em lugar nenhum: **`shopId` nunca é
 * entrada**. Ele vem do `Host` (para o cliente) ou da credencial (para a
 * equipe) — nunca do corpo, nunca da query. Um `shopId` que o cliente escolhe é
 * a chave dos pedidos de qualquer loja.
 *
 * Este módulo é puro: só extrai o rótulo do `Host`. Quem traduz rótulo em loja é
 * `server/http/middleware/tenant.ts`, que precisa do banco.
 */

/**
 * O subdomínio de um `Host`, ou `null` quando não há um.
 *
 * `loja-x.dominio.com.br` → `loja-x`
 * `dominio.com.br`        → null  (o domínio raiz é a plataforma, não uma loja)
 * `localhost:3000`        → null
 *
 * A porta é descartada, e o resultado vem em minúsculas: o `Host` é
 * insensível a maiúsculas por especificação, mas o `slug` no banco não é.
 */
export function slugFromHost(host: string | undefined, baseDomain?: string): string | null {
  if (!host) return null;

  // `Host` pode chegar com a porta (`loja-a.dominio.com.br:3000`), em IPv6
  // entre colchetes, e com o ponto final de um nome plenamente qualificado
  // (`dominio.com.br.`). Nenhum dos três é parte do nome.
  const nome = host.trim().toLowerCase().replace(/^\[.*\]/, '').split(':')[0].replace(/\.+$/, '');
  if (!nome) return null;

  // Endereço IP não tem subdomínio: `192.168.0.10` viraria o rótulo "192".
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(nome)) return null;

  if (baseDomain) {
    const base = baseDomain.trim().toLowerCase();
    if (nome === base) return null;
    if (!nome.endsWith(`.${base}`)) return null;
    const prefixo = nome.slice(0, -(base.length + 1));
    // `a.b.dominio.com.br` não é uma loja: um rótulo só, ou nada.
    if (prefixo.includes('.')) return null;
    // `www` é o site, não uma loja chamada "www" — nos dois caminhos.
    if (prefixo === 'www') return null;
    return prefixo || null;
  }

  /**
   * Sem `baseDomain`, sobra a heurística — e ela É AMBÍGUA no Brasil.
   *
   * `dominio.com.br` (domínio raiz, TLD de duas partes) tem exatamente o mesmo
   * formato de `loja.dominio.com` (subdomínio, TLD de uma parte): três rótulos.
   * A heurística lê os dois do mesmo jeito e chamaria o domínio raiz de uma
   * loja chamada "dominio".
   *
   * Por isso `SHOP_BASE_DOMAIN` não é opcional de verdade em produção: o boot
   * avisa quando ela falta. Aqui a heurística fica como conveniência de
   * desenvolvimento, onde o host costuma ser `localhost`.
   */
  const partes = nome.split('.');
  if (partes.length < 3) return null;
  // `www` é o site, não uma loja chamada "www".
  return partes[0] === 'www' ? null : partes[0];
}

/**
 * O rótulo é aceitável como `slug` de loja?
 *
 * Confere ANTES de ir ao banco. Um `Host` é entrada do mundo, e um rótulo
 * estranho vindo dele não deveria nem virar uma consulta.
 */
export function isValidShopSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug);
}
