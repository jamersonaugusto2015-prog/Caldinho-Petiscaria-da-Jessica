import React, { useState } from 'react';
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
  const { subtotal, discount, deliveryFee, total } = useCartTotals();
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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      onClick={() => setIsCartOpen(false)}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-center"
    >
      {/* Efeito lâmpada mágica: cortina que desce do topo */}
      <motion.div
        initial={{ clipPath: 'inset(0 0 100% 0)', y: -40, opacity: 0.5 }}
        animate={{ clipPath: 'inset(0 0 0% 0)', y: 0, opacity: 1 }}
        exit={{ clipPath: 'inset(0 0 100% 0)', y: -40, opacity: 0.5 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white text-[#1C1917] w-full max-w-[430px] h-full shadow-2xl flex flex-col justify-between overflow-hidden"
      >
        <div className="p-4 border-b border-[#E7E5E4] bg-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-[#B91C1C]" />
            <h2 className="text-lg font-extrabold text-[#1C1917]">Seu Carrinho</h2>
            <span className="bg-[#FEF2F2] text-[#B91C1C] text-xs font-bold px-2.5 py-0.5 rounded-full border border-[#FCA5A5]">
              {cart.reduce((sum, i) => sum + i.quantity, 0)} itens
            </span>
          </div>

          <button
            onClick={() => setIsCartOpen(false)}
            className="p-2 rounded-full hover:bg-[#F5F5F4] text-[#57534E] hover:text-[#1C1917] transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto space-y-3 bg-[#F5F5F4]/40">
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
          <div className="p-4 bg-white border-t border-[#E7E5E4] space-y-3 shrink-0">
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
    </motion.div>
  );
};
