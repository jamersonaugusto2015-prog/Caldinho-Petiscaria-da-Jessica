import React from 'react';
import { useKitchenToastMessage } from './KitchenNotificationsStore';
import { KitchenOrderBoard } from './KitchenOrderBoard';
import { KitchenCatalogEditor } from './KitchenCatalogEditor';
import { KitchenStoreSettings } from './KitchenStoreSettings';
import { KitchenRequestsPanel } from './KitchenRequestsPanel';
import { KitchenRefundsPanel } from './KitchenRefundsPanel';
import { KitchenChatModal } from './KitchenChatModal';
import type { KitchenTab } from './kitchenTabs';

export type { KitchenTab } from './kitchenTabs';

const ORDER_TABS: KitchenTab[] = ['dashboard', 'orders', 'clientes', 'motoboys', 'financeiro', 'relatorios'];
const CATALOG_TABS: KitchenTab[] = ['cardapio', 'categorias', 'promocoes', 'cupons'];

export const KitchenView: React.FC<{
  activeTab: KitchenTab;
  setActiveTab: (tab: KitchenTab) => void;
}> = ({ activeTab, setActiveTab }) => {
  const notificationToast = useKitchenToastMessage();
  return (
    <div className="space-y-6 pb-16">
      {notificationToast && (
        <div className="bg-[#B91C1C] text-white px-4 py-2.5 text-center text-xs font-bold rounded-2xl shadow-md">
          {notificationToast}
        </div>
      )}
      {ORDER_TABS.includes(activeTab) && <KitchenOrderBoard activeTab={activeTab} />}
      {CATALOG_TABS.includes(activeTab) && <KitchenCatalogEditor activeTab={activeTab} />}
      {activeTab === 'solicitacoes' && <KitchenRequestsPanel />}
      {activeTab === 'devolucoes' && <KitchenRefundsPanel />}
      {activeTab === 'config' && <KitchenStoreSettings activeTab={activeTab} setActiveTab={setActiveTab} />}
      <KitchenChatModal />
    </div>
  );
};
