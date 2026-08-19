/** Redimensiona uma imagem de arquivo para um data URL (JPEG), evitando uploads gigantes. */
export function resizeImage(file: File, maxDim = 1000, quality = 0.85): Promise<string> {
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
        try {
          if (!img.width || !img.height) {
            return settle(() => reject(new Error('Falha ao processar a imagem. Tente outro arquivo.')));
          }
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return settle(() => reject(new Error('Falha ao processar a imagem.')));
          // Fundo branco: sem isso, um PNG com transparência (ex.: logo recortada)
          // vira JPEG com fundo preto, porque o JPEG não tem canal alfa.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          if (!dataUrl || dataUrl.length < 100) {
            return settle(() => reject(new Error('Falha ao processar a imagem. Tente outro arquivo.')));
          }
          settle(() => resolve(dataUrl));
        } catch {
          settle(() => reject(new Error('Falha ao processar a imagem. Tente outro arquivo.')));
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
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
