/**
 * O crachá mínimo que o service worker precisa para se reinscrever sozinho.
 *
 * O navegador troca a inscrição de push por conta própria (expiração, rotação
 * de chave) e avisa pelo evento `pushsubscriptionchange`. Quem responde a esse
 * evento é o service worker — e ele NÃO enxerga o `localStorage`, que é onde os
 * tokens de papel moram. Sem credencial, o POST de reinscrição caía no 401 e a
 * cozinha e o motoboy paravam de receber push em silêncio: nenhum erro na tela,
 * o alerta simplesmente nunca mais tocava.
 *
 * IndexedDB é o único armazenamento que a página e o service worker dividem.
 * Guardamos aqui o mínimo para o servidor decidir a sala: o papel, o token
 * daquele papel e — só no cliente — o id do cliente. Nada de dados de pedido.
 *
 * ⚠ Os nomes abaixo estão REPETIDOS em `public/sw.js` (que não passa pelo
 * bundler e por isso não pode importar deste arquivo). Mudou aqui, muda lá.
 */

export const PUSH_IDENTITY_DB = 'caldinho-push';
export const PUSH_IDENTITY_STORE = 'identity';
export const PUSH_IDENTITY_KEY = 'current';

export interface StoredPushIdentity {
  /** 'kitchen' | 'driver' | 'client' */
  role: string;
  /** Token do papel, o mesmo que vai no header `x-role-token`. Vazio no cliente. */
  roleToken?: string;
  /** Só o cliente: o servidor resolve a sala `customer:<id>` por ele. */
  customerId?: string;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const request = indexedDB.open(PUSH_IDENTITY_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PUSH_IDENTITY_STORE)) {
          db.createObjectStore(PUSH_IDENTITY_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      // Navegação privada em alguns navegadores nunca resolve nem rejeita.
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Grava o crachá. Nunca lança: push é o transporte extra, e uma falha de
 * armazenamento não pode derrubar a inscrição que já deu certo.
 */
export async function savePushIdentity(identity: StoredPushIdentity): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(PUSH_IDENTITY_STORE, 'readwrite');
      tx.objectStore(PUSH_IDENTITY_STORE).put(identity, PUSH_IDENTITY_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

/** Apaga o crachá — usado no logout, junto com o `dropPushSubscription`. */
export async function clearPushIdentity(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(PUSH_IDENTITY_STORE, 'readwrite');
      tx.objectStore(PUSH_IDENTITY_STORE).delete(PUSH_IDENTITY_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}
