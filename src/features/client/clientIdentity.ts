export function getOrCreateCustomerId(): string {
  try {
    const existing = localStorage.getItem('ce_customer_id');
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : 'cust-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('ce_customer_id', id);
    return id;
  } catch {
    return 'anon';
  }
}

/** Cadastro local do cliente: nome + telefone, indexado pelo número (só os
 *  dígitos, para "81 99999-0000" e "(81)99999-0000" baterem na mesma chave). */
export interface SavedCustomer {
  name: string;
  phone: string; // como o cliente digitou da última vez
  lastUsedAt: string; // ISO — base da ordem dos atalhos
}

const CUSTOMERS_KEY = 'ce_customers';
const LAST_PHONE_KEY = 'ce_last_customer_phone';

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

function loadCustomerBook(): Record<string, SavedCustomer> {
  try {
    const raw = localStorage.getItem(CUSTOMERS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, SavedCustomer>;
    }
    return {};
  } catch {
    return {};
  }
}

function persistCustomerBook(book: Record<string, SavedCustomer>): void {
  try {
    localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(book));
  } catch {
    // localStorage cheio/indisponível: segue sem cadastro, o pedido não depende disso.
  }
}

/** Grava (ou atualiza) o cadastro pelo telefone e marca como o último usado. */
export function saveCustomer(name: string, phone: string): void {
  const digits = normalizePhone(phone);
  if (!name.trim() || digits.length < 10) return;
  try {
    const book = loadCustomerBook();
    book[digits] = { name: name.trim(), phone: phone.trim(), lastUsedAt: new Date().toISOString() };
    persistCustomerBook(book);
    localStorage.setItem(LAST_PHONE_KEY, digits);
  } catch {
    // idem acima
  }
}

/** Cliente do último pedido — é quem pré-preenche o formulário. */
export function getLastCustomer(): SavedCustomer | null {
  try {
    const book = loadCustomerBook();
    const last = localStorage.getItem(LAST_PHONE_KEY);
    if (last && book[last]) return book[last];
    let best: SavedCustomer | null = null;
    for (const key in book) {
      if (!best || book[key].lastUsedAt > best.lastUsedAt) best = book[key];
    }
    return best;
  } catch {
    return null;
  }
}

/** Procura o cadastro pelo telefone digitado (ignora formatação). */
export function findCustomerByPhone(phone: string): SavedCustomer | null {
  try {
    return loadCustomerBook()[normalizePhone(phone)] ?? null;
  } catch {
    return null;
  }
}
