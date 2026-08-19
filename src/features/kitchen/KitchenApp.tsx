import React, { useState } from 'react';
import { Store } from 'lucide-react';
import { KitchenProvider } from './KitchenProvider';
import { KitchenShellProvider, useKitchenShell } from './KitchenShellStore';
import { KitchenHeader } from './KitchenHeader';
import { KitchenSidebar } from './KitchenSidebar';
import { KitchenView } from './KitchenView';
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

  return (
    <div className="k-shell min-h-screen bg-[#F5F5F4] font-sans text-[#1C1917] antialiased selection:bg-[#B91C1C] selection:text-white">
      <KitchenSidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <div
        className={`flex min-h-screen flex-col transition-[padding-left] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          railPinned ? 'lg:pl-[276px]' : 'lg:pl-[76px]'
        }`}
      >
        <KitchenHeader activeTab={activeTab} />
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <KitchenView activeTab={activeTab} setActiveTab={setActiveTab} />
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
        title="Painel do Restaurante"
        icon={<Store className="w-8 h-8" />}
        accentClass="bg-[#B91C1C]"
        onLogin={refresh}
        hint={expired ? 'Sua sessão expirou, entre novamente.' : undefined}
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
