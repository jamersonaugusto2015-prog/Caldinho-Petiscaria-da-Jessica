import path from 'path';
import { config } from './config';
import type { ShopId } from '../contract/shop/types';

/**
 * Onde ficam o banco SQLite e os uploads.
 *
 * Os caminhos vêm de `config.ts`, que já resolveu o `DATA_DIR` para absoluto e
 * já validou o resto do ambiente. Este arquivo continua existindo porque meio
 * servidor importa `DATA_DIR`/`UPLOADS_DIR` por aqui.
 */
export const DATA_DIR: string = config.dataDir;
export const UPLOADS_DIR: string = path.resolve(config.uploadsDir);

/**
 * Pasta de uploads de UMA loja. Cada loja grava e serve só dentro da própria —
 * sem isto, um nome de arquivo repetido (dois donos subindo "logo.png" no
 * mesmo minuto) faz uma loja sobrescrever a foto da outra.
 */
export function uploadsDirFor(shopId: ShopId): string {
  return path.join(UPLOADS_DIR, String(shopId));
}
