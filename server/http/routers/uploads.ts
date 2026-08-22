import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { uploadsDirFor } from '../../paths';
import { LOJA_PADRAO } from '../../db';
import { migrateLegacyUploads } from '../../infra/uploads';
import { requireStaff } from '../middleware/auth';
import { shopIdOf } from '../middleware/tenant';

/**
 * Upload de imagem e áudio, em base64.
 *
 * Router: traduz, autentica e delega. Zero regra de negócio.
 */
export function uploadsRouter(): Router {
  const router = Router();

  // Roda uma vez, quando o router é montado — ou seja, no boot do servidor.
  migrateLegacyUploads();

  // ---------- Upload de imagem ou áudio (base64) ----------
  router.post('/upload', requireStaff('kitchen'), (req, res) => {
    // A loja sai de `shopIdOf(req)` — resolvida pelo `Host` lá em
    // `resolveTenant`, ANTES desta rota — nunca do corpo ou da URL da
    // requisição. Um `shopId` que o cliente informasse gravaria o arquivo na
    // pasta de qualquer loja que ele quisesse.
    const shopId = shopIdOf(req);
    const { dataUrl, filename } = req.body ?? {};
    if (typeof dataUrl !== 'string') {
      return res.status(400).json({ error: 'O arquivo não chegou. Selecione a imagem ou o áudio de novo.' });
    }
    const isImage = /^data:image\/(png|jpe?g|webp|gif);base64,/.test(dataUrl);
    const isAudio = /^data:audio\/(mpeg|mp3|wav|x-wav|ogg|webm);base64,/.test(dataUrl);
    if (!isImage && !isAudio) {
      return res.status(400).json({
        error: 'Formato inválido. Imagens: png/jpeg/webp/gif. Áudio: mp3/wav/ogg/webm.',
      });
    }

    const match = dataUrl.match(/^data:(image|audio)\/([\w.+-]+);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'O arquivo não pôde ser lido. Selecione a imagem ou o áudio de novo.' });

    const rawExt = match[2].toLowerCase().replace('x-', '').replace('mpeg', 'mp3');
    const allowedExt = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp3', 'wav', 'ogg', 'webm'];
    const ext = rawExt === 'jpeg' ? 'jpg' : allowedExt.includes(rawExt) ? rawExt : 'bin';
    if (ext === 'bin') return res.status(400).json({ error: 'Extensão não permitida.' });

    const buffer = Buffer.from(match[3], 'base64');
    const maxBytes = 15 * 1024 * 1024;
    if (buffer.length > maxBytes) {
      return res.status(400).json({ error: 'Arquivo muito grande (máx. 15 MB).' });
    }

    const safeName = (typeof filename === 'string' && filename.trim() ? filename.trim() : 'upload')
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .slice(0, 40);
    const name = `${Date.now()}-${safeName}.${ext}`;

    try {
      const dir = uploadsDirFor(shopId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), buffer);
      res.status(201).json({ url: `/api/uploads/${shopId}/${name}` });
    } catch {
      res.status(500).json({ error: 'Falha ao salvar o arquivo.' });
    }
  });

  return router;
}

/**
 * Compatibilidade com fotos gravadas antes da Fase 10, cuja URL não carrega
 * loja nenhuma (`/api/uploads/foto.png`) — só existia uma loja, e a pasta era
 * plana. Essas URLs continuam gravadas dentro do JSON dos produtos já
 * existentes; reescrevê-las ali seria migrar dado de produção às cegas.
 *
 * Em vez disso: qualquer pedido cujo primeiro segmento não seja puramente
 * numérico (ou seja, não aponta para a pasta de nenhuma loja) é tratado como
 * loja padrão — para onde `migrateLegacyUploads` já moveu o arquivo físico no
 * boot.
 */
export function legacyUploadFallback(req: Request, _res: Response, next: NextFunction): void {
  if (!/^\/\d+\//.test(req.url)) {
    req.url = `/${LOJA_PADRAO}${req.url}`;
  }
  next();
}

/**
 * Depois do fallback toda URL carrega uma loja no primeiro segmento — e ela
 * precisa ser A LOJA DA REQUISIÇÃO. Sem este guarda, o `express.static` serve
 * a pasta raiz inteira: o host da loja A entregaria a foto da loja B por
 * `/api/uploads/7/foto.jpg`.
 */
export function shopUploadsGuard(req: Request, res: Response, next: NextFunction): void {
  // A guarda tem que ver o MESMO caminho que o `express.static` vai servir.
  // Conferir a URL crua deixava passar `/1/..%2f2/foto.jpg`: crua começa com
  // `/1/` e a guarda aprovava, mas o static decodifica e normaliza para
  // `/2/foto.jpg` e servia a loja 2. Aqui decodifica e normaliza primeiro.
  // DECODIFICA ATÉ ESTABILIZAR: o `serve-static` decodifica o caminho MAIS UMA
  // vez por dentro, então um único `decodeURIComponent` aqui deixava passar o
  // duplo-encode (`%252e%252e` -> `%2e%2e` no guarda, `..` no static) e a loja
  // A servia o arquivo da B. Decodificar em laço até não sobrar nada esgota
  // todas as camadas antes da checagem — e o `req.url` já vai sem `%`, então a
  // decodificação interna do static vira no-op.
  let caminho = req.url.split('?')[0];
  try {
    let anterior: string;
    do {
      anterior = caminho;
      caminho = decodeURIComponent(caminho);
    } while (caminho !== anterior);
  } catch {
    res.status(400).json({ error: 'Endereço inválido.' });
    return;
  }
  const normal = path.posix.normalize(caminho);
  const dona = /^\/(\d+)\//.exec(normal);
  if (normal.includes('..') || normal.includes('%') || !dona || Number(dona[1]) !== shopIdOf(req)) {
    res.status(404).json({ error: 'Arquivo não encontrado.' });
    return;
  }
  // Serve exatamente o caminho já validado e totalmente decodificado.
  req.url = normal;
  next();
}
