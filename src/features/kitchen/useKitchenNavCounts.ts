import { useKitchenChat } from './KitchenChatStore';
import { useKitchenOrders } from './KitchenOrdersStore';
import { hasOpenComplaint, hasPendingCancelRequest, owesRefund, refundFailed } from './kitchenOrderRules';
import type { KitchenTab } from './kitchenTabs';

const ACTIVE_STATUSES = ['recebido', 'em_preparo', 'pronto', 'saiu_entrega'];

/** Abas cujo número é uma pendência: viram alerta enquanto forem maiores que zero. */
export const KITCHEN_ALERT_TABS: KitchenTab[] = ['solicitacoes', 'devolucoes'];

/**
 * Só conta o que pede ação. Quantos produtos ou cupons existem no cadastro não
 * é pendência nenhuma — esse número virava ruído fixo ao lado de cada aba.
 */
export const useKitchenNavCounts = (): Partial<Record<KitchenTab, number>> => {
  const { orders } = useKitchenOrders();
  const { totalUnread } = useKitchenChat();

  return {
    orders: orders.filter((o) => ACTIVE_STATUSES.includes(o.status)).length,
    solicitacoes:
      orders.filter(hasPendingCancelRequest).length + orders.filter(hasOpenComplaint).length + totalUnread,
    devolucoes: orders.filter((o) => owesRefund(o) || refundFailed(o)).length,
  };
};

/** Frase curta que o cabeçalho mostra ao lado do título da seção aberta. */
export const kitchenTabMeta = (tab: KitchenTab, count: number): string | null => {
  if (!count) return null;
  if (tab === 'orders') return `${count} em andamento`;
  if (tab === 'solicitacoes') return `${count} aguardando resposta`;
  if (tab === 'devolucoes') return count === 1 ? '1 estorno pendente' : `${count} estornos pendentes`;
  return null;
};
