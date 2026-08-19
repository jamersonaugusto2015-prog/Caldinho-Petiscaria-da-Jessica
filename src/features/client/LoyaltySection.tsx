import React, { useState } from 'react';
import { useCheckout } from './CheckoutStore';
import { useClientShell } from './ClientStore';
import { Award, Gift, Loader2 } from 'lucide-react';
import { Product } from '../../types';
import { LOYALTY_STAMP_COST } from '../../shared/constants';

export const LoyaltySection: React.FC = () => {
  const { loyaltyPoints, redeemLoyaltyReward } = useCheckout();
  const { products, triggerToast, settings } = useClientShell();
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [showPick, setShowPick] = useState(false);

  const totalNeeded = LOYALTY_STAMP_COST;
  const isEligible = loyaltyPoints >= totalNeeded;
  const canRedeem = isEligible && settings.isOpen;
  const filled = Math.min(loyaltyPoints, totalNeeded);

  const redeemOptions: Product[] = products.filter((p) => p.category === 'caldinhos' && p.available);

  const handleRedeem = async (product: Product) => {
    setIsRedeeming(true);
    const res = await redeemLoyaltyReward(product.id);
    triggerToast(res.message);
    setIsRedeeming(false);
    setShowPick(false);
  };

  return (
    <div className="bg-gradient-to-r from-[#FFFBEB] via-[#FEF3C7] to-[#FDE68A] text-[#1C1917] rounded-2xl p-4 border border-[#FCD34D] shadow-sm flex flex-col items-center justify-between gap-3">
      <div className="flex items-center gap-3 text-center w-full">
        <div className="w-10 h-10 rounded-xl bg-[#D97706] text-white flex items-center justify-center shrink-0 shadow-md">
          <Award className="w-5 h-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <h4 className="font-extrabold text-xs text-[#1C1917]">
              Programa de Fidelidade
            </h4>
            <span className="bg-[#D97706] text-white text-[9px] font-extrabold px-2 py-0.5 rounded-full">
              {filled}/{totalNeeded} SELOS
              {loyaltyPoints > totalNeeded && <span className="ml-1">({loyaltyPoints})</span>}
            </span>
          </div>
          <p className="text-[11px] text-[#78350F] mt-0.5">
            Faça 10 pedidos entregues e ganhe 1 Caldinho grátis!
          </p>

          <div className="flex items-center gap-1 mt-2 justify-center">
            {Array.from({ length: totalNeeded }).map((_, i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold border transition ${
                  i < filled
                    ? 'bg-[#B91C1C] text-white border-[#B91C1C] shadow-xs'
                    : 'bg-white/80 border-[#FCD34D] text-[#D97706]'
                }`}
              >
                {i < filled ? '🍲' : i + 1}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="w-full space-y-2">
        <button
          disabled={!canRedeem || isRedeeming}
          onClick={() => setShowPick(true)}
          className={`px-5 py-2.5 rounded-full font-extrabold text-[11px] flex items-center justify-center gap-2 shadow-md transition shrink-0 w-full ${
            canRedeem
              ? 'bg-[#B91C1C] hover:bg-[#991B1B] text-white animate-bounce'
              : 'bg-[#E7E5E4] text-[#A8A29E] cursor-not-allowed'
          }`}
        >
          {isRedeeming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
          <span>
            {!isEligible ? 'Faltam Selos' : settings.isOpen ? 'Resgatar Caldinho Grátis!' : 'Loja fechada'}
          </span>
        </button>

        {isEligible && !settings.isOpen && (
          <p className="text-[10px] text-[#B45309] font-bold text-center px-1">
            A loja está fechada agora. Volte quando reabrirmos para resgatar seu caldinho grátis.
          </p>
        )}

        {showPick && (
          <div className="bg-white/80 border border-[#FCD34D] rounded-2xl p-2 space-y-1.5">
            <p className="text-[10px] font-extrabold text-[#78350F] px-1">
              Escolha seu caldinho grátis:
            </p>
            {redeemOptions.length === 0 && (
              <p className="text-[10px] text-[#A8A29E] px-1">Nenhum caldinho disponível no momento.</p>
            )}
            {redeemOptions.map((p) => (
              <button
                key={p.id}
                onClick={() => handleRedeem(p)}
                className="w-full flex items-center justify-between bg-white border border-[#FDE68A] rounded-xl px-3 py-2 hover:bg-[#FEF3C7] transition text-left"
              >
                <span className="text-[11px] font-bold text-[#1C1917]">{p.name}</span>
                <span className="text-[10px] text-[#059669] font-black shrink-0 ml-2">GRÁTIS</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
