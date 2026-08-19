import React from 'react';
import { useNavigate } from 'react-router-dom';
import { logout } from '../../lib/auth';
import { useKitchenOrders } from './KitchenOrdersStore';
import { useKitchenCatalog } from './KitchenCatalogStore';
import { useKitchenDrivers } from './KitchenDriversStore';
import { useKitchenSettings } from './KitchenSettingsStore';
import { useKitchenChat } from './KitchenChatStore';
import { hasOpenComplaint, hasPendingCancelRequest, owesRefund, refundFailed } from './kitchenOrderRules';
import {
  LayoutDashboard,
  ChefHat,
  UtensilsCrossed,
  Tags,
  Users,
  Megaphone,
  Ticket,
  Wallet,
  BarChart3,
  Settings,
  LogOut,
  Store,
  Bike,
  Inbox,
  Undo2,
} from 'lucide-react';
import type { KitchenTab } from './kitchenTabs';

const NAV_ITEMS: { id: KitchenTab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'orders', label: 'Pedidos', icon: ChefHat },
  { id: 'solicitacoes', label: 'Solicitações', icon: Inbox },
  { id: 'cardapio', label: 'Cardápio', icon: UtensilsCrossed },
  { id: 'categorias', label: 'Categorias', icon: Tags },
  { id: 'clientes', label: 'Clientes', icon: Users },
  { id: 'motoboys', label: 'Motoboys', icon: Bike },
  { id: 'promocoes', label: 'Promoções', icon: Megaphone },
  { id: 'cupons', label: 'Cupons', icon: Ticket },
  { id: 'financeiro', label: 'Financeiro', icon: Wallet },
  { id: 'devolucoes', label: 'A devolver', icon: Undo2 },
  { id: 'relatorios', label: 'Relatórios', icon: BarChart3 },
  { id: 'config', label: 'Configurações', icon: Settings },
];

/** Abas cujo contador é uma pendência: passa a vermelho enquanto for maior que zero. */
const ALERT_TABS: KitchenTab[] = ['solicitacoes', 'devolucoes'];

export const KitchenSidebar: React.FC<{
  activeTab: KitchenTab;
  setActiveTab: (tab: KitchenTab) => void;
}> = ({ activeTab, setActiveTab }) => {
  const navigate = useNavigate();
  const { orders } = useKitchenOrders();
  const { products, coupons } = useKitchenCatalog();
  const { drivers } = useKitchenDrivers();
  const { settings, storeLogo, saveSettings } = useKitchenSettings();
  const { totalUnread } = useKitchenChat();

  const counts: Partial<Record<KitchenTab, number>> = {
    orders: orders.filter((o) => ['recebido', 'em_preparo', 'pronto', 'saiu_entrega'].includes(o.status))
      .length,
    solicitacoes:
      orders.filter(hasPendingCancelRequest).length + orders.filter(hasOpenComplaint).length + totalUnread,
    cardapio: products.length,
    cupons: coupons.length,
    motoboys: drivers.length,
    devolucoes: orders.filter((o) => owesRefund(o) || refundFailed(o)).length,
  };

  const toggleStore = () => {
    const opening = !settings.orderEnabled;
    // Ao abrir, força a abertura (prioridade sobre o horário); ao fechar, volta ao normal
    saveSettings({ orderEnabled: opening, forceOpen: opening });
  };

  const handleLogout = () => {
    logout('kitchen');
    navigate('/');
  };

  const alerting = (tab: KitchenTab) => ALERT_TABS.includes(tab) && !!counts[tab];

  const itemClass = (active: boolean) =>
    `flex items-center gap-3 w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition-colors ${
      active
        ? 'bg-[#B91C1C] text-white shadow-md shadow-[#B91C1C]/20'
        : 'text-[#A8A29E] hover:text-white hover:bg-white/5'
    }`;

  return (
    <>
      <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-[#1C1917] border-r border-[#292524] sticky top-[65px] h-[calc(100vh-65px)]">
        <div className="p-4 border-b border-[#292524] space-y-3">
          <div className="flex items-center gap-3 select-none">
            {storeLogo ? (
              <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center overflow-hidden border border-[#292524]">
                <img src={storeLogo} alt="Logo da loja" className="w-full h-full object-contain p-0.5" />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-xl bg-[#B91C1C] flex items-center justify-center text-white text-lg shadow-md">
                🏪
              </div>
            )}
            <div className="min-w-0">
              <div className="font-extrabold text-sm leading-tight truncate">{settings.storeName}</div>
              <div className="text-[10px] text-[#A8A29E] font-bold uppercase tracking-wider">
                Painel da Cozinha
              </div>
            </div>
          </div>

          <button
            onClick={toggleStore}
            title={
              settings.orderEnabled
                ? 'Clique para fechar a loja (pedidos serão recusados)'
                : 'Clique para abrir a loja'
            }
            className={`w-full flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition active:scale-95 ${
              settings.orderEnabled
                ? 'bg-[#ECFDF5]/10 border border-[#059669]/30 text-[#4ADE80] hover:bg-[#059669]/20'
                : 'bg-[#FEF2F2]/10 border border-[#FCA5A5]/30 text-[#FCA5A5] hover:bg-[#FCA5A5]/15'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                settings.orderEnabled ? 'bg-[#4ADE80] animate-ping' : 'bg-[#FCA5A5]'
              }`}
            />
            <span className="flex-1 text-left">
              {settings.orderEnabled ? 'LOJA ABERTA' : 'LOJA FECHADA'}
            </span>
            {settings.orderEnabled && !settings.isOpen && (
              <span className="text-[8px] uppercase text-[#FCD34D]">fora do horário</span>
            )}
            <span className="text-[9px] text-[#A8A29E]">tocar p/ alternar</span>
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={itemClass(active)}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
                {counts[item.id] !== undefined && (
                  <span
                    className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                      alerting(item.id)
                        ? active
                          ? 'bg-white text-[#B91C1C]'
                          : 'bg-[#B91C1C] text-white'
                        : active
                          ? 'bg-white/20 text-white'
                          : 'bg-white/5 text-[#A8A29E]'
                    }`}
                  >
                    {counts[item.id]}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-[#292524]">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3.5 py-2.5 rounded-xl text-xs font-bold text-[#A8A29E] hover:text-white hover:bg-[#B91C1C]/20 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Sair do painel</span>
          </button>
        </div>
      </aside>

      <nav className="lg:hidden bg-[#1C1917] px-4 py-2.5 border-b border-[#292524] sticky top-[65px] z-30">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1.5 mr-1 shrink-0">
            <Store className="w-3.5 h-3.5 text-[#A8A29E]" />
          </div>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-bold whitespace-nowrap transition-colors shrink-0 ${
                  active ? 'bg-[#B91C1C] text-white' : 'bg-white/5 text-[#A8A29E] hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{item.label}</span>
                {counts[item.id] !== undefined && (
                  <span
                    className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${
                      alerting(item.id)
                        ? active
                          ? 'bg-white text-[#B91C1C]'
                          : 'bg-[#B91C1C] text-white'
                        : active
                          ? 'bg-white/20'
                          : 'bg-white/10'
                    }`}
                  >
                    {counts[item.id]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};
