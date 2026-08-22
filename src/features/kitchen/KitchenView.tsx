import React from 'react';
import { AlertBanner } from '../../ui/alertBanner';
import { KitchenOrderBoard } from './KitchenOrderBoard';
import { KitchenCatalogEditor } from './KitchenCatalogEditor';
import { KitchenStoreSettings } from './KitchenStoreSettings';
import { KitchenPromotionsPanel } from './KitchenPromotionsPanel';
import { KitchenRequestsPanel } from './KitchenRequestsPanel';
import { KitchenRatingsPanel } from './KitchenRatingsPanel';
import { KitchenRefundsPanel } from './KitchenRefundsPanel';
import { KitchenChatModal } from './KitchenChatModal';
import { KitchenLoadError } from './KitchenLoadError';
import type { KitchenTab } from './kitchenTabs';

export type { KitchenTab } from './kitchenTabs';

const ORDER_TABS: KitchenTab[] = ['dashboard', 'orders', 'mapa', 'clientes', 'motoboys', 'financeiro', 'relatorios'];
const CATALOG_TABS: KitchenTab[] = ['cardapio', 'categorias', 'cupons'];

export const KitchenView: React.FC<{ activeTab: KitchenTab }> = ({ activeTab }) => {
  return (
    <div className="pb-16">
      {/* Fora do `space-y`: a região viva fica na página mesmo sem aviso, e
          dentro do espaçamento ela empurraria o quadro 24px para baixo o tempo todo. */}
      <AlertBanner variant="kitchen" />
      <KitchenLoadError />
      <div className="space-y-6">
        {ORDER_TABS.includes(activeTab) && <KitchenOrderBoard activeTab={activeTab} />}
        {CATALOG_TABS.includes(activeTab) && <KitchenCatalogEditor activeTab={activeTab} />}
        {activeTab === 'promocoes' && <KitchenPromotionsPanel />}
        {activeTab === 'solicitacoes' && <KitchenRequestsPanel />}
        {activeTab === 'avaliacoes' && <KitchenRatingsPanel />}
        {activeTab === 'devolucoes' && <KitchenRefundsPanel />}
        {activeTab === 'config' && <KitchenStoreSettings />}
        <KitchenChatModal />
      </div>
    </div>
  );
};
