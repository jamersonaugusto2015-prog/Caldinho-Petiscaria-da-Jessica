import {
  BarChart3,
  Bike,
  ChefHat,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  Settings,
  Tags,
  Ticket,
  Undo2,
  UtensilsCrossed,
  Users,
  Wallet,
} from 'lucide-react';

export type KitchenTab =
  | 'dashboard'
  | 'orders'
  | 'solicitacoes'
  | 'cardapio'
  | 'categorias'
  | 'clientes'
  | 'motoboys'
  | 'promocoes'
  | 'cupons'
  | 'financeiro'
  | 'devolucoes'
  | 'relatorios'
  | 'config';

export interface KitchenNavItem {
  id: KitchenTab;
  label: string;
  icon: LucideIcon;
}

export interface KitchenNavGroup {
  id: string;
  label: string;
  items: KitchenNavItem[];
}

/**
 * Treze abas em uma lista corrida viram uma parede. Agrupadas por assunto, a
 * navegação vira quatro decisões curtas — e o rail fechado só mostra os
 * separadores, sem texto nenhum.
 */
export const KITCHEN_NAV: KitchenNavGroup[] = [
  {
    id: 'operacao',
    label: 'Operação',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'orders', label: 'Pedidos', icon: ChefHat },
      { id: 'solicitacoes', label: 'Solicitações', icon: Inbox },
    ],
  },
  {
    id: 'cardapio',
    label: 'Cardápio',
    items: [
      { id: 'cardapio', label: 'Cardápio', icon: UtensilsCrossed },
      { id: 'categorias', label: 'Categorias', icon: Tags },
      { id: 'promocoes', label: 'Promoções', icon: Megaphone },
      { id: 'cupons', label: 'Cupons', icon: Ticket },
    ],
  },
  {
    id: 'pessoas',
    label: 'Pessoas',
    items: [
      { id: 'clientes', label: 'Clientes', icon: Users },
      { id: 'motoboys', label: 'Motoboys', icon: Bike },
    ],
  },
  {
    id: 'financeiro',
    label: 'Financeiro',
    items: [
      { id: 'financeiro', label: 'Caixa', icon: Wallet },
      { id: 'devolucoes', label: 'A devolver', icon: Undo2 },
      { id: 'relatorios', label: 'Relatórios', icon: BarChart3 },
    ],
  },
  {
    id: 'sistema',
    label: 'Sistema',
    items: [{ id: 'config', label: 'Configurações', icon: Settings }],
  },
];

export const KITCHEN_NAV_ITEMS: KitchenNavItem[] = KITCHEN_NAV.flatMap((group) => group.items);

export const kitchenTabLabel = (tab: KitchenTab): string =>
  KITCHEN_NAV_ITEMS.find((item) => item.id === tab)?.label ?? 'Painel';
