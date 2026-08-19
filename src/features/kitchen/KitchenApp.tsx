import React, { useState } from 'react';
import { KitchenProvider } from './KitchenProvider';
import { KitchenHeader } from './KitchenHeader';
import { KitchenSidebar } from './KitchenSidebar';
import { KitchenView } from './KitchenView';
import type { KitchenTab } from './kitchenTabs';
import { LoginGate } from '../../components/LoginGate';
import { useRoleSession } from '../../lib/auth';
import { Store } from 'lucide-react';

export const KitchenApp: React.FC = () => {
  const { authenticated, expired, refresh } = useRoleSession('kitchen');
  const [activeTab, setActiveTab] = useState<KitchenTab>('dashboard');

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
      <div className="min-h-screen bg-[#F5F5F4] text-[#1C1917] font-sans antialiased selection:bg-[#B91C1C] selection:text-white">
        <KitchenHeader />
        <div className="flex">
          <KitchenSidebar activeTab={activeTab} setActiveTab={setActiveTab} />
          <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6">
            <KitchenView activeTab={activeTab} setActiveTab={setActiveTab} />
          </main>
        </div>
      </div>
    </KitchenProvider>
  );
};
