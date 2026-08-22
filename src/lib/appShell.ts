/**
 * O casco do app instalado.
 *
 * São três apps saindo de um `index.html` só. Um HTML estático consegue apontar
 * para um manifesto — não para três — então quem escolhe qual é este módulo, em
 * runtime, pela URL. Sem isto, o motoboy instala um atalho chamado "Caldinho
 * Express" que abre o cardápio do cliente.
 *
 * Também é o único lugar que registra o service worker e escuta os dois eventos
 * do ciclo de vida (instalação oferecida, casco novo esperando). A UI de cada
 * papel só assina os callbacks; nada aqui desenha nada.
 */

import { useCallback, useEffect, useState } from 'react';

export type AppRole = 'kitchen' | 'driver' | 'client';

interface RoleShell {
  manifest: string;
  appleTouchIcon: string;
  /** Cor da barra de status no modo standalone. Distingue os três na tela. */
  themeColor: string;
  /** Nome sob o ícone no iOS, que também ignora o `short_name` do manifesto. */
  title: string;
}

/**
 * O manifesto vem da API, não de um arquivo estático em `public/`.
 *
 * Um arquivo estático tem o nome e a cor de UMA loja escritos dentro. Toda loja
 * da plataforma instalaria um atalho chamado "Caldinho da Jessica" — e um PWA
 * instalado guarda esse nome no aparelho, então não é algo que um deploy
 * conserta depois. `GET /api/manifest-:role.webmanifest` gera o manifesto a
 * partir das configurações da loja do `Host`.
 *
 * O `title` aqui é só o texto provisório da aba enquanto as configurações não
 * chegam; `applyShopBranding` troca pelo nome de verdade.
 */
const SHELLS: Record<AppRole, RoleShell> = {
  client: {
    manifest: '/api/manifest-cliente.webmanifest',
    appleTouchIcon: '/icons/cliente-apple-touch-180.png',
    themeColor: '#B91C1C',
    title: 'Delivery',
  },
  kitchen: {
    manifest: '/api/manifest-cozinha.webmanifest',
    appleTouchIcon: '/icons/cozinha-apple-touch-180.png',
    themeColor: '#1C1917',
    title: 'Cozinha',
  },
  driver: {
    manifest: '/api/manifest-entregador.webmanifest',
    appleTouchIcon: '/icons/entregador-apple-touch-180.png',
    themeColor: '#7C3AED',
    title: 'Entregador',
  },
};

/**
 * Põe o nome da loja na aba e na tela de início do iOS.
 *
 * O iOS ignora o `short_name` do manifesto e usa o `<title>` da página para o
 * nome sob o ícone — então o título precisa estar certo ANTES de o usuário
 * escolher "Adicionar à Tela de Início". Chamado assim que as configurações
 * chegam do servidor.
 */
const COR_RRGGBB = /^#[0-9a-f]{6}$/i;

export function applyShopBranding(storeName: string, primaryColor?: string): void {
  if (typeof document === 'undefined') return;
  const nome = storeName.trim();
  if (!nome) return;

  const role = appRole();
  document.title = role === 'kitchen' ? `Cozinha · ${nome}` : role === 'driver' ? `Entrega · ${nome}` : nome;

  // A cor da marca segue a loja também na barra do navegador — mas só se for
  // `#RRGGBB` de verdade: um valor solto viraria uma theme-color quebrada.
  if (role === 'client' && primaryColor && COR_RRGGBB.test(primaryColor.trim())) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', primaryColor.trim());
  }
}

/**
 * O papel sai do caminho, não de nenhum estado do React: o manifesto precisa
 * estar no DOM antes do primeiro render, senão o navegador já decidiu que a
 * página não é instalável e não oferece de novo.
 */
export function appRole(): AppRole {
  const path = typeof location === 'undefined' ? '/' : location.pathname;
  if (path.startsWith('/cozinha')) return 'kitchen';
  if (path.startsWith('/entregador')) return 'driver';
  return 'client';
}

interface IosNavigator {
  standalone?: boolean;
}

/** Rodando como app instalado, sem a barra de endereço do navegador. */
export function isStandalone(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    // O Safari do iPhone ignora display-mode e expõe esta flag não-padrão.
    return (navigator as Navigator & IosNavigator).standalone === true;
  } catch {
    return false;
  }
}

/**
 * iPhone/iPad, incluindo o iPad que se apresenta como Mac desde o iPadOS 13.
 *
 * A detecção existe por um motivo concreto e único: no iOS o `PushManager` só
 * aparece dentro do app instalado (16.4+), e não existe `beforeinstallprompt`
 * para oferecer a instalação. Sem separar este caso, o cliente de iPhone fica
 * sem nenhum aviso e sem nenhuma explicação — para ele o app simplesmente não
 * notifica.
 */
export function isIos(): boolean {
  try {
    if (typeof navigator === 'undefined') return false;
    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// beforeinstallprompt
// ---------------------------------------------------------------------------

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type InstallListener = (prompt: () => Promise<void>) => void;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<InstallListener>();

function runPrompt(): Promise<void> {
  const event = deferredPrompt;
  if (!event) return Promise.resolve();
  // O evento é de uso único: guardá-lo depois de disparado só serviria para
  // oferecer um botão "instalar" que não faz nada na segunda vez.
  deferredPrompt = null;
  return event.prompt().catch(() => undefined);
}

/**
 * Avisa quando o navegador aceita instalar o app. O callback recebe a função
 * que abre o diálogo — chame-a de dentro de um clique do usuário, senão o
 * Chrome descarta o pedido.
 *
 * Assinar depois do evento já ter passado ainda funciona: o prompt fica
 * guardado, porque ele chega antes do React montar qualquer botão.
 *
 * @returns função para cancelar a assinatura.
 */
export function onInstallAvailable(cb: InstallListener): () => void {
  installListeners.add(cb);
  if (deferredPrompt) {
    try {
      cb(runPrompt);
    } catch {
      /* um listener quebrado não derruba os outros */
    }
  }
  return () => {
    installListeners.delete(cb);
  };
}

// ---------------------------------------------------------------------------
// Atualização
// ---------------------------------------------------------------------------

type UpdateListener = () => void;

let updateReady = false;
const updateListeners = new Set<UpdateListener>();

/**
 * Avisa que existe uma versão nova instalada esperando. Quem assina decide o
 * que fazer — normalmente oferecer "atualizar" em vez de recarregar sozinho:
 * recarregar a cozinha no meio de um pedido perde o que está na tela.
 *
 * @returns função para cancelar a assinatura.
 */
export function onUpdateReady(cb: UpdateListener): () => void {
  updateListeners.add(cb);
  if (updateReady) {
    try {
      cb();
    } catch {
      /* idem */
    }
  }
  return () => {
    updateListeners.delete(cb);
  };
}

function announceUpdate(): void {
  updateReady = true;
  updateListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      /* idem */
    }
  });
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

function upsertLink(rel: string, href: string, extra?: Record<string, string>): void {
  const existing = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  const link = existing ?? document.createElement('link');
  link.rel = rel;
  link.href = href;
  if (extra) Object.entries(extra).forEach(([key, value]) => link.setAttribute(key, value));
  if (!existing) document.head.appendChild(link);
}

function upsertMeta(name: string, content: string): void {
  const existing = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  const meta = existing ?? document.createElement('meta');
  meta.name = name;
  meta.content = content;
  if (!existing) document.head.appendChild(meta);
}

/**
 * No Safari instalado, o segundo toque numa tecla vira zoom da página inteira.
 * No navegador o pinch continua livre (acessibilidade). Só o casco iOS trava.
 */
function lockIosStandaloneZoom(): void {
  if (!isIos() || !isStandalone()) return;
  const viewport = document.head.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!viewport) return;
  viewport.content =
    'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
}

interface ViteEnv {
  readonly PROD?: boolean;
}

/**
 * O projeto não tem `vite-env.d.ts`, então `import.meta.env` não é tipado. O
 * cast é local e o texto emitido continua sendo `import.meta.env` — que é o
 * que o Vite troca por um literal no build.
 */
function isProduction(): boolean {
  return (import.meta as unknown as { env?: ViteEnv }).env?.PROD === true;
}

function registerServiceWorker(): void {
  // Em `vite dev` o SW briga com o HMR: ele serve o casco velho do cache e a
  // tela para de acompanhar as edições, sem nenhum erro para explicar.
  if (!isProduction()) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((registration) => {
      if (registration.waiting && navigator.serviceWorker.controller) announceUpdate();

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // `controller` presente = já havia um casco rodando, então este é
          // uma atualização e não a primeira instalação (que não avisa nada).
          if (installing.state === 'installed' && navigator.serviceWorker.controller) announceUpdate();
        });
      });
    })
    .catch(() => {
      // HTTPS ausente, cota cheia, aba anônima: nada disso pode impedir o app
      // de abrir. O PWA é um extra; o pedido é o produto.
    });
}

let installed = false;

/**
 * Monta o casco: manifesto do papel, ícone do iOS, cor da barra e o service
 * worker. Idempotente — chamar duas vezes não duplica nada.
 */
export function installAppShell(): void {
  if (installed) return;
  installed = true;

  try {
    const shell = SHELLS[appRole()];
    upsertLink('manifest', shell.manifest);
    // O iOS ignora os `icons` do manifesto para a tela de início; sem esta
    // linha ele recorta um screenshot da página e usa como ícone.
    upsertLink('apple-touch-icon', shell.appleTouchIcon, { sizes: '180x180' });
    upsertMeta('theme-color', shell.themeColor);
    upsertMeta('apple-mobile-web-app-title', shell.title);
    lockIosStandaloneZoom();
  } catch {
    /* DOM indisponível ou head bloqueado: segue sem manifesto */
  }

  try {
    window.addEventListener('beforeinstallprompt', (event) => {
      // Sem o preventDefault o Chrome mostra a própria barra de instalação no
      // meio do cardápio, na hora que ele quiser.
      event.preventDefault();
      deferredPrompt = event as BeforeInstallPromptEvent;
      installListeners.forEach((cb) => {
        try {
          cb(runPrompt);
        } catch {
          /* idem */
        }
      });
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
    });
  } catch {
    /* idem */
  }

  try {
    registerServiceWorker();
  } catch {
    /* idem */
  }
}

// ---------------------------------------------------------------------------
// Assinaturas prontas para a UI
// ---------------------------------------------------------------------------

/**
 * `'prompt'` = o navegador aceita instalar e há um diálogo para abrir.
 * `'ios'` = não há diálogo nenhum; o único caminho é ensinar o gesto.
 * `'none'` = já instalado, dispensado, ou navegador que não instala nada.
 */
export type InstallAffordanceKind = 'none' | 'prompt' | 'ios';

export interface InstallAffordance {
  kind: InstallAffordanceKind;
  /** Chame de DENTRO do clique: o Chrome descarta o prompt fora do gesto. */
  install: () => void;
  /** "Agora não", lembrado entre visitas. */
  dismiss: () => void;
}

function readDismissed(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) === 'off';
  } catch {
    return false;
  }
}

/**
 * O convite para instalar, já resolvido: qual forma cabe neste navegador e se a
 * pessoa já disse que não. Os dois cabeçalhos desenham skins diferentes sobre
 * exatamente esta decisão — duplicar a lógica em cada um deixaria um deles
 * aparecendo dentro do app já instalado.
 */
export function useInstallAffordance(storageKey: string): InstallAffordance {
  const [prompt, setPrompt] = useState<(() => Promise<void>) | null>(null);
  const [dismissed, setDismissed] = useState(() => readDismissed(storageKey));
  // Lido uma vez: dentro do app instalado nada disto deve aparecer, e o valor
  // não muda no meio da sessão.
  const [standalone] = useState(() => isStandalone());

  useEffect(() => {
    // `setPrompt(fn)` trataria a função como updater e chamaria o diálogo na
    // hora, fora do gesto — o Chrome descartaria e o botão nasceria morto.
    return onInstallAvailable((run) => setPrompt(() => run));
  }, []);

  const install = useCallback(() => {
    const run = prompt;
    if (!run) return;
    setPrompt(null);
    void run();
  }, [prompt]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(storageKey, 'off');
    } catch {
      /* aba anônima: some só nesta sessão */
    }
  }, [storageKey]);

  let kind: InstallAffordanceKind = 'none';
  if (!standalone && !dismissed) {
    if (prompt) kind = 'prompt';
    else if (isIos()) kind = 'ios';
  }

  return { kind, install, dismiss };
}

/**
 * Existe casco novo esperando. NUNCA recarregue sozinho a partir daqui: a
 * cozinha atualiza no meio de um pedido e perde a tela; quem decide é o usuário.
 */
export function useUpdateReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => onUpdateReady(() => setReady(true)), []);
  return ready;
}
