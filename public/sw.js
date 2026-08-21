/* eslint-disable no-restricted-globals */
/**
 * Service worker do Caldinho Express.
 *
 * Mora na raiz de propósito: um SW só enxerga o que está no seu escopo, e são
 * três apps (`/`, `/cozinha`, `/entregador`) saindo do mesmo bundle. Registrado
 * em `/cozinha/sw.js` ele nunca veria o cliente.
 *
 * Duas responsabilidades, e nada além disso:
 *   1. abrir o app sem sinal (casco em cache, dados sempre da rede);
 *   2. desenhar a notificação do push com o app fechado.
 *
 * Arquivo servido cru de `public/` — sem build, sem TypeScript, sem import.
 * Escreva JS que roda no navegador do celular do motoboy, não JS moderno.
 */

/**
 * Trocar esta versão invalida TODO o cache antigo no próximo deploy. É o único
 * botão que existe contra um casco velho grudado no aparelho da cozinha, que é
 * um tablet que ninguém desliga há meses.
 */
const CACHE_VERSION = 'v1';
const CACHE_PREFIX = 'caldinho-';
const SHELL_CACHE = CACHE_PREFIX + 'shell-' + CACHE_VERSION;
const ASSET_CACHE = CACHE_PREFIX + 'assets-' + CACHE_VERSION;
const UPLOAD_CACHE = CACHE_PREFIX + 'uploads-' + CACHE_VERSION;

/** O mínimo para a tela abrir offline. */
const SHELL_URLS = ['/', '/index.html'];

/** Fallback do ícone da notificação quando o alerta não diz de qual papel é. */
const NOTIFICATION_ICON = '/icons/cliente-icon-192.png';
const ROLE_ICON = {
  kitchen: '/icons/cozinha-icon-192.png',
  driver: '/icons/entregador-icon-192.png',
  client: '/icons/cliente-icon-192.png',
};

// ---------------------------------------------------------------------------
// Instalação
// ---------------------------------------------------------------------------

/**
 * Os nomes dos bundles têm hash e mudam a cada deploy, então não dá para listá-los
 * aqui. Lemos o `index.html` recém-baixado e pescamos os `/assets/...` que ele
 * mesmo aponta — a lista de precache nasce do build, não de uma cópia à mão que
 * envelhece em silêncio.
 */
async function discoverAssets() {
  try {
    const response = await fetch('/index.html', { cache: 'no-cache' });
    if (!response.ok) return [];
    const html = await response.text();
    const found = html.match(/\/assets\/[A-Za-z0-9._-]+\.(?:js|css)/g) || [];
    return Array.from(new Set(found));
  } catch (error) {
    // Sem rede na instalação: o SW ainda ativa, só entra sem casco em cache.
    return [];
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const shell = await caches.open(SHELL_CACHE);
        await shell.addAll(SHELL_URLS);
      } catch (error) {
        // Um 404 em qualquer URL derruba o addAll inteiro. Não impedir a
        // instalação por causa disso: um SW ativo sem cache ainda serve o push.
      }
      try {
        const assets = await discoverAssets();
        if (assets.length) {
          const cache = await caches.open(ASSET_CACHE);
          await Promise.all(assets.map((url) => cache.add(url).catch(() => undefined)));
        }
      } catch (error) {
        /* idem */
      }
      // Sem isto o casco novo fica esperando a última aba fechar — e a aba da
      // cozinha nunca fecha.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = [SHELL_CACHE, ASSET_CACHE, UPLOAD_CACHE];
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && keep.indexOf(name) === -1)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

// ---------------------------------------------------------------------------
// Rede
// ---------------------------------------------------------------------------

/** Rede primeiro; o casco em cache só entra quando o celular está sem sinal. */
async function networkFirstShell(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put('/index.html', response.clone()).catch(() => undefined);
    }
    return response;
  } catch (error) {
    const cached = (await caches.match('/index.html')) || (await caches.match('/'));
    if (cached) return cached;
    throw error;
  }
}

/** Bundle com hash no nome é imutável: se está em cache, é o arquivo certo. */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone()).catch(() => undefined);
  }
  return response;
}

/**
 * Foto de produto: mostra a versão guardada na hora e busca a nova por trás.
 * Uma foto um deploy atrasada não custa nada; esperar a rede no cardápio, sim.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        caches
          .open(cacheName)
          .then((cache) => cache.put(request, response.clone()))
          .catch(() => undefined);
      }
      return response;
    })
    .catch(() => undefined);
  return cached || network.then((response) => response || Promise.reject(new Error('offline')));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  /**
   * As fotos dos produtos moram em `/api/uploads/` (o Express monta o
   * `express.static` ali, ver server/index.ts). Precisam vir ANTES da regra do
   * `/api`, senão o cardápio inteiro recarrega as imagens a cada abertura.
   * São arquivos, não estado: o pior caso é uma foto de um deploy atrás.
   */
  if (url.pathname.indexOf('/api/uploads/') === 0) {
    event.respondWith(staleWhileRevalidate(request, UPLOAD_CACHE));
    return;
  }

  /**
   * O resto de `/api` e todo o `/socket.io` NUNCA passam por cache — nem para
   * ler, nem para escrever. Aqui trafega dinheiro e estado vivo: um pedido
   * servido de uma cópia velha é pior que um erro na tela, porque ninguém
   * percebe que é velho.
   */
  if (url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/socket.io/') === 0) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request));
    return;
  }

  if (url.pathname.indexOf('/assets/') === 0) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  if (url.pathname.indexOf('/icons/') === 0) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // Caminho legado, caso as fotos voltem a ser servidas fora do `/api`.
  if (url.pathname.indexOf('/uploads/') === 0) {
    event.respondWith(staleWhileRevalidate(request, UPLOAD_CACHE));
  }
});

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/**
 * O corpo do push é um `OrderAlert` de `src/shared/orderAlerts.ts` em JSON — a
 * MESMA estrutura que desenha a faixa dentro do app. É por isso que a
 * notificação com o app fechado diz exatamente o que o banner diria aberto.
 *
 * Tudo aqui é defensivo de propósito: se este handler lançar, o navegador
 * mostra por conta própria um aviso genérico de "site atualizado em segundo
 * plano" — e o motoboy recebe um alerta que não diz qual corrida é.
 */
/**
 * Chrome no Android vibra a notificação com UM array só. `setTimeout` no SW
 * não existe para isto: o padrão já vem repetido. Começa em pulso, nunca em 0.
 */
function expandPushVibrate(pattern, repeat) {
  if (!Array.isArray(pattern) || !pattern.length) return [220, 90, 220, 90, 400];
  var times = Math.max(1, Math.min(Number(repeat) || 1, 5));
  var clean = [];
  for (var i = 0; i < pattern.length; i++) {
    var ms = Math.round(Number(pattern[i]) || 0);
    if (ms < 0) ms = 0;
    if (ms > 1000) ms = 1000;
    if (i === 0 && ms === 0) continue;
    clean.push(ms);
  }
  if (!clean.length) return [220, 90, 400];
  if (times === 1) return clean.slice(0, 99);
  var out = clean.slice();
  for (var r = 1; r < times; r++) {
    if (out.length % 2 === 1) out.push(280);
    else out[out.length - 1] += 280;
    out = out.concat(clean);
  }
  return out.slice(0, 99);
}

function parseAlert(event) {
  if (!event.data) return null;
  try {
    const payload = event.data.json();
    if (!payload || typeof payload !== 'object') return null;
    if (typeof payload.title !== 'string' || !payload.title) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const alert = parseAlert(event);
      if (!alert) {
        // Push sem corpo legível ainda merece uma notificação: o navegador
        // exige que TODO push mostre alguma. Melhor a nossa, com a marca certa.
        await self.registration.showNotification('Caldinho da Jessica', {
          body: 'Você tem uma novidade no app.',
          tag: 'caldinho:geral',
          icon: NOTIFICATION_ICON,
          badge: NOTIFICATION_ICON,
          lang: 'pt-BR',
          data: { href: '/' },
        });
        return;
      }

      const demand = alert.urgency === 'demand';
      const channels = alert.channels && typeof alert.channels === 'object' ? alert.channels : {};
      const icon = ROLE_ICON[alert.role] || NOTIFICATION_ICON;
      const vibrate = expandPushVibrate(channels.vibrate, channels.repeat);

      try {
        await self.registration.showNotification(alert.title, {
          body: typeof alert.body === 'string' ? alert.body : '',
          tag: typeof alert.tag === 'string' && alert.tag ? alert.tag : 'caldinho:geral',
          data: { href: typeof alert.href === 'string' && alert.href ? alert.href : '/', orderId: alert.orderId },
          vibrate: demand ? vibrate : undefined,
          badge: icon,
          icon: icon,
          // `demand` é pedido novo na cozinha e corrida oferecida ao motoboy:
          // os dois eventos com dinheiro parado esperando alguém olhar. Só eles
          // podem re-tocar e ficar presos na tela até serem tocados.
          renotify: demand,
          requireInteraction: demand,
          lang: 'pt-BR',
        });
      } catch (error) {
        // `renotify` sem `tag`, `vibrate` recusado — nenhum motivo justifica
        // deixar o evento estourar e virar o aviso genérico do navegador.
        await self.registration.showNotification(alert.title, {
          body: typeof alert.body === 'string' ? alert.body : '',
          icon: NOTIFICATION_ICON,
          lang: 'pt-BR',
          data: { href: '/' },
        });
      }
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const href = typeof data.href === 'string' && data.href ? data.href : '/';

  event.waitUntil(
    (async () => {
      const target = new URL(href, self.location.origin);
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

      // Reaproveitar a aba já aberta importa: abrir uma segunda janela da
      // cozinha duplica o socket e o mesmo pedido passa a tocar em dobro.
      for (const client of clientList) {
        try {
          const url = new URL(client.url);
          if (url.pathname === target.pathname || url.pathname.indexOf(target.pathname) === 0) {
            await client.focus();
            if ('navigate' in client && url.href !== target.href) {
              await client.navigate(target.href).catch(() => undefined);
            }
            return;
          }
        } catch (error) {
          /* url estranha de uma aba qualquer: ignora e tenta a próxima */
        }
      }

      if (clientList.length && self.clients.openWindow === undefined) {
        await clientList[0].focus();
        return;
      }
      await self.clients.openWindow(target.href);
    })()
  );
});

/**
 * O navegador pode trocar a inscrição sozinho (expiração, rotação de chave).
 * Sem reenviar a nova para o servidor, o aparelho some da lista de push em
 * silêncio: ninguém recebe erro, os alertas simplesmente param de chegar.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const old = event.oldSubscription || (await self.registration.pushManager.getSubscription());
        const applicationServerKey = old && old.options ? old.options.applicationServerKey : undefined;
        if (!applicationServerKey) return;

        const fresh = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey,
        });

        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ subscription: fresh.toJSON() }),
        });
      } catch (error) {
        /* nada a fazer aqui: o app reinscreve na próxima abertura */
      }
    })()
  );
});

/** Permite que a página mande o casco novo assumir sem esperar um reload. */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
