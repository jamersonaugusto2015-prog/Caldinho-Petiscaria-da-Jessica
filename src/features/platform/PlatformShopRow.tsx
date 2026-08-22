import React, { useState } from 'react';
import { CreditCard, ExternalLink, KeyRound, Power, ReceiptText, ShoppingBag } from 'lucide-react';
import { formatCents } from '../../../contract/pricing/money';
import type { ShopStatus } from '../../../contract/shop/platform';

export const PlatformShopRow: React.FC<{
  shop: ShopStatus;
  onToggleActive: (shop: ShopStatus) => Promise<void>;
  onResetPin: (shop: ShopStatus) => void;
}> = ({ shop, onToggleActive, onResetPin }) => {
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const handleToggle = async () => {
    setToggleError(null);
    setToggling(true);
    try {
      await onToggleActive(shop);
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : 'Não foi possível salvar. Tente de novo.');
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[#E7E5E4] bg-white p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="truncate text-sm font-extrabold text-[#1C1917]">{shop.name}</strong>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                shop.active ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-[#FEF2F2] text-[#B91C1C]'
              }`}
            >
              {shop.active ? 'Ativa' : 'Desativada'}
            </span>
            <span
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                shop.mercadoPagoConnected ? 'bg-[#EFF6FF] text-[#1D4ED8]' : 'bg-[#F5F5F4] text-[#78716C]'
              }`}
            >
              <CreditCard className="h-3 w-3" />
              {shop.mercadoPagoConnected ? 'Mercado Pago conectado' : 'Mercado Pago não conectado'}
            </span>
          </div>
          {/*
            Sem `SHOP_BASE_DOMAIN` a loja não TEM endereço, e o painel diz isso
            em vez de inventar um link. Um link que não abre, entregue ao dono
            da loja, é pior do que nenhum: ele acha que o problema é a loja.
          */}
          {shop.url ? (
            <a
              href={shop.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 flex items-center gap-1 text-xs font-bold text-[#57534E] hover:text-[#1C1917]"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{shop.url}</span>
            </a>
          ) : (
            <p className="mt-1 text-xs font-bold text-[#B45309]">
              Sem endereço: configure SHOP_BASE_DOMAIN no servidor.
            </p>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => onResetPin(shop)} className="btn-secondary">
            <KeyRound className="h-3.5 w-3.5" />
            Redefinir PIN
          </button>
          <button type="button" onClick={() => void handleToggle()} disabled={toggling} className={shop.active ? 'btn-danger' : 'btn-primary'}>
            {toggling ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Power className="h-3.5 w-3.5" />
            )}
            {shop.active ? 'Desativar' : 'Ativar'}
          </button>
        </div>
      </div>

      {toggleError && (
        <p role="alert" className="mt-3 rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-2 py-1.5 text-[11px] font-bold text-[#B91C1C]">
          {toggleError}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-4 border-t border-[#F5F5F4] pt-3 text-xs font-bold text-[#57534E]">
        <span className="flex items-center gap-1.5">
          <ShoppingBag className="h-3.5 w-3.5 text-[#A8A29E]" />
          {shop.ordersToday} {shop.ordersToday === 1 ? 'pedido hoje' : 'pedidos hoje'}
        </span>
        <span className="flex items-center gap-1.5">
          <ReceiptText className="h-3.5 w-3.5 text-[#A8A29E]" />
          {formatCents(shop.revenueTodayCents)} hoje
        </span>
      </div>
    </div>
  );
};
