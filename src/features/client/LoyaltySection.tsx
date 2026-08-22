import React, { useState } from 'react';
import { useCheckout } from './CheckoutStore';
import { useClientShell } from './ClientStore';
import { Award, Gift, Loader2 } from 'lucide-react';
import type { Product } from '../../../contract/catalog/types';
export const LoyaltySection: React.FC = () => {
  const { loyaltyPoints, redeemLoyaltyReward } = useCheckout();
  const { products, triggerToast, settings } = useClientShell();
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [showPick, setShowPick] = useState(false);

  // O custo e a categoria do resgate são DA LOJA (settings), não da
  // plataforma: a constante fixa obrigava toda loja aos mesmos 10 selos.
  const totalNeeded = settings.loyaltyStampCost || 10;
  const isEligible = loyaltyPoints >= totalNeeded;
  const canRedeem = isEligible && settings.isOpen;
  const filled = Math.min(loyaltyPoints, totalNeeded);

  const redeemCategory = settings.loyaltyRedeemCategory || 'caldinhos';
  const redeemOptions: Product[] = products.filter(
    (p) => p.category === redeemCategory && p.available
  );

  const handleRedeem = async (product: Product) => {
    setIsRedeeming(true);
    const res = await redeemLoyaltyReward(product.id);
    triggerToast(res.message);
    setIsRedeeming(false);
    setShowPick(false);
  };

  return (
    <div className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-[#FCD34D] bg-[#FFFBEB] p-4 text-[#1C1917] shadow-sm">
      <div className="flex w-full items-center gap-3 text-left">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#D97706] text-white shadow-md">
          <Award className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-xs font-extrabold text-[#1C1917]">Fidelidade</h4>
            <span className="rounded-full bg-[#D97706] px-2 py-0.5 text-[9px] font-extrabold text-white">
              {filled}/{totalNeeded} selos
              {loyaltyPoints > totalNeeded && <span className="ml-1">({loyaltyPoints})</span>}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-[#78350F]">
            {totalNeeded} pedidos entregues valem 1 item grátis
          </p>

          <div className="mt-2 flex items-center gap-1">
            {Array.from({ length: totalNeeded }).map((_, i) => (
              <div
                key={i}
                className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[7px] font-bold transition ${
                  i < filled
                    ? 'border-[#B91C1C] bg-[#B91C1C] text-white shadow-xs'
                    : 'border-[#FCD34D] bg-white text-[#D97706]'
                }`}
              >
                {i < filled ? '•' : ''}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="w-full space-y-2">
        <button
          disabled={!canRedeem || isRedeeming}
          onClick={() => setShowPick(true)}
          className={`px-5 py-2.5 rounded-full font-extrabold text-[11px] flex items-center justify-center gap-2 shadow-md transition shrink-0 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B91C1C]/40 ${
            canRedeem
              ? 'bg-[#B91C1C] hover:bg-[#991B1B] text-white'
              : 'bg-[#E7E5E4] text-[#A8A29E] cursor-not-allowed'
          }`}
        >
          {isRedeeming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
          <span>
            {!isEligible ? 'Faltam selos' : settings.isOpen ? 'Resgatar item grátis' : 'Loja fechada'}
          </span>
        </button>

        {isEligible && !settings.isOpen && (
          <p className="text-[10px] text-[#B45309] font-bold text-center px-1">
            A loja está fechada agora. Volte quando reabrirmos para resgatar seu item grátis.
          </p>
        )}

        {showPick && (
          <div className="border-t border-[#FDE68A] pt-2 space-y-1.5">
            <p className="text-[10px] font-extrabold text-[#78350F] px-1">
              Escolha seu item grátis:
            </p>
            {redeemOptions.length === 0 && (
              <p className="text-[10px] text-[#A8A29E] px-1">Nenhum caldinho disponível no momento.</p>
            )}
            {redeemOptions.map((p) => (
              <button
                key={p.id}
                onClick={() => handleRedeem(p)}
                className="w-full min-h-11 flex items-center justify-between gap-2 bg-white border border-[#FDE68A] rounded-xl px-3 py-2 hover:bg-[#FEF3C7] transition text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B91C1C]/40"
              >
                {/* Nome de caldinho longo empurrava o selo "GRÁTIS" para fora
                    do cartão amarelo. */}
                <span className="min-w-0 truncate text-[11px] font-bold text-[#1C1917]">{p.name}</span>
                <span className="text-[10px] text-[#059669] font-black shrink-0 ml-2">GRÁTIS</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
