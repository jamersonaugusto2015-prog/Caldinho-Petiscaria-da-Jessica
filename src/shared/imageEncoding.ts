// Regras de compressão das imagens que a cozinha envia (logo e fotos de
// produto). Ficam aqui, sem tocar em canvas nem em DOM, para poderem ser
// testadas — src/lib/image.ts só aplica o que este módulo decide.

/**
 * Teto de peso de uma imagem depois de comprimida.
 *
 * O cardápio abre no 4G do cliente, com uma foto por produto: meio megabyte
 * por item vira uma tela branca de vários segundos. 180 kB é o ponto em que
 * uma foto de 1000 px ainda fica boa e a lista inteira carrega rápido.
 */
export const IMAGE_TARGET_BYTES = 180 * 1024;

/** Lado maior da imagem salva. Acima disso é peso que nenhuma tela mostra. */
export const IMAGE_MAX_DIMENSION = 1000;

/**
 * Qualidades tentadas em ordem, da melhor para a mais econômica. O WebP começa
 * mais baixo que o JPEG e ainda assim sai melhor: no mesmo número, ele guarda
 * mais detalhe e pesa cerca de um terço menos.
 */
const QUALITY_LADDERS: Record<string, number[]> = {
  'image/webp': [0.82, 0.72, 0.62, 0.5],
  'image/jpeg': [0.85, 0.75, 0.65, 0.55],
};

export function qualityLadder(mime: string): number[] {
  return QUALITY_LADDERS[mime] ?? QUALITY_LADDERS['image/jpeg'];
}

/** Peso real dos bytes dentro de um data URL base64. */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  if (!base64) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/** true quando o data URL é mesmo do formato pedido. */
export function isDataUrlOf(dataUrl: string, mime: string): boolean {
  return typeof dataUrl === 'string' && dataUrl.startsWith(`data:${mime};base64,`);
}

/**
 * Escolhe o resultado final entre as tentativas já codificadas.
 *
 * Devolve a primeira que couber no teto. Se nenhuma couber, devolve a menor —
 * recusar a imagem seria pior: o dono ficaria sem foto nenhuma no produto.
 */
export function pickBestAttempt(attempts: string[]): string {
  const valid = attempts.filter((attempt) => attempt && attempt.length > 100);
  if (!valid.length) throw new Error('Falha ao processar a imagem. Tente outro arquivo.');
  const fitting = valid.find((attempt) => dataUrlBytes(attempt) <= IMAGE_TARGET_BYTES);
  if (fitting) return fitting;
  return valid.reduce((best, attempt) => (dataUrlBytes(attempt) < dataUrlBytes(best) ? attempt : best));
}

/** Lado da imagem depois de caber em IMAGE_MAX_DIMENSION, mantendo a proporção. */
export function scaledSize(
  width: number,
  height: number,
  maxDim = IMAGE_MAX_DIMENSION
): { width: number; height: number } {
  const scale = Math.min(1, maxDim / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
