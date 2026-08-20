import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { useCart } from './CartStore';
import { useClientShell, useCartTotals } from './ClientStore';
import { formatKm, effectiveDistanceKm } from '../../shared/geo';
import { formatAddressLine, isUsableAddress } from '../../shared/address';
import { storeAddressLine } from '../../shared/fulfillment';
import { FulfillmentPicker } from './FulfillmentPicker';
import { computeCartItemTotal } from '../../shared/pricing';
import { X, Trash2, Plus, Minus, Ticket, ArrowRight, ShoppingBag, MapPin } from 'lucide-react';

interface CartDrawerProps {
  onOpenCheckout: () => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({ onOpenCheckout }) => {
  const {
    cart,
    setIsCartOpen,
    removeFromCart,
    updateCartQuantity,
    appliedCoupon,
    applyCoupon,
    removeCoupon,
    selectedAddress,
    fulfillment,
    openAddressForm,
    setAddressModalOpen,
  } = useCart();
  const { settings } = useClientShell();
  const { subtotal, discount, appliedPromotions, blockedPromotions, deliveryFee, total } =
    useCartTotals();
  const isPickupMode = fulfillment === 'pickup';
  const hasAddress = isPickupMode || isUsableAddress(selectedAddress);
  const outOfRange = !isPickupMode && isUsableAddress(selectedAddress) && deliveryFee < 0;
  const liveKm =
    !isPickupMode && selectedAddress && isUsableAddress(selectedAddress)
      ? effectiveDistanceKm(selectedAddress, settings)
      : 0;

  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);

  const handleApplyCoupon = (e: React.FormEvent) => {
    e.preventDefault();
    setCouponError(null);
    const res = applyCoupon(couponInput);
    if (!res.success) {
      setCouponError(res.message);
    } else {
      setCouponInput('');
    }
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={() => setIsCartOpen(false)}
      className="fixed inset-0 z-50 flex justify-center bg-black/60 backdrop-blur-xs"
    >
      {/* Sem clip-path: no Safari iOS a cortina deixava o cabeçalho cortado
          (título e X sumiam atrás da barra de status). */}
      <motion.div
        initial={{ y: 28, opacity: 0.6 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 28, opacity: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-[430px] flex-col overflow-hidden bg-white text-[#1C1917] shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#E7E5E4] bg-white px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
          <div className="flex min-w-0 items-center gap-2">
            <ShoppingBag className="h-5 w-5 shrink-0 text-[#B91C1C]" />
            <h2 className="text-lg font-extrabold text-[#1C1917]">Seu Carrinho</h2>
            <span className="rounded-full border border-[#FCA5A5] bg-[#FEF2F2] px-2.5 py-0.5 text-xs font-bold text-[#B91C1C]">
              {cart.reduce((sum, i) => sum + i.quantity, 0)} itens
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsCartOpen(false)}
            className="rounded-full p-2 text-[#57534E] transition hover:bg-[#F5F5F4] hover:text-[#1C1917]"
            aria-label="Fechar sacola"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#F5F5F4]/40 p-4">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[#57534E]">
              <div className="w-16 h-16 rounded-2xl bg-[#FEF2F2] flex items-center justify-center text-3xl mb-3 text-[#B91C1C]">
                🍲
              </div>
              <p className="text-base font-bold text-[#1C1917] mb-1">Seu carrinho está vazio</p>
              <p className="text-xs max-w-xs text-[#57534E]">
                Que tal escolher um caldinho bem quente ou um petisco crocante no nosso cardápio?
              </p>
            </div>
          ) : (
            cart.map((item) => (
              <div
                key={item.id}
                className="bg-white border border-[#E7E5E4] rounded-2xl p-3 flex gap-3 relative shadow-xs"
              >
                <img
                  src={item.product.image}
                  alt={item.product.name}
                  className="w-16 h-16 rounded-2xl object-cover shrink-0 bg-[#F5F5F4]"
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-xs font-bold text-[#1C1917] line-clamp-1">
                      {item.product.name}
                    </h4>
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="text-[#A8A29E] hover:text-[#B91C1C] transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {item.size && (
                    <div className="text-[10px] text-[#57534E] font-semibold mt-0.5">
                      Tamanho: {item.size}
                    </div>
                  )}

                  {item.selectedExtras.length > 0 && (
                    <div className="text-[10px] text-[#57534E] mt-0.5 line-clamp-1">
                      + {item.selectedExtras.map((e) => e.name).join(', ')}
                    </div>
                  )}

                  {item.comboChoices && item.comboChoices.length > 0 && (
                    <div className="text-[10px] text-[#D97706] mt-0.5">
                      {item.comboChoices.map((c) => `${c.slotLabel}: ${c.optionLabel}`).join(' • ')}
                    </div>
                  )}

                  {item.observation && (
                    <div className="text-[10px] text-[#A8A29E] italic mt-0.5 line-clamp-1">
                      Obs: "{item.observation}"
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-2 pt-1 border-t border-[#F5F5F4]">
                    <span className="font-extrabold text-xs text-[#B91C1C]">
                      R$ {computeCartItemTotal(item, settings.sizeOptions).toFixed(2)}
                    </span>

                    <div className="flex items-center bg-[#F5F5F4] rounded-full border border-[#E7E5E4] p-0.5">
                      <button
                        onClick={() => updateCartQuantity(item.id, -1)}
                        className="p-1 hover:bg-[#E7E5E4] rounded-full text-[#1C1917]"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="px-2 text-xs font-extrabold text-[#1C1917]">{item.quantity}</span>
                      <button
                        onClick={() => updateCartQuantity(item.id, 1)}
                        className="p-1 hover:bg-[#E7E5E4] rounded-full text-[#1C1917]"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {cart.length > 0 && (
          <div className="shrink-0 space-y-3 border-t border-[#E7E5E4] bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
            {settings.pickupEnabled && <FulfillmentPicker />}

            {!isPickupMode && (
              <button
                type="button"
                onClick={() => (hasAddress ? setAddressModalOpen(true) : openAddressForm())}
                className="w-full bg-[#F5F5F4] p-2.5 rounded-2xl border border-[#E7E5E4] flex items-center gap-2 text-xs text-[#57534E] text-left hover:bg-[#E7E5E4]"
              >
                <MapPin className="w-4 h-4 text-[#B91C1C] shrink-0" />
                <div className="truncate flex-1">
                  {hasAddress ? (
                    <span className="font-bold text-[#1C1917]">{formatAddressLine(selectedAddress)}</span>
                  ) : (
                    <span className="font-bold text-[#B91C1C]">Toque para adicionar o endereço</span>
                  )}
                </div>
              </button>
            )}

            <div>
              {!appliedCoupon ? (
                <form onSubmit={handleApplyCoupon} className="flex gap-2">
                  <div className="relative flex-1">
                    <Ticket className="w-4 h-4 text-[#B91C1C] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value)}
                      placeholder="Cupom (ex: CALDINHO10)"
                      className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-full text-xs text-[#1C1917] pl-9 pr-3 py-2 uppercase placeholder-[#A8A29E] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                    />
                  </div>
                  <button
                    type="submit"
                    className="bg-[#1C1917] hover:bg-[#292524] text-white font-bold px-4 py-2 rounded-full text-xs transition"
                  >
                    Aplicar
                  </button>
                </form>
              ) : (
                <div className="bg-[#ECFDF5] border border-[#A7F3D0] p-2 rounded-2xl flex items-center justify-between text-xs text-[#059669]">
                  <span className="font-bold">Cupom {appliedCoupon.code} aplicado!</span>
                  <button onClick={removeCoupon} className="text-[#B91C1C] hover:underline font-bold text-[11px]">
                    Remover
                  </button>
                </div>
              )}
              {couponError && <p className="text-[11px] text-[#B91C1C] font-semibold mt-1">{couponError}</p>}
            </div>

            {isPickupMode && (
              <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-2xl p-3 text-[11px] text-[#065F46]">
                <strong className="block text-xs font-extrabold">Retirada na loja — sem taxa</strong>
                <span className="block mt-0.5">{storeAddressLine(settings)}</span>
              </div>
            )}

            <div className="space-y-1.5 text-xs text-[#57534E]">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="text-[#1C1917] font-semibold">R$ {subtotal.toFixed(2)}</span>
              </div>

              {discount > 0 && (
                <div className="flex justify-between text-[#059669] font-bold">
                  <span>Desconto cupom</span>
                  <span>- R$ {discount.toFixed(2)}</span>
                </div>
              )}

              {/* Cada promoção aparece com o nome que a loja deu: o cliente entende
                  de onde veio o desconto sem precisar perguntar. */}
              {appliedPromotions.map((promo) => (
                <div key={promo.id} className="flex justify-between text-[#059669] font-bold">
                  <span className="truncate pr-2">🎉 {promo.name}</span>
                  <span className="shrink-0">
                    {promo.kind === 'frete' ? 'Frete abatido' : `- R$ ${promo.discount.toFixed(2)}`}
                  </span>
                </div>
              ))}

              {blockedPromotions.length > 0 && (
                <p className="text-[11px] text-[#B45309] bg-[#FEF3C7] border border-[#FDE68A] rounded-xl px-2.5 py-2 font-semibold">
                  O cupom desliga {blockedPromotions.length === 1 ? 'a promoção' : 'as promoções'}{' '}
                  {blockedPromotions.map((promo) => promo.name).join(', ')}. Tire o cupom para usar a promoção.
                </p>
              )}

              <div className="flex justify-between">
                <span>
                  {isPickupMode
                    ? 'Retirada na loja'
                    : `Taxa de entrega (${liveKm > 0 ? formatKm(liveKm) : '—'})`}
                </span>
                <span className={`font-semibold ${outOfRange ? 'text-[#B91C1C]' : 'text-[#1C1917]'}`}>
                  {isPickupMode ? 'Grátis' : outOfRange ? 'Fora da área' : `R$ ${deliveryFee.toFixed(2)}`}
                </span>
              </div>

              {outOfRange && (
                <p className="text-[11px] text-[#B91C1C] font-bold">
                  Este endereço está fora da área de entrega.
                </p>
              )}

              <div className="flex justify-between text-base font-black text-[#1C1917] pt-2 border-t border-[#E7E5E4]">
                <span>Total do Pedido</span>
                <span className="text-[#B91C1C]">{outOfRange ? '—' : `R$ ${total.toFixed(2)}`}</span>
              </div>
            </div>

            <button
              disabled={outOfRange || !hasAddress}
              onClick={() => {
                if (!hasAddress) {
                  openAddressForm();
                  return;
                }
                if (outOfRange) return;
                setIsCartOpen(false);
                onOpenCheckout();
              }}
              className="w-full bg-[#B91C1C] hover:bg-[#991B1B] text-white font-extrabold py-3.5 px-4 rounded-full shadow-md flex items-center justify-center gap-2 transition text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span>Continuar</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>,
    document.body
  );
};
