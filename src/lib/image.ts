import {
  IMAGE_MAX_DIMENSION,
  IMAGE_TARGET_BYTES,
  dataUrlBytes,
  isDataUrlOf,
  pickBestAttempt,
  qualityLadder,
  scaledSize,
} from '../shared/imageEncoding';

/** Carrega o arquivo como <img> já decodificado, com timeout e mensagens de erro amigáveis. */
export function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    let settled = false;
    // Em celular fraco o decode de um arquivo corrompido às vezes não dispara
    // onload nem onerror: sem isso o upload fica girando pra sempre, sem aviso.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Tempo esgotado ao processar a imagem. Tente outro arquivo.'));
    }, 15000);
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const reader = new FileReader();
    reader.onerror = () => settle(() => reject(new Error('Não foi possível ler a imagem.')));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () =>
        settle(() =>
          reject(
            new Error(
              'Não foi possível processar a imagem. Se for foto do iPhone (HEIC), converta para JPG/PNG antes.'
            )
          )
        );
      img.onload = () => {
        if (!img.width || !img.height) {
          return settle(() => reject(new Error('Falha ao processar a imagem. Tente outro arquivo.')));
        }
        settle(() => resolve(img));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

type CropRect = { sx: number; sy: number; sw: number; sh: number };

/**
 * O navegador sabe gravar WebP? Todos os atuais sabem, mas Safari antigo não,
 * e um `toDataURL('image/webp')` num navegador sem suporte devolve PNG
 * silenciosamente — um PNG de foto pesa vários megabytes. Por isso a checagem
 * olha o que voltou, e não a versão do navegador.
 */
let webpSupport: boolean | null = null;
function canEncodeWebp(): boolean {
  if (webpSupport !== null) return webpSupport;
  try {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    webpSupport = isDataUrlOf(probe.toDataURL('image/webp'), 'image/webp');
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

/**
 * Comprime o canvas até caber no teto de peso.
 *
 * Vai descendo a qualidade um degrau por vez e para na primeira que couber.
 * Uma foto limpa sai no degrau melhor; uma foto cheia de textura desce mais,
 * que é exatamente onde o peso estoura.
 */
function encodeCanvas(canvas: HTMLCanvasElement): string {
  const mime = canEncodeWebp() ? 'image/webp' : 'image/jpeg';
  const attempts: string[] = [];
  for (const quality of qualityLadder(mime)) {
    const dataUrl = canvas.toDataURL(mime, quality);
    // Um navegador que ignora o formato devolve PNG: aí não adianta insistir
    // na escada de qualidade, o PNG não tem qualidade com perda.
    if (!isDataUrlOf(dataUrl, mime)) {
      attempts.push(dataUrl);
      break;
    }
    attempts.push(dataUrl);
    if (dataUrlBytes(dataUrl) <= IMAGE_TARGET_BYTES) break;
  }
  return pickBestAttempt(attempts);
}

/**
 * Desenha um pedaço da imagem já comprimido, com o lado maior limitado.
 * Sai em WebP onde dá, e em JPEG no navegador que não grava WebP.
 */
export function cropImageToDataUrl(
  img: HTMLImageElement,
  crop: CropRect,
  maxDim = IMAGE_MAX_DIMENSION
): string {
  const { width: w, height: h } = scaledSize(crop.sw, crop.sh, maxDim);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Falha ao processar a imagem.');
  // Fundo branco: sem isso, um PNG com transparência (ex.: logo recortada)
  // vira JPEG com fundo preto, porque o JPEG não tem canal alfa.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
  return encodeCanvas(canvas);
}


export const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif';
const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Valida o arquivo antes do upload. Retorna mensagem de erro ou null se OK. */
export function validateImageFile(file: File): string | null {
  if (!file) return 'Nenhum arquivo selecionado.';
  if (!ALLOWED_MIMES.includes(file.type)) {
    return 'Formato não suportado. Use PNG, JPG, WEBP ou GIF (fotos do iPhone em HEIC precisam ser convertidas).';
  }
  if (file.size > 15 * 1024 * 1024) {
    return 'Imagem muito grande (máx. 15 MB).';
  }
  return null;
}
