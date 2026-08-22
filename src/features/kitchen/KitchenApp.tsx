import React, { useEffect, useState } from 'react';
import { Store } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { KitchenProvider } from './KitchenProvider';
import { KitchenShellProvider, useKitchenShell } from './KitchenShellStore';
import { KitchenHeader } from './KitchenHeader';
import { KitchenSidebar } from './KitchenSidebar';
import { KitchenView } from './KitchenView';
import { useKitchenToast } from './KitchenNotificationsStore';
import type { KitchenTab } from './kitchenTabs';
import { LoginGate } from '../../components/LoginGate';
import { useRoleSession } from '../../lib/auth';

/**
 * O rail é fixo, então quem reserva o espaço dele é o conteúdo: 76px com o menu
 * solto, 276px com o menu fixado. Solto, ele abre por cima e não empurra nada.
 */
const KitchenShell: React.FC = () => {
  const [activeTab, setActiveTab] = useState<KitchenTab>('dashboard');
  const { railPinned } = useKitchenShell();
  const [searchParams, setSearchParams] = useSearchParams();
  const triggerToast = useKitchenToast();

  // A volta do OAuth do Mercado Pago cai no painel na aba inicial. Tratar o
  // retorno aqui (e não dentro das Configurações, que só existem quando a aba
  // está aberta) garante que o aviso apareça e a tela certa seja mostrada.
  useEffect(() => {
    const result = searchParams.get('mp');
    if (!result) return;
    setActiveTab('config');
    triggerToast(result === 'ok' ? 'Mercado Pago conectado.' : searchParams.get('reason') || 'Falha ao conectar o Mercado Pago.');
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, triggerToast]);

  return (
    // `px-safe`: o painel roda em tablet deitado, e nessa posição o notch come a
    // borda esquerda ou direita — sem o recuo o quadro de pedidos nascia meio
    // escondido atrás dele. `overflow-x-clip` (e não `hidden`, que viraria um
    // contêiner de rolagem e quebraria o cabeçalho `sticky`) garante que nada
    // dentro do painel faça a PÁGINA inteira rolar para o lado no celular.
    <div className="k-shell min-h-dscreen overflow-x-clip px-safe bg-[#F5F5F4] font-sans text-[#1C1917] antialiased selection:bg-[#B91C1C] selection:text-white">
      <KitchenSidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <div
        className={`flex min-h-dscreen flex-col transition-[padding-left] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          railPinned ? 'lg:pl-[276px]' : 'lg:pl-[76px]'
        }`}
      >
        <KitchenHeader activeTab={activeTab} />
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <KitchenView activeTab={activeTab} />
        </main>
      </div>
    </div>
  );
};

export const KitchenApp: React.FC = () => {
  const { authenticated, expired, refresh } = useRoleSession('kitchen');

  if (!authenticated) {
    return (
      <LoginGate
        role="kitchen"
        title="Painel da cozinha"
        icon={<Store className="w-8 h-8" />}
        accentClass="bg-[#B91C1C]"
        onLogin={refresh}
        hint={expired ? 'Sua sessão expirou. Entre com o PIN de novo.' : undefined}
      />
    );
  }

  return (
    <KitchenProvider>
      <KitchenShellProvider>
        <KitchenShell />
      </KitchenShellProvider>
    </KitchenProvider>
  );
};
