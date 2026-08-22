/**
 * A marca da loja, injetada como variáveis CSS.
 *
 * O app tem 510 cores escritas à mão em `#RRGGBB` espalhadas pelas telas. Numa
 * plataforma com várias lojas isso significa que TODA loja é vermelha —
 * a pizzaria, a sorveteria e o caldinho, todas com o mesmo `#B91C1C`.
 *
 * A troca das 510 é um trabalho longo e mecânico. O que este módulo faz é abrir
 * o caminho: publica a marca da loja como variáveis CSS no `<html>`, para que
 * cada cor convertida passe a seguir a loja sem precisar de mais nada. Enquanto
 * a conversão não acontece, o valor padrão é exatamente a cor de hoje — nada
 * muda de aparência.
 *
 * As variáveis são usadas em CSS como `var(--marca)` e no Tailwind como
 * `bg-[var(--marca)]`.
 */

/** A cor da marca quando a loja não escolheu nenhuma. É o vermelho de sempre. */
export const MARCA_PADRAO = '#B91C1C';

/** O tom escuro do estado `:hover` da cor da marca. */
export const MARCA_ESCURA_PADRAO = '#991B1B';

export interface ShopTokens {
  /** Cor principal da loja. */
  marca: string;
  /** A mesma cor, mais escura, para `:hover` e estados pressionados. */
  marcaEscura: string;
}

/**
 * Escurece uma cor `#RRGGBB` numa fração.
 *
 * Existe para a loja precisar escolher UMA cor, e não duas. Pedir a cor de
 * hover no painel é pedir para o dono acertar um par harmônico — e o que ele
 * acerta é a cor da fachada, não a matemática do estado pressionado.
 */
export function escurecer(hex: string, fracao = 0.18): string {
  const limpo = hex.trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(limpo)) return hex;
  const escala = Math.max(0, Math.min(1, 1 - fracao));
  const canal = (inicio: number) =>
    Math.round(parseInt(limpo.slice(inicio, inicio + 2), 16) * escala)
      .toString(16)
      .padStart(2, '0');
  return `#${canal(0)}${canal(2)}${canal(4)}`;
}

/** Uma cor só é aceita se for `#RRGGBB`: qualquer outra coisa vira CSS quebrado. */
export function corValida(valor: string | undefined): boolean {
  return !!valor && /^#[0-9a-f]{6}$/i.test(valor.trim());
}

export function tokensDaLoja(primaryColor?: string): ShopTokens {
  const marca = corValida(primaryColor) ? primaryColor!.trim() : MARCA_PADRAO;
  return {
    marca,
    marcaEscura: marca === MARCA_PADRAO ? MARCA_ESCURA_PADRAO : escurecer(marca),
  };
}

/**
 * Publica os tokens no `<html>`.
 *
 * Vai no elemento raiz, e não num Provider do React, porque o CSS precisa
 * enxergar as variáveis — inclusive o `index.css`, que roda fora da árvore de
 * componentes.
 */
export function aplicarTokens(primaryColor?: string): void {
  if (typeof document === 'undefined') return;
  const { marca, marcaEscura } = tokensDaLoja(primaryColor);
  const raiz = document.documentElement;
  raiz.style.setProperty('--marca', marca);
  raiz.style.setProperty('--marca-escura', marcaEscura);
}
