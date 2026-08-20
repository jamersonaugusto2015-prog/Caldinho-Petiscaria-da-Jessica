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

/** Desenha um pedaço da imagem num JPEG (data URL), limitando o lado maior a maxDim. */
export function cropImageToDataUrl(
  img: HTMLImageElement,
  crop: CropRect,
  maxDim = 1000,
  quality = 0.85
): string {
  const scale = Math.min(1, maxDim / Math.max(crop.sw, crop.sh));
  const w = Math.max(1, Math.round(crop.sw * scale));
  const h = Math.max(1, Math.round(crop.sh * scale));
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
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  if (!dataUrl || dataUrl.length < 100) {
    throw new Error('Falha ao processar a imagem. Tente outro arquivo.');
  }
  return dataUrl;
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
