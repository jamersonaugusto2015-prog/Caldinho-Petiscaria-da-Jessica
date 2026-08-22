/**
 * Dinheiro. Um só lugar, uma só regra.
 *
 * O sistema tinha TRÊS idiomas de arredondamento no servidor
 * (`Math.round(x*100)/100` no cálculo de preço, o mesmo repetido nas promoções,
 * e `Number(x.toFixed(2))` no Mercado Pago) e SEIS cópias de `const money =` no
 * front, mais 61 `toFixed(2)` soltos. Três idiomas dão três resultados
 * diferentes para o mesmo centavo, e quem paga a diferença é a loja.
 *
 * A regra daqui em diante:
 *
 * - **Guardar e somar em centavos inteiros.** `0.1 + 0.2 !== 0.3` em ponto
 *   flutuante; `10 + 20 === 30` em inteiro, sempre. Um pedido é uma pilha de
 *   somas — é exatamente onde o centavo some.
 * - **Converter para reais só na borda**: na tela e na hora de falar com o
 *   Mercado Pago, que espera reais.
 * - **Um formatador só**, em pt-BR, para a vírgula não virar ponto em nenhuma
 *   tela.
 *
 * Os tipos `Reais` e `Centavos` são só apelidos de `number` — o TypeScript não
 * separa os dois. Quem lê a assinatura é você; o nome está aí para isso.
 */

/** Valor em reais, como o usuário digita e como o Mercado Pago recebe. */
export type Reais = number;

/** Valor em centavos inteiros. É assim que o dinheiro é guardado e somado. */
export type Centavos = number;

/**
 * Reais → centavos. O ÚNICO arredondamento do sistema.
 *
 * Duas armadilhas do JavaScript moram aqui:
 *
 * 1. **A multiplicação erra.** `1.005 * 100` não dá `100.5`, dá
 *    `100.49999999999999` — e `Math.round` disso devolve `100`, um centavo a
 *    menos. O `toPrecision(14)` corta o lixo binário que sobra depois do 14º
 *    dígito significativo e devolve o `100.5` que a conta realmente queria
 *    dizer. (Vale até ~R$ 1 bilhão; acima disso a precisão de `number` já não
 *    serve para dinheiro de jeito nenhum.)
 *
 * 2. **`Math.round` não é simétrico.** `Math.round(-100.5)` dá `-100`, não
 *    `-101`: ele sempre sobe em direção ao `+Infinity`. Num estorno isso
 *    devolveria um centavo a menos ao cliente. Arredondar o valor absoluto e
 *    recolocar o sinal é a regra comercial — meio centavo sempre se afasta do
 *    zero, para os dois lados.
 */
export function toCents(value: Reais): Centavos {
  if (!Number.isFinite(value)) return 0;
  const scaled = Number((value * 100).toPrecision(14));
  const cents = Math.sign(scaled) * Math.round(Math.abs(scaled));
  // Fora da faixa segura de inteiros não existe centavo confiável; e o `-0`
  // que `Math.sign` produz escaparia para a tela como "-R$ 0,00".
  if (!Number.isSafeInteger(cents)) return 0;
  return cents === 0 ? 0 : cents;
}

/** Centavos → reais. Use só na borda: tela, ou corpo de requisição de terceiro. */
export function toReais(cents: Centavos): Reais {
  return Math.round(cents) / 100;
}

/**
 * Arredonda um valor em reais para o centavo mais próximo.
 *
 * É a ponte para o código que ainda trabalha em reais. Passa pelos centavos de
 * propósito: assim o resultado é o MESMO que o do resto do sistema, em vez de
 * ser um quarto idioma de arredondamento.
 */
export function roundMoney(value: Reais): Reais {
  return toReais(toCents(value));
}

/**
 * Aplica uma porcentagem sobre um valor em centavos.
 *
 * Existe separado porque desconto percentual é onde o centavo mais foge:
 * calcular em reais e arredondar no fim dá resultado diferente de calcular em
 * centavos e arredondar uma vez.
 */
export function percentOf(cents: Centavos, percent: number): Centavos {
  if (!Number.isFinite(percent) || !Number.isFinite(cents)) return 0;
  const exact = (cents * percent) / 100;
  return Math.sign(exact) * Math.round(Math.abs(exact));
}

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * O jeito de escrever dinheiro na tela. Em pt-BR: `R$ 25,50`.
 *
 * As seis cópias que isto substitui faziam `R$ ${v.toFixed(2)}` — que escreve
 * `R$ 25.50`, com PONTO. Ninguém no Brasil escreve preço assim.
 */
export function formatMoney(value: Reais): string {
  return BRL.format(Number.isFinite(value) ? value : 0);
}

/** O mesmo formatador, para quem já está com o valor em centavos. */
export function formatCents(cents: Centavos): string {
  return formatMoney(toReais(cents));
}

/**
 * Valor em reais com duas casas e ponto decimal, do jeito que uma API de
 * pagamento espera receber. NÃO use em tela.
 */
export function toApiAmount(value: Reais): number {
  return toReais(toCents(value));
}
