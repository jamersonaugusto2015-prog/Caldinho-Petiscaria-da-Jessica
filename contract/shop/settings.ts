import { z } from 'zod';
import type { StoreSettings } from './types';

/**
 * O formato das configurações da loja, com as regras que as tornam válidas.
 *
 * Isto vive no contrato — e não no router — porque as MESMAS regras precisam
 * valer nos dois lados da conversa: o painel da cozinha manda um corpo, e o
 * banco devolve linhas de texto que também podem estar erradas (editadas na
 * mão, restauradas de um backup velho, gravadas por uma versão anterior).
 *
 * O que existia antes era `const b = req.body ?? {}` seguido de 40 linhas de
 * `if (typeof b.x === 'string')`. O tipo `StoreSettings` não protegia nada: o
 * corpo entrava como `any`. Um `deliveryBaseFee: -50` era aceito de bom grado e
 * a loja passava a PAGAR o cliente por entregar.
 *
 * As transformações (aparar espaço, cortar no tamanho, limpar o telefone) moram
 * aqui de propósito: normalizar é parte de decidir o que é válido, e deixar
 * isso no router significa cada rota normalizar do seu jeito.
 */

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

/**
 * Dinheiro de configuração: não-negativo, no máximo R$ 1 milhão (acima disso o
 * `number` já não guarda centavo com segurança — ver money.ts) e em centavos
 * inteiros. Sem o teto, `1e15` era aceito e voltava da regra de centavos com
 * R$ 9 a menos; sem a granularidade, `0.005` virava um preço de meio-centavo.
 */
const money = z
  .number()
  .finite()
  .min(0)
  .max(1_000_000, 'valor alto demais (máx. R$ 1.000.000)')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'use no máximo os centavos');

const text = (max: number) =>
  z
    .string()
    .transform((value) => value.trim().slice(0, max));

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const openingHourSchema = z.object({
  open: z.string().regex(TIME_RE, 'horário precisa estar no formato HH:MM'),
  close: z.string().regex(TIME_RE, 'horário precisa estar no formato HH:MM'),
});

export const sizeOptionSchema = z.object({
  label: text(60),
  // Limitado nos dois sentidos: `-999` deixava o item de graça e um valor
  // gigante estourava o preço. O piso de 0 no pedido protege o total, mas a
  // configuração não devia aceitar o absurdo em primeiro lugar.
  priceDelta: z
    .number()
    .finite()
    .min(-100_000)
    .max(100_000)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'use no máximo os centavos'),
});

export const PIX_PROVIDERS = ['mercadopago', 'local'] as const;

// ---------------------------------------------------------------------------
// O corpo de POST /settings
// ---------------------------------------------------------------------------

/**
 * Tudo opcional: o painel manda só o que mudou, e um campo ausente não pode
 * apagar o que está gravado.
 */
export const shopSettingsPatchSchema = z
  .object({
    // Nome não pode ficar vazio: '' apagava o nome da loja de todas as telas.
    storeName: text(80).refine((v) => v.length >= 1, 'o nome da loja não pode ficar vazio'),
    city: text(80),
    storeAddress: text(160),

    /** Fora da faixa real do planeta o pino do mapa some sem erro nenhum. */
    storeLat: z.number().finite().min(-90).max(90),
    storeLng: z.number().finite().min(-180).max(180),

    pickupEnabled: z.boolean(),
    /** Menos de 5 minutos não dá tempo de fazer nada; o valor é arredondado. */
    pickupReadyMinutes: z.number().finite().min(5).max(240).transform(Math.round),

    deliveryPricePerKm: money,
    deliveryBaseFee: money,
    deliveryMinFee: money,
    freeDeliveryAbove: money,
    /** 0 = sem limite de raio. */
    maxDeliveryKm: z.number().finite().min(0).max(200),
    minOrderValue: money,
    /**
     * Linha reta → rota real. Abaixo de 1 a conta diria que a rua é mais curta
     * que a reta entre os dois pontos, o que é geometricamente impossível.
     */
    routeFactor: z.number().finite().min(1).max(3),
    driverFeePerDelivery: money,

    pixProvider: z.enum(PIX_PROVIDERS),
    pixKey: text(140),
    pixMerchantName: text(25),
    pixMerchantCity: text(15),

    cardOnDeliveryEnabled: z.boolean(),
    /** Só os dígitos: o painel aceita "(81) 99999-0000" e o link do WhatsApp não. */
    storeWhatsApp: z.string().transform((v) => v.replace(/\D/g, '').slice(0, 15)),
    orderSoundUrl: text(2048),

    /** 7 posições, domingo=0. `null` = fechado naquele dia. */
    openingHours: z.array(openingHourSchema.nullable()).length(7),
    // Teto de 30: o blob vai inteiro em todo GET /settings anônimo e no
    // broadcast do socket; 50 mil tamanhos viravam megabytes por carregamento.
    sizeOptions: z.array(sizeOptionSchema).min(1).max(30),

    /** Selos para um brinde. 0 desligaria a fidelidade sem querer, então o mínimo é 1. */
    loyaltyStampCost: z.number().finite().min(1).max(100).transform(Math.round),
    /** Vazia = qualquer item do cardápio pode ser resgatado. */
    loyaltyRedeemCategory: text(60),
    /**
     * Fuso IANA. Conferido de verdade: um valor inválido faria `Intl` lançar no
     * meio do relatório, e o dono veria uma tela quebrada sem saber por quê.
     */
    timezone: z
      .string()
      .transform((v) => v.trim())
      .refine((v) => {
        if (!v) return true;
        try {
          new Intl.DateTimeFormat('pt-BR', { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, 'fuso desconhecido (use algo como America/Recife)'),

    orderEnabled: z.boolean(),
    forceOpen: z.boolean(),

    /**
     * A cor da marca, em `#RRGGBB`.
     *
     * Só este formato: qualquer outra coisa vira `color: azul-marinho` no CSS e
     * a tela perde a cor inteira, sem erro nenhum aparecer.
     */
    brandPrimaryColor: z
      .string()
      .transform((v) => v.trim())
      .refine((v) => v === '' || /^#[0-9a-fA-F]{6}$/.test(v), 'use uma cor no formato #RRGGBB'),

    /** Vazio = não mexer no PIN. Preenchido = trocar, e aí precisa ser um PIN. */
    kitchenPin: z
      .string()
      .transform((v) => v.trim())
      .refine((v) => v === '' || v.length >= 4, 'o PIN da cozinha precisa ter pelo menos 4 números'),

    /**
     * O segredo de assinatura do webhook do Mercado Pago DESTA loja (painel do
     * MP → Webhooks → "Assinatura secreta").
     *
     * Cada loja conecta a própria conta, e cada conta tem o seu segredo. Sem o
     * da loja, a assinatura do webhook dela nunca bate — e isso é dinheiro que
     * entrou com o pedido nunca marcado como pago.
     */
    mpWebhookSecret: z.string().transform((v) => v.trim().slice(0, 200)),

    backupEnabled: z.boolean(),
    backupFrequencyDays: z.number().finite().min(1).max(90).transform(Math.round),
    backupFolderId: text(200),
    backupServiceAccount: z.string().transform((v) => v.trim().slice(0, 8192)),
  })
  .partial()
  .strict();
// Sem regra cruzada entre taxa base e taxa mínima: `max(mínima, base + km*preço)`
// aceita QUALQUER par não-negativo. Uma mínima acima da base é o significado
// normal de "a entrega começa em R$ X"; uma mínima abaixo só nunca vincula. A
// regra antiga recusava o par inofensivo e deixava passar o outro — puro ruído.

export type ShopSettingsPatch = z.infer<typeof shopSettingsPatchSchema>;

/** O nome do campo como a cozinha o conhece na tela. */
const RÓTULO: Record<string, string> = {
  // Campos do painel super-admin (`contract/shop/platform.ts`), que divide este
  // tradutor de erros.
  slug: 'Endereço da loja',
  name: 'Nome da loja',
  password: 'Senha',
  email: 'E-mail',
  storeName: 'Nome da loja',
  city: 'Cidade',
  storeAddress: 'Endereço da loja',
  storeLat: 'Latitude da loja',
  storeLng: 'Longitude da loja',
  pickupEnabled: 'Retirada na loja',
  pickupReadyMinutes: 'Minutos até ficar pronto',
  deliveryPricePerKm: 'Preço por km',
  deliveryBaseFee: 'Taxa base de entrega',
  deliveryMinFee: 'Taxa mínima de entrega',
  freeDeliveryAbove: 'Frete grátis acima de',
  maxDeliveryKm: 'Raio máximo de entrega',
  minOrderValue: 'Pedido mínimo',
  routeFactor: 'Fator de rota',
  driverFeePerDelivery: 'Valor por entrega do motoboy',
  pixProvider: 'Quem cobra o PIX',
  pixKey: 'Chave PIX',
  pixMerchantName: 'Nome no PIX',
  pixMerchantCity: 'Cidade no PIX',
  cardOnDeliveryEnabled: 'Maquininha na entrega',
  storeWhatsApp: 'WhatsApp da loja',
  orderSoundUrl: 'Som do alerta',
  openingHours: 'Horário de funcionamento',
  sizeOptions: 'Tamanhos',
  orderEnabled: 'Aceitar pedidos',
  loyaltyStampCost: 'Selos para um brinde',
  loyaltyRedeemCategory: 'Categoria resgatável',
  timezone: 'Fuso horário',
  forceOpen: 'Abrir manualmente',
  brandPrimaryColor: 'Cor da marca',
  kitchenPin: 'PIN da cozinha',
  mpWebhookSecret: 'Segredo do webhook do Mercado Pago',
  backupEnabled: 'Backup automático',
  backupFrequencyDays: 'Frequência do backup',
  backupFolderId: 'Pasta do backup',
  backupServiceAccount: 'Chave do backup',
};

/**
 * Traduz o erro do zod para uma frase que a cozinha entende.
 *
 * O zod fala inglês ("Too small: expected number to be >=0") e usa o nome do
 * campo em código. Quem lê esta mensagem é a dona da loja, no celular, no meio
 * do expediente. `issues[0]` basta: o painel corrige um campo por vez.
 */
export function describeSettingsError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Configuração inválida.';

  const chave = String(issue.path[0] ?? '');
  const campo = RÓTULO[chave] ?? chave;

  if (issue.code === 'unrecognized_keys') {
    const nomes = issue.keys.map((k) => RÓTULO[k] ?? k).join(', ');
    return `Configuração desconhecida: ${nomes}.`;
  }
  if (issue.code === 'too_small') {
    const min = issue.minimum;
    if (issue.origin === 'number') return `${campo}: não pode ser menor que ${min}.`;
    return `${campo}: precisa ter pelo menos ${min}.`;
  }
  if (issue.code === 'too_big') {
    const max = issue.maximum;
    if (issue.origin === 'number') return `${campo}: não pode passar de ${max}.`;
    return `${campo}: passou do tamanho máximo (${max}).`;
  }
  if (issue.code === 'invalid_type') {
    return `${campo}: o valor enviado não serve aqui.`;
  }
  if (issue.code === 'invalid_value') {
    return `${campo}: valor não permitido.`;
  }

  // `custom`/`invalid_format`: a mensagem já foi escrita em português no schema.
  return campo && !issue.message.startsWith(campo) ? `${campo}: ${issue.message}` : issue.message;
}

// ---------------------------------------------------------------------------
// A leitura do banco
// ---------------------------------------------------------------------------

/**
 * O mesmo formato, do outro lado: o que sai da tabela `meta` também pode estar
 * errado. A tabela guarda TEXTO, e esse texto já foi editado na mão, restaurado
 * de um backup antigo e gravado por versões anteriores do app com outras
 * regras.
 *
 * A diferença para o schema de escrita é o `.catch()`: aqui um valor ruim NÃO
 * derruba nada — ele cai no padrão e a loja continua vendendo. Recusar a
 * configuração inteira porque um campo veio torto fecharia a loja por causa de
 * uma vírgula.
 */
/** Os campos de `StoreSettings` que são número. O TypeScript recusa um nome que não exista. */
type NumericSetting = {
  [K in keyof StoreSettings]: StoreSettings[K] extends number ? K : never;
}[keyof StoreSettings];

export function parseStoredSettings(
  raw: StoreSettings,
  defaults: StoreSettings
): StoreSettings {
  const seguro: StoreSettings = { ...raw };

  const numero = (campo: NumericSetting, min: number, max: number) => {
    const bruto = seguro[campo] as unknown;
    // `Number("")`, `Number(null)`, `Number([])` são todos 0 — uma célula
    // corrompida a vazio virava frete grátis em vez de cair no padrão. Só um
    // número, ou uma string numérica não-vazia, conta como valor gravado.
    const valor =
      typeof bruto === 'number'
        ? bruto
        : typeof bruto === 'string' && bruto.trim() !== ''
          ? Number(bruto)
          : NaN;
    if (!Number.isFinite(valor) || valor < min || valor > max) seguro[campo] = defaults[campo];
    else (seguro[campo] as number) = valor;
  };

  // Texto e booleano também vêm de `meta` (linha hand-edited, backup antigo):
  // um `storeName` que virou objeto chegava como "[object Object]" na tela, e
  // um `orderEnabled: "sim"` mantinha a loja aberta. A leitura tolera o lixo
  // caindo no padrão, como já fazia com os números.
  for (const campo of ['storeName', 'city', 'storeAddress', 'pixKey', 'pixMerchantName', 'pixMerchantCity', 'storeWhatsApp', 'orderSoundUrl', 'loyaltyRedeemCategory'] as const) {
    if (typeof seguro[campo] !== 'string') (seguro[campo] as string) = defaults[campo] as string;
  }
  for (const campo of ['pickupEnabled', 'cardOnDeliveryEnabled', 'orderEnabled', 'forceOpen'] as const) {
    if (typeof seguro[campo] !== 'boolean') (seguro[campo] as boolean) = defaults[campo] as boolean;
  }

  numero('storeLat', -90, 90);
  numero('storeLng', -180, 180);
  numero('deliveryPricePerKm', 0, Infinity);
  numero('deliveryBaseFee', 0, Infinity);
  numero('deliveryMinFee', 0, Infinity);
  numero('freeDeliveryAbove', 0, Infinity);
  numero('maxDeliveryKm', 0, 200);
  numero('minOrderValue', 0, Infinity);
  numero('routeFactor', 1, 3);
  numero('driverFeePerDelivery', 0, Infinity);
  numero('pickupReadyMinutes', 5, 240);
  numero('loyaltyStampCost', 1, 100);

  // Estes dois são JSON dentro de uma coluna de texto: é onde a corrupção mais
  // aparece, e é justamente o que alimenta o cálculo de preço.
  const horarios = seguro.openingHours;
  const horariosOk =
    Array.isArray(horarios) &&
    horarios.length === 7 &&
    horarios.every((dia) => dia === null || openingHourSchema.safeParse(dia).success);
  if (!horariosOk) seguro.openingHours = defaults.openingHours;

  const tamanhos = seguro.sizeOptions;
  const tamanhosOk =
    Array.isArray(tamanhos) &&
    tamanhos.length > 0 &&
    tamanhos.every((tamanho) => sizeOptionSchema.safeParse(tamanho).success);
  if (!tamanhosOk) seguro.sizeOptions = defaults.sizeOptions;

  if (!PIX_PROVIDERS.includes(seguro.pixProvider)) seguro.pixProvider = defaults.pixProvider;

  // O fuso é a única string que DERRUBA na leitura: um valor inválido gravado à
  // mão ou vindo de um backup antigo fazia `Intl` lançar no meio do relatório
  // (RangeError → 500). A escrita valida; a leitura precisa validar de novo,
  // porque é justamente o dado hand-edited que este passo existe para tolerar.
  if (seguro.timezone) {
    try {
      new Intl.DateTimeFormat('pt-BR', { timeZone: seguro.timezone });
    } catch {
      seguro.timezone = defaults.timezone;
    }
  }

  return seguro;
}
