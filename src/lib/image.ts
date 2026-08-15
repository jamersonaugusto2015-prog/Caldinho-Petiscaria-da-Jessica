/** Redimensiona uma imagem de arquivo para um data URL (JPEG), evitando uploads gigantes. */
export function resizeImage(file: File, maxDim = 1000, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () =>
        reject(
          new Error(
            'Não foi possível processar a imagem. Se for foto do iPhone (HEIC), converta para JPG/PNG antes.'
          )
        );
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('Falha ao processar a imagem.'));
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          if (!dataUrl || dataUrl.length < 100) {
            return reject(new Error('Falha ao processar a imagem. Tente outro arquivo.'));
          }
          resolve(dataUrl);
        } catch {
          reject(new Error('Falha ao processar a imagem. Tente outro arquivo.'));
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
