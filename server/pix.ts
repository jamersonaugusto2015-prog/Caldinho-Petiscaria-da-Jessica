// PIX do lado do servidor: BR Code vem do módulo compartilhado, a imagem do QR
// Code é desenhada aqui porque a biblioteca `qrcode` só roda no Node.
import QRCode from 'qrcode';

export { generatePixCopyPaste } from '../src/shared/pix';
export type { PixPayloadOptions } from '../src/shared/pix';

/**
 * Desenha o QR Code do BR Code e devolve só o base64 do PNG, sem o prefixo
 * `data:image/png;base64,` — é assim que o Mercado Pago entrega o dele, e as
 * duas telas do cliente montam a tag <img> esperando esse mesmo formato.
 *
 * A correção de erro fica em 'M': o padrão do Bacen para PIX, e o suficiente
 * para um código lido de uma tela suja ou de um papel amassado.
 */
export async function generatePixQrCodeBase64(copyPaste: string): Promise<string | undefined> {
  const payload = copyPaste.trim();
  if (!payload) return undefined;
  try {
    const png = await QRCode.toBuffer(payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 512,
      type: 'png',
    });
    return png.toString('base64');
  } catch (err) {
    // Sem imagem o cliente ainda paga pelo copia e cola: falhar o pedido
    // inteiro por causa do desenho do QR seria pior que entregar sem ele.
    console.error('Falha ao desenhar o QR Code do PIX:', err);
    return undefined;
  }
}
