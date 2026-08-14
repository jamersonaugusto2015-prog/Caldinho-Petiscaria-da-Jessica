import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Diretório de dados (banco SQLite + uploads). Configurável via DATA_DIR
// para discos persistentes em produção (ex: Render).
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
