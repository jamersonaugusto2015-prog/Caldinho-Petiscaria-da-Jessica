import fs from 'fs';
import path from 'path';
import { UPLOADS_DIR, uploadsDirFor } from '../paths';
import { LOJA_PADRAO } from '../db';

/**
 * Migração de boot: fotos e áudios gravados antes da Fase 10 ficaram soltos na
 * raiz de `uploads/`, porque só existia uma loja e a pasta era plana. Movidos
 * para `uploads/{LOJA_PADRAO}/` — são todos dela, a única loja que existia
 * antes do multi-tenant.
 *
 * Sem isto, com a loja B escrevendo no mesmo diretório físico, um nome de
 * arquivo repetido (o relógio do servidor gerando o mesmo timestamp em dois
 * uploads simultâneos) faria uma loja sobrescrever a foto da outra.
 *
 * Idempotente — nada solto na raiz depois da primeira migração vira um `readdir`
 * vazio nos boots seguintes — e nunca derruba o boot: um arquivo que falhe ao
 * mover fica onde estava, e só deixa de resolver pela URL antiga (compensado
 * por `legacyUploadFallback`, em `server/http/routers/uploads.ts`); travar o
 * processo inteiro por causa de uma foto seria pior.
 */
export function migrateLegacyUploads(): void {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const soltos = fs
    .readdirSync(UPLOADS_DIR, { withFileTypes: true })
    .filter((entrada) => entrada.isFile());
  if (soltos.length === 0) return;

  const destino = uploadsDirFor(LOJA_PADRAO);
  fs.mkdirSync(destino, { recursive: true });

  let movidos = 0;
  for (const entrada of soltos) {
    const origem = path.join(UPLOADS_DIR, entrada.name);
    const alvo = path.join(destino, entrada.name);
    try {
      if (fs.existsSync(alvo)) {
        console.warn(
          `[uploads] ${entrada.name} já existe em uploads/${LOJA_PADRAO}/ — mantendo o arquivo solto na raiz.`
        );
        continue;
      }
      fs.renameSync(origem, alvo);
      movidos++;
    } catch (err) {
      console.warn(`[uploads] não foi possível migrar ${entrada.name} para uploads/${LOJA_PADRAO}/:`, err);
    }
  }
  if (movidos > 0) {
    console.log(`[uploads] ${movidos} arquivo(s) migrado(s) da raiz para uploads/${LOJA_PADRAO}/ (loja padrão).`);
  }
}
