import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Bell, Flame, Soup, X } from 'lucide-react';
import type { AlertUrgency, OrderAlert } from '../../contract/order/alerts';
import type { AlertChannel } from '../lib/alertChannel';

/**
 * A faixa de aviso dentro do app.
 *
 * O mesmo temporizador de 4000 ms estava escrito três vezes — na cozinha, no
 * cliente e no motoboy — e as três cópias já discordavam no visual e
 * concordavam no defeito: nenhuma delas era uma região viva, então quem usa
 * leitor de tela nunca soube que o pedido tinha andado.
 *
 * O visual continua sendo três: a cozinha é uma barra vermelha na coluna, o
 * cliente é uma faixa presa no topo da tela e o motoboy é roxa e animada. O que
 * virou um só é o tempo, a fila e o anúncio.
 */

export type AlertBannerVariant = 'kitchen' | 'client' | 'driver';

export interface AlertBannerState {
  message: string;
  urgency: AlertUrgency;
  /** Sobe a cada aviso: dois avisos iguais em sequência precisam reanimar e
   *  ser anunciados de novo, e o texto sozinho não distingue um do outro. */
  seq: number;
}

export type TriggerAlertBanner = (message: string, urgency?: AlertUrgency) => void;

/**
 * Quanto tempo a faixa fica.
 *
 * O `demand` é o aviso que alguém tem que resolver — cancelamento pedido,
 * corrida no balcão. Sumir em 4 s junto com os outros era transformar a única
 * mensagem urgente do app em algo que se perde ao virar a cabeça.
 */
const DWELL_MS: Record<AlertUrgency, number> = {
  silent: 4000,
  notice: 5500,
  demand: 12000,
};

/** O texto e o gatilho moram em contextos separados: toda loja precisa do
 *  gatilho, mas só a casca desenha a mensagem. */
const AlertBannerStateContext = createContext<AlertBannerState | null | undefined>(undefined);
const AlertBannerTriggerContext = createContext<TriggerAlertBanner | undefined>(undefined);

export const AlertBannerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AlertBannerState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const trigger = useCallback<TriggerAlertBanner>((message, urgency = 'silent') => {
    seqRef.current += 1;
    setState({ message, urgency, seq: seqRef.current });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState(null), DWELL_MS[urgency]);
  }, []);

  return (
    <AlertBannerTriggerContext.Provider value={trigger}>
      <AlertBannerStateContext.Provider value={state}>{children}</AlertBannerStateContext.Provider>
    </AlertBannerTriggerContext.Provider>
  );
};

export const useAlertBanner = (): TriggerAlertBanner => {
  const context = useContext(AlertBannerTriggerContext);
  if (!context) throw new Error('useAlertBanner deve ser usado dentro de AlertBannerProvider');
  return context;
};

export const useAlertBannerState = (): AlertBannerState | null => {
  const context = useContext(AlertBannerStateContext);
  if (context === undefined) throw new Error('useAlertBannerState deve ser usado dentro de AlertBannerProvider');
  return context;
};

/** O texto do alerta na faixa: título e corpo na mesma linha. */
export function bannerTextFor(alert: OrderAlert): string {
  const body = alert.body.trim();
  return body ? `${alert.title}: ${body}` : alert.title;
}

// ---------------------------------------------------------------------------
// A faixa
// ---------------------------------------------------------------------------

interface VariantSkin {
  /**
   * Envoltório: no cliente ele prende a faixa no topo da janela; na cozinha e
   * no motoboy ele some do fluxo quando está vazio (`empty:hidden`), senão a
   * região viva — que fica na página mesmo sem texto — abriria um buraco
   * permanente no topo da tela.
   *
   * O cliente não pode usar `empty:hidden`: a faixa é fixa e o `pt-safe` desce
   * ela para baixo do relógio do sistema. Em troca ela é `pointer-events-none`
   * — vazia, ela continua sendo um retângulo de 12 px (ou a altura do notch)
   * grudado no topo com z-80, e sem isso ele comia o toque na primeira faixa do
   * cabeçalho do cardápio. A faixa não tem botão nenhum, então nada se perde.
   */
  wrapper: string;
  bar: string;
  icon: React.ReactNode;
  animated: boolean;
}

const SKINS: Record<AlertBannerVariant, VariantSkin> = {
  kitchen: {
    wrapper: 'empty:hidden mb-6',
    bar: 'rounded-2xl bg-[#B91C1C] px-4 py-2.5 text-center text-xs font-bold text-white shadow-md',
    icon: null,
    animated: false,
  },
  client: {
    wrapper: 'pointer-events-none pt-safe fixed left-0 right-0 top-0 z-[80]',
    bar: 'flex items-center justify-center gap-2 bg-[#7F1D1D] px-4 py-2 text-center text-[11px] font-bold text-white shadow-lg',
    // Sem `animate-bounce`: um ícone de 14px quicando ao lado do texto é ruído,
    // não sinal. A faixa é fixa no topo e já entra deslizando — quem chama a
    // atenção é ela, não o ícone.
    icon: <Soup className="h-3.5 w-3.5 shrink-0 text-[#FDE68A]" />,
    animated: false,
  },
  driver: {
    wrapper: 'empty:hidden mb-3',
    bar: 'flex items-center justify-center gap-2 rounded-2xl bg-[#7C3AED] px-4 py-2.5 text-center text-xs font-bold text-white shadow-lg',
    icon: <Flame className="h-4 w-4 shrink-0 text-[#FDE68A]" />,
    animated: true,
  },
};

export const AlertBanner: React.FC<{ variant: AlertBannerVariant }> = ({ variant }) => {
  const state = useAlertBannerState();
  const reduceMotion = useReducedMotion();
  const skin = SKINS[variant];

  // A região existe sempre, mesmo vazia: leitor de tela só anuncia a mudança de
  // uma região que já estava na página antes do texto aparecer.
  return (
    <div
      className={skin.wrapper}
      role="status"
      aria-live={state?.urgency === 'demand' ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      {skin.animated ? (
        <AnimatePresence>
          {state && (
            <motion.div
              key={state.seq}
              initial={reduceMotion ? false : { opacity: 0, y: -12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className={skin.bar}
            >
              {skin.icon}
              <span>{state.message}</span>
            </motion.div>
          )}
        </AnimatePresence>
      ) : (
        state && (
          <div className={skin.bar}>
            {skin.icon}
            <span>{state.message}</span>
          </div>
        )
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Opt-in da notificação do sistema
// ---------------------------------------------------------------------------

interface AlertPermissionPromptProps {
  channel: AlertChannel;
  /** Onde a dispensa fica guardada, para não voltar a cada carregamento. */
  storageKey: string;
  label: string;
  tone: 'client' | 'driver';
}

const PROMPT_SKIN: Record<AlertPermissionPromptProps['tone'], { bar: string; action: string; close: string }> = {
  client: {
    bar: 'flex items-center gap-2 bg-[#991B1B] px-3 py-1.5 text-[11px] font-semibold text-white/90',
    action: 'rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white active:bg-white/25',
    close: 'rounded-lg p-1 text-white/60 active:bg-white/15',
  },
  driver: {
    bar: 'flex items-center gap-2 rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-[11px] font-semibold text-[#57534E]',
    action: 'rounded-lg bg-[#7C3AED] px-2.5 py-1 text-[11px] font-bold text-white active:bg-[#6D28D9]',
    close: 'rounded-lg p-1 text-[#A8A29E] active:bg-[#F5F5F4]',
  },
};

/**
 * O convite para ligar a notificação do sistema.
 *
 * A permissão não pode ser pedida no carregamento: o navegador recusa o pedido
 * que não nasce de um gesto, e o usuário que vê a caixa sozinha diz "bloquear"
 * — e aí não há segunda chance. Então o pedido sai daqui, de um botão, uma vez.
 */
export const AlertPermissionPrompt: React.FC<AlertPermissionPromptProps> = ({
  channel,
  storageKey,
  label,
  tone,
}) => {
  const [visible, setVisible] = useState(() => {
    if (channel.systemPermission() !== 'default') return false;
    try {
      return localStorage.getItem(storageKey) !== 'off';
    } catch {
      return true;
    }
  });

  const hide = useCallback(() => setVisible(false), []);

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      localStorage.setItem(storageKey, 'off');
    } catch {
      /* modo privado sem storage: some só nesta sessão */
    }
  }, [storageKey]);

  const enable = useCallback(() => {
    channel.requestSystemPermission().then(hide, hide);
  }, [channel, hide]);

  const skin = PROMPT_SKIN[tone];
  if (!visible) return null;

  return (
    <div className={skin.bar}>
      <Bell className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <button type="button" onClick={enable} className={skin.action}>
        Ativar
      </button>
      <button type="button" onClick={dismiss} aria-label="Agora não" className={skin.close}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
