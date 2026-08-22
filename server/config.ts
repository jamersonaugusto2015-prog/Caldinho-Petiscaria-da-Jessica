import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

/**
 * Toda variável de ambiente do servidor, lida e conferida UMA vez, aqui.
 *
 * Antes disso o `process.env` era lido solto em 8 arquivos, cada um com o seu
 * jeito de tratar o vazio: uns com `|| ''`, outros com `!` (mentindo para o
 * TypeScript), outros com `?.trim()`. O resultado é que um erro de digitação
 * numa variável do painel do Render não aparecia no boot — aparecia semanas
 * depois, num pagamento que não fechou.
 *
 * Aqui o boot falha na hora, dizendo o nome da variável e o que estava errado.
 *
 * ⚠ Este módulo NÃO carrega o `.env`. Quem carrega é `server/index.ts`, na
 * primeira linha. O motivo é o `npm test`: com o `dotenv` aqui dentro, qualquer
 * teste que encostasse na configuração puxava o `.env` da máquina junto — e a
 * suíte passava a fazer chamada de verdade ao Mercado Pago com a credencial
 * real do dono. Teste lê ambiente vazio; só o servidor lê o arquivo.
 */

// ---------------------------------------------------------------------------
// Peças reutilizáveis
// ---------------------------------------------------------------------------

/**
 * Painéis de deploy adoram guardar valores com aspas em volta e espaços na
 * ponta. `MP_REDIRECT_URI="https://..."` com as aspas dentro do valor gerava um
 * `redirect_uri` que o Mercado Pago recusava sem explicar por quê.
 */
const cleaned = z
  .string()
  .transform((value) => value.trim().replace(/^["']|["']$/g, '').trim());

/** Variável opcional: ausente e string vazia dão no mesmo — `undefined`. */
const optionalText = cleaned.optional().transform((value) => (value ? value : undefined));

const booleanText = z
  .string()
  .optional()
  .transform((value) => {
    const normalized = value?.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    return undefined;
  });

const port = z
  .string()
  .optional()
  .transform((value) => (value ? Number(value) : 3001))
  .refine((value) => Number.isInteger(value) && value > 0 && value < 65536, {
    message: 'precisa ser um número de porta entre 1 e 65535',
  });

// ---------------------------------------------------------------------------
// O formato
// ---------------------------------------------------------------------------

const schema = z.object({
  NODE_ENV: z.string().optional().transform((v) => v?.trim() || 'development'),
  PORT: port,
  /** Vazio = libera todas as origens. Só faz sentido em desenvolvimento. */
  CORS_ORIGIN: optionalText,
  /** URL pública do app. Usada no retorno do OAuth, no webhook e no push. */
  APP_URL: optionalText,
  DATA_DIR: optionalText,
  /**
   * O domínio onde as lojas moram (`dominio.com.br`), para
   * `loja-x.dominio.com.br` resolver a loja `loja-x`.
   *
   * Vazio = heurística ("o primeiro rótulo de um host com 3+ partes"). Definir
   * é mais seguro: sem isto, um host apontado para cá de fora
   * (`dominio.com.br.malicioso.com`) também produziria um rótulo.
   */
  SHOP_BASE_DOMAIN: optionalText,
  // O slug da loja ORIGINAL (a loja 1). O domínio de produção resolve por este
  // slug: `caldinhodajessica.onrender.com` procura a loja de slug
  // `caldinhodajessica`. Sem casar, o cliente leva 404 e a loja some. Vazio =
  // `loja` (o provisório da migração 005), que NÃO bate com nenhum domínio real.
  DEFAULT_SHOP_SLUG: optionalText,

  // Mercado Pago
  MP_CLIENT_ID: optionalText,
  MP_CLIENT_SECRET: optionalText,
  MP_REDIRECT_URI: optionalText,
  MP_ACCESS_TOKEN: optionalText,
  MP_PUBLIC_KEY: optionalText,
  MP_WEBHOOK_SECRET: optionalText,
  /** true = só aceita token TEST-. Ausente = decide pelo formato do token. */
  MP_TEST: booleanText,

  // Push (VAPID)
  VAPID_PUBLIC_KEY: optionalText,
  VAPID_PRIVATE_KEY: optionalText,
  VAPID_SUBJECT: optionalText,

  // Backup
  BACKUP_SERVICE_ACCOUNT: optionalText,

  /**
   * Redefine o PIN da cozinha no próximo boot. Menos de 4 caracteres é recusado
   * aqui: antes, um valor curto era ignorado em silêncio e o dono ficava
   * tentando entrar com um PIN que nunca foi gravado.
   */
  KITCHEN_PIN_RESET: optionalText.refine((value) => value === undefined || value.length >= 4, {
    message: 'precisa ter pelo menos 4 caracteres',
  }),
});

export type ServerConfig = z.infer<typeof schema> & {
  /** Pasta do banco e dos uploads. Absoluta, já resolvida. */
  dataDir: string;
  uploadsDir: string;
  isProduction: boolean;
  /** O que o `cors` do socket.io e do express esperam: lista ou `true`. */
  corsOrigins: string[] | true;
};

function describe(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
    .join('\n');
}

function build(env: NodeJS.ProcessEnv, moduleDir: string): ServerConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Configuração inválida — o servidor não pode subir assim:\n${describe(parsed.error)}`
    );
  }
  const value = parsed.data;

  // O zod valida só as chaves que conhece — um erro de digitação numa variável
  // NOSSA (MP_ACESS_TOKEN) viraria "sem token", em silêncio, que é exatamente
  // o que este módulo promete impedir. Prefixo nosso + chave desconhecida =
  // o boot falha na hora, com o nome do erro.
  const conhecidas = new Set(Object.keys(schema.shape));
  const suspeitas = Object.keys(env).filter(
    (k) => /^(MP_|VAPID_|SHOP_|KITCHEN_|BACKUP_)/.test(k) && !conhecidas.has(k)
  );
  if (suspeitas.length > 0) {
    throw new Error(
      `Variável de ambiente desconhecida — erro de digitação? ${suspeitas.join(', ')}`
    );
  }

  const corsList = value.CORS_ORIGIN
    ? value.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : null;
  const dataDir = value.DATA_DIR
    ? path.resolve(value.DATA_DIR)
    : path.join(moduleDir, '..', 'data');

  return {
    ...value,
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    // `.toLowerCase()`: NODE_ENV=Production (deploy configurado à mão) não
    // pode ligar os atalhos de desenvolvimento em silêncio.
    isProduction: value.NODE_ENV.trim().toLowerCase() === 'production',
    // O `.filter(Boolean)` come a vírgula sobrando ("https://a.com,"), que
    // viraria uma origem vazia entregue ao cors.
    corsOrigins: corsList && corsList.length > 0 ? corsList : true,
  };
}

/** Exposto só para os testes: deixa montar uma configuração sem mexer no processo. */
export function buildConfig(env: NodeJS.ProcessEnv, moduleDir = '.'): ServerConfig {
  return build(env, moduleDir);
}

export const config: ServerConfig = build(
  process.env,
  path.dirname(fileURLToPath(import.meta.url))
);
