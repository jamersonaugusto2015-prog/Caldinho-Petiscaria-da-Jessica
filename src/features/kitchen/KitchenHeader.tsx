import React from 'react';
import { Bell, BellOff, Download, Menu, RefreshCw, Share, X } from 'lucide-react';
import { useInstallAffordance, useUpdateReady } from '../../lib/appShell';
import { useKitchenSettings } from './KitchenSettingsStore';
import { useKitchenSound } from './KitchenSoundStore';
import { useKitchenShell } from './KitchenShellStore';
import { kitchenTabMeta, useKitchenNavCounts } from './useKitchenNavCounts';
import { kitchenTabLabel, type KitchenTab } from './kitchenTabs';

type StoreState = 'open' | 'afterHours' | 'closed';

const STORE_COPY: Record<StoreState, { full: string; short: string; action: string }> = {
  open: { full: 'Loja aberta', short: 'Aberta', action: 'Fechar a loja' },
  afterHours: { full: 'Aberta fora do horário', short: 'Fora do horário', action: 'Fechar a loja' },
  closed: { full: 'Loja fechada', short: 'Fechada', action: 'Abrir a loja' },
};

const STORE_SKIN: Record<StoreState, { pill: string; dot: string }> = {
  open: {
    pill: 'border-[#A7F3D0] bg-[#ECFDF5] text-[#047857] hover:bg-[#D1FAE5]',
    dot: 'bg-[#059669]',
  },
  afterHours: {
    pill: 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309] hover:bg-[#FEF3C7]',
    dot: 'bg-[#D97706]',
  },
  closed: {
    pill: 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C] hover:bg-[#FEE2E2]',
    dot: 'bg-[#B91C1C]',
  },
};

/** Faixa fina do casco: mesma moldura das duas mensagens, tom diferente. */
const SHELL_STRIP =
  'flex items-center gap-2 border-b border-[#E7E5E4] px-3 py-1.5 text-[11px] font-bold sm:px-6 lg:px-8';

export const KitchenHeader: React.FC<{ activeTab: KitchenTab }> = ({ activeTab }) => {
  const { settings, saveSettings } = useKitchenSettings();
  const { soundEnabled, toggleSound, previewSound, requestSystemPermission } = useKitchenSound();
  const { openNav } = useKitchenShell();
  const counts = useKitchenNavCounts();
  const install = useInstallAffordance('ce_install_hint_kitchen');
  const updateReady = useUpdateReady();

  const state: StoreState = !settings.orderEnabled ? 'closed' : settings.isOpen ? 'open' : 'afterHours';
  const copy = STORE_COPY[state];
  const skin = STORE_SKIN[state];
  const meta = kitchenTabMeta(activeTab, counts[activeTab] ?? 0);

  const handleToggleSound = () => {
    const turningOn = !soundEnabled;
    toggleSound();
    if (!turningOn) return;
    previewSound(); // teste do áudio/voz configurado
    // O gesto que liga o som é o único gesto explícito que a cozinha tem: é
    // aqui que a permissão de notificação pode ser pedida sem o navegador
    // recusar por não haver interação — e sem cair na cara de quem só abriu a tela.
    void requestSystemPermission();
  };

  const toggleStore = () => {
    const opening = !settings.orderEnabled;
    // Ao abrir, força a abertura (prioridade sobre o horário); ao fechar, volta ao normal
    saveSettings({ orderEnabled: opening, forceOpen: opening });
  };

  return (
    // `pt-safe`: no app instalado a página desenha sob a barra de status, e o
    // título do painel ficava atrás do relógio do sistema.
    <header className="pt-safe sticky top-0 z-20 border-b border-[#E7E5E4] bg-white/90 backdrop-blur-xl">
      {/* Nunca recarrega sozinho: a cozinha atualiza no meio de um pedido e
          perderia o que está na tela. Quem decide a hora é quem está lá. */}
      {updateReady && (
        <div className={`${SHELL_STRIP} bg-[#FFFBEB] text-[#B45309]`}>
          <RefreshCw className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Versão nova do painel pronta.</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="shrink-0 rounded-lg bg-[#B45309] px-2.5 py-1 text-[11px] font-bold text-white transition-colors duration-200 hover:bg-[#92400E]"
          >
            Atualizar
          </button>
        </div>
      )}

      {install.kind !== 'none' && (
        <div className={`${SHELL_STRIP} bg-[#FAFAF9] text-[#57534E]`}>
          {install.kind === 'prompt' ? (
            <>
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                Instale o painel para receber pedidos com a aba fechada.
              </span>
              <button
                type="button"
                // De dentro do clique, obrigatoriamente: o Chrome descarta o
                // diálogo de instalação pedido fora de um gesto do usuário.
                onClick={install.install}
                className="shrink-0 rounded-lg bg-[#1C1917] px-2.5 py-1 text-[11px] font-bold text-white transition-colors duration-200 hover:bg-[#292524]"
              >
                Instalar app
              </button>
            </>
          ) : (
            <>
              <Share className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                Para receber avisos: toque em Compartilhar → Adicionar à Tela de Início.
              </span>
            </>
          )}
          <button
            type="button"
            onClick={install.dismiss}
            aria-label="Agora não"
            title="Agora não"
            className="shrink-0 rounded-lg p-1 text-[#A8A29E] transition-colors duration-200 hover:bg-[#F5F5F4] hover:text-[#57534E]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex h-[68px] items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={openNav}
          title="Abrir menu"
          aria-label="Abrir menu"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E7E5E4] bg-white text-[#57534E] outline-none transition-colors duration-200 hover:bg-[#F5F5F4] hover:text-[#1C1917] focus-visible:ring-2 focus-visible:ring-[#B91C1C]/40 lg:hidden"
        >
          <Menu className="h-[18px] w-[18px]" />
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-extrabold leading-tight tracking-tight text-[#1C1917]">
            {kitchenTabLabel(activeTab)}
          </h1>
          <p
            className={`k-header-meta truncate text-[11px] font-bold text-[#78716C] ${
              meta ? 'opacity-100' : 'h-0 opacity-0'
            }`}
          >
            {meta}
          </p>
        </div>

        <button
          type="button"
          onClick={toggleStore}
          aria-pressed={settings.orderEnabled}
          title={settings.orderEnabled ? 'Clique para fechar a loja' : 'Clique para abrir a loja'}
          className={`group flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-xs font-bold outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-[#B91C1C]/40 active:scale-[0.98] ${skin.pill}`}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            {state === 'open' && (
              <span className="absolute inset-0 animate-ping rounded-full bg-[#059669] opacity-50" />
            )}
            <span className={`relative h-2 w-2 rounded-full ${skin.dot}`} />
          </span>

          <span className="md:hidden">{copy.short}</span>

          <span className="hidden text-left md:grid">
            <span className="col-start-1 row-start-1 transition-[opacity,transform] duration-200 ease-out group-hover:-translate-y-1.5 group-hover:opacity-0">
              {copy.full}
            </span>
            <span
              aria-hidden
              className="col-start-1 row-start-1 translate-y-1.5 opacity-0 transition-[opacity,transform] duration-200 ease-out group-hover:translate-y-0 group-hover:opacity-100"
            >
              {copy.action}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={handleToggleSound}
          aria-pressed={soundEnabled}
          title={
            soundEnabled
              ? 'Alerta sonoro ligado — clique para desligar'
              : 'Alerta sonoro desligado — clique para ligar e testar a voz'
          }
          aria-label={soundEnabled ? 'Desligar alerta sonoro' : 'Ligar alerta sonoro'}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-[#B91C1C]/40 active:scale-[0.98] ${
            soundEnabled
              ? 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309] hover:bg-[#FEF3C7]'
              : 'border-[#E7E5E4] bg-white text-[#78716C] hover:bg-[#F5F5F4] hover:text-[#1C1917]'
          }`}
        >
          {soundEnabled ? <Bell className="h-[18px] w-[18px]" /> : <BellOff className="h-[18px] w-[18px]" />}
        </button>
      </div>
    </header>
  );
};
