// Geração de BR Code (PIX "copia e cola") válido com CRC16-CCITT.
// Compartilhado entre servidor (criação de pedidos) e painel (pré-visualização).

import type { PixProvider } from '../order/types';
import { toCents, toReais } from '../pricing/money';

/** Bytes UTF-8 de um texto — o tamanho que o banco conta, não o do JavaScript. */
function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function emvField(id: string, value: string): string {
  // O tamanho é um prefixo fixo de 2 dígitos no formato EMV/BR Code: um valor
  // com 100+ BYTES produziria um prefixo de 3 dígitos e corromperia o parsing
  // de todos os campos seguintes do payload.
  //
  // BYTES UTF-8, não `value.length`: "é" conta 1 no JavaScript e 2 no banco.
  // Um prefixo contado em UTF-16 declara menos bytes do que seguem, e todo
  // app de banco recusa o código — com a tela da loja mostrando tudo certo.
  let v = value;
  while (utf8Length(v) > 99) v = v.slice(0, v.length - 1);
  const len = utf8Length(v).toString().padStart(2, '0');
  return `${id}${len}${v}`;
}

function crc16(payload: string): string {
  // O banco calcula o CRC sobre os BYTES UTF-8 que recebeu. `charCodeAt`
  // entregaria unidades UTF-16 ("é" = 0x00E9 em vez de C3 A9) e o checksum
  // divergiria em qualquer payload com caractere fora do ASCII.
  const bytes = new TextEncoder().encode(payload);
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function sanitize(value: string, max: number): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .toUpperCase()
    .slice(0, max);
}

export interface PixPayloadOptions {
  pixKey: string;
  amount: number;
  merchantName: string;
  merchantCity: string;
  txid?: string;
}

/**
 * O txid (campo 62-05) do BR Code aceita SÓ letras e números, no máximo 25,
 * segundo o manual do Bacen. O id de pedido daqui tem hífen ("CX-273OAMKP") e
 * o hífen é o bastante para o app do banco responder "QR Code inválido" — o
 * payload inteiro é recusado, mesmo com o CRC certo.
 */
function sanitizeTxid(raw?: string): string {
  const clean = (raw || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25);
  return clean || '***'; // marcador do Bacen para "sem identificador"
}

export function generatePixCopyPaste(opts: PixPayloadOptions): string {
  if (!Number.isFinite(opts.amount) || opts.amount <= 0) {
    throw new Error('Valor do PIX inválido.');
  }
  const key = normalizePixKey(opts.pixKey);
  const gui = emvField('00', 'br.gov.bcb.pix');
  const keyField = emvField('01', key);
  // 77 bytes é o teto real da chave: acima disso o campo 26 estoura os 99
  // bytes e o recorte geraria um payload que declara mais bytes do que tem —
  // e uma chave recortada é OUTRO endereço. Melhor falhar do que cobrar errado.
  if (utf8Length(gui + keyField) > 99) {
    throw new Error('Chave PIX longa demais para o BR Code (máx. 77 caracteres).');
  }
  const mai = emvField('26', gui + keyField);
  const txid = emvField('62', emvField('05', sanitizeTxid(opts.txid)));
  const payload =
    emvField('00', '01') +
    // Método de iniciação: '11' = QR estático, reutilizável. É opcional no
    // EMV, mas leitores de banco que o esperam recusam o código sem ele.
    emvField('01', '11') +
    mai +
    emvField('52', '0000') +
    emvField('53', '986') +
    // ATENÇÃO: aqui o ponto é obrigatório. O campo 54 do BR Code é definido
    // pelo Banco Central como decimal com ponto (`25.50`) — não é texto de tela
    // e NÃO passa pelo formatador pt-BR, que escreveria `R$ 25,50` e geraria um
    // código que nenhum banco lê.
    // E o número passa antes pela regra ÚNICA de centavos (money.ts):
    // `8.325.toFixed(2)` daria "8.32" enquanto o pedido gravou R$ 8,33.
    emvField('54', toReais(toCents(opts.amount)).toFixed(2)) +
    emvField('58', 'BR') +
    emvField('59', sanitize(opts.merchantName || 'LOJA', 25)) +
    emvField('60', sanitize(opts.merchantCity || 'BRASIL', 15)) +
    txid;
  // O CRC16 (Bacen/EMV) cobre o payload inteiro INCLUINDO a tag+tamanho "6304"
  // do próprio campo 63 — só os 4 dígitos do CRC ficam de fora. Calcular sobre
  // `payload` sozinho gera um CRC que passa na validação interna mas que os
  // apps de banco recusam como inválido, então o QR/copia-e-cola nunca funciona.
  const withCrcTag = payload + '6304';
  return withCrcTag + crc16(withCrcTag);
}

/** Dígitos verificadores do CPF. Só eles separam um CPF de um celular: os dois
 * têm 11 dígitos, e adivinhar errado põe a chave errada dentro do QR Code. */
function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (upTo: number): number => {
    let sum = 0;
    for (let i = 0; i < upTo; i++) sum += Number(digits[i]) * (upTo + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

/** Dígitos verificadores do CNPJ — a mesma cortesia que o CPF já recebia:
 * um dígito trocado é uma chave que não existe no DICT. */
function isValidCnpj(digits: string): boolean {
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  const dv = (len: number): number => {
    const pesos =
      len === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < len; i++) soma += Number(digits[i]) * pesos[i];
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return dv(12) === Number(digits[12]) && dv(13) === Number(digits[13]);
}

/** DDD de 11 a 99, o "9" do celular e mais 8 dígitos. */
function looksLikeMobile(digits: string): boolean {
  return /^[1-9][1-9]9\d{8}$/.test(digits);
}

/** Chave aleatória (EVP): um UUID, com ou sem os hífens que o banco mostra. */
function evpAsUuid(raw: string): string | null {
  const hex = raw.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  const low = hex.toLowerCase();
  // O DICT guarda a EVP como UUID minúsculo com hífens. Mandar os 32 dígitos
  // colados (ou em maiúsculas) é chave que não existe para o banco.
  return `${low.slice(0, 8)}-${low.slice(8, 12)}-${low.slice(12, 16)}-${low.slice(16, 20)}-${low.slice(20)}`;
}

export type PixKeyKind = 'email' | 'evp' | 'cpf' | 'cnpj' | 'phone' | 'desconhecido';

/** Como a chave digitada foi entendida — a cozinha vê isso escrito na tela. */
export function pixKeyKind(raw: string): PixKeyKind {
  const k = raw.trim();
  if (!k) return 'desconhecido';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k)) return 'email';
  if (evpAsUuid(k)) return 'evp';
  const digits = k.replace(/\D/g, '');
  if (digits.length === 14) return isValidCnpj(digits) ? 'cnpj' : 'desconhecido';
  if (digits.length === 11) return isValidCpf(digits) ? 'cpf' : looksLikeMobile(digits) ? 'phone' : 'desconhecido';
  if (digits.length === 10) return 'phone';
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return 'phone';
  return 'desconhecido';
}

/**
 * Normaliza a chave PIX para o formato exigido pelo BR Code:
 * - E-mail: usado como está
 * - Chave aleatória (EVP): vira UUID minúsculo com hífens
 * - CPF/CNPJ: só os dígitos
 * - Telefone: sempre com o DDI, no formato +5581999990000
 */
export function normalizePixKey(raw: string): string {
  const k = raw.trim();
  if (!k) return '';
  const kind = pixKeyKind(k);
  if (kind === 'email') return k;
  if (kind === 'evp') return evpAsUuid(k)!;
  const digits = k.replace(/\D/g, '');
  if (kind === 'cnpj' || kind === 'cpf') return digits;
  if (kind === 'phone') {
    // Telefone de chave PIX vai com DDI. Sem o "+55", o banco procura no DICT
    // um número que não existe e o pagamento morre no "chave não encontrada".
    return digits.startsWith('55') && digits.length > 11 ? `+${digits}` : `+55${digits}`;
  }
  return k; // não reconhecida: preservada como está, para não corromper a chave
}

/** Valida o formato da chave PIX. Retorna mensagem de erro ou null se OK. */
export function validatePixKey(raw: string): string | null {
  const k = raw.trim();
  if (!k) return null;
  // Caractere fora do ASCII visível é quase sempre acidente de copia-e-cola:
  // um espaço invisível vindo do app do banco, um acento num e-mail. O DICT
  // não registra chave assim — e aceitar aqui geraria um QR que nenhum banco
  // lê, com a tela da loja mostrando "chave cadastrada".
  if (/[^\x20-\x7E]/.test(k)) {
    return 'A chave tem acento ou caractere invisível (colada do app do banco?). Digite de novo, só letras, números e sinais comuns.';
  }
  if (pixKeyKind(k) === 'desconhecido') {
    return 'Formato de chave PIX incomum. Aceito: CPF (11 dígitos), CNPJ (14), celular com DDD (ex: 81999990000), e-mail ou chave aleatória (UUID).';
  }
  // O campo 26 do BR Code comporta 77 bytes de chave — recortar seria pagar
  // para OUTRO endereço, então acima disso a chave é recusada, não ajustada.
  if (normalizePixKey(k).length > 77) {
    return 'Chave PIX longa demais (máx. 77 caracteres).';
  }
  return null;
}

/**
 * Gera uma chave aleatória (EVP) no formato UUID v4.
 *
 * Ela tem a FORMA de uma chave real mas não está registrada em banco nenhum:
 * serve para ver a tela funcionando, nunca para receber dinheiro.
 */
export function generateRandomPixKey(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versão 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return evpAsUuid(hex)!;
}

/**
 * Lê a escolha do provedor de PIX vinda do banco ou do formulário. Qualquer
 * valor desconhecido (config antiga, campo em branco) volta para o Mercado
 * Pago, que é o comportamento que a loja já tinha antes desta opção existir.
 */
export function normalizePixProvider(value: unknown): PixProvider {
  return value === 'local' ? 'local' : 'mercadopago';
}

/** true quando a cobrança PIX sai da chave da loja, sem passar pelo Mercado Pago. */
export function usesLocalPix(provider: unknown): boolean {
  return normalizePixProvider(provider) === 'local';
}
