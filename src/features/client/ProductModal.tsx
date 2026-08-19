import React, { useState } from 'react';
import { Product, CartItemExtra, ComboSlotOption } from '../../types';
import { useCart } from './CartStore';
import { useClientShell } from './ClientStore';
import { computeCartItemTotal } from '../../shared/pricing';
import { X, Plus, Minus, ShoppingBag, Check, Sparkles } from 'lucide-react';

interface ProductModalProps {
  product: Product;
  onClose: () => void;
}

export const ProductModal: React.FC<ProductModalProps> = ({ product, onClose }) => {
  const { addToCart } = useCart();
  const { settings } = useClientShell();

  const slots = product.comboSlots ?? [];
  const [comboChoices, setComboChoices] = useState<Record<string, ComboSlotOption>>({});
  const [selectedExtras, setSelectedExtras] = useState<CartItemExtra[]>([]);
  const [observation, setObservation] = useState('');
  const [quantity, setQuantity] = useState(1);

  const chosenCount = Object.keys(comboChoices).length;
  const missingSlot = slots.find((s) => s.required && !comboChoices[s.id]);
  const canAdd = slots.length === 0 || !missingSlot;

  const previewChoices = (Object.entries(comboChoices) as [string, ComboSlotOption][]).map(
    ([slotId, opt]) => ({
      slotId,
      slotLabel: slots.find((s) => s.id === slotId)?.label ?? slotId,
      optionId: opt.id,
      optionLabel: opt.label,
      priceDelta: opt.priceDelta ?? 0,
    })
  );
  const totalItemPrice = computeCartItemTotal(
    {
      product,
      selectedExtras,
      comboChoices: previewChoices,
      quantity,
    },
    settings.sizeOptions
  );

  const toggleExtra = (extra: { id: string; name: string; price: number }) => {
    setSelectedExtras((prev) => {
      const exists = prev.some((e) => e.id === extra.id);
      if (exists) return prev.filter((e) => e.id !== extra.id);
      return [...prev, extra];
    });
  };

  const handleAddToCart = () => {
    if (!canAdd) return;
    const added = addToCart({
      product,
      ...(slots.length > 0
        ? {
            comboChoices: (Object.entries(comboChoices) as [string, ComboSlotOption][]).map(
              ([slotId, opt]) => ({
                slotId,
                slotLabel: slots.find((s) => s.id === slotId)?.label ?? slotId,
                optionId: opt.id,
                optionLabel: opt.label,
                priceDelta: opt.priceDelta ?? 0,
              })
            ),
          }
        : {}),
      selectedExtras,
      observation,
      quantity,
    });
    if (added) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end justify-center overflow-y-auto">
      <div className="bg-white text-[#1C1917] w-full max-w-[430px] rounded-t-3xl border border-[#E7E5E4] shadow-2xl overflow-hidden relative max-h-[90vh] flex flex-col my-auto animate-slide-up">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 bg-white/80 hover:bg-white text-[#1C1917] p-2 rounded-full border border-[#E7E5E4] shadow-md backdrop-blur-xs transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="relative h-44 w-full shrink-0 bg-[#F5F5F4]">
          <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          <div className="absolute bottom-4 left-5 right-5 text-white">
            <h2 className="text-xl font-extrabold text-white">{product.name}</h2>
            <p className="text-xs text-[#E7E5E4] mt-1 line-clamp-2">{product.description}</p>
          </div>
        </div>

        <div className="p-4 space-y-5 overflow-y-auto flex-1">
          {slots.length > 0 && (
            <div>
              <label className="block text-xs font-black text-[#1C1917] uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#D97706]" />
                Escolha os Sabores
                <span className="text-[10px] text-[#B91C1C] font-extrabold bg-[#FEF2F2] px-2 py-0.5 rounded-full">
                  {chosenCount}/{slots.length}
                </span>
              </label>
              <div className="space-y-3">
                {slots.map((slot) => {
                  const chosen = comboChoices[slot.id];
                  return (
                    <div key={slot.id}>
                      <div className="text-[11px] font-extrabold text-[#1C1917] mb-1.5">
                        {slot.label}
                        {slot.required && <span className="text-[#B91C1C]"> *</span>}
                      </div>
                      <div className="grid grid-cols-1 gap-1.5">
                        {slot.options.map((opt) => {
                          const isSelected = chosen?.id === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() =>
                                setComboChoices((prev) => ({ ...prev, [slot.id]: opt }))
                              }
                              className={`p-3 rounded-2xl border text-left transition flex items-center justify-between gap-2 ${
                                isSelected
                                  ? 'bg-[#FEF2F2] border-[#B91C1C] ring-2 ring-[#B91C1C]/20 shadow-sm'
                                  : 'bg-[#F5F5F4]/60 border-[#E7E5E4] hover:bg-[#F5F5F4]'
                              }`}
                            >
                              <span className="text-xs font-bold text-[#1C1917]">{opt.label}</span>
                              <span className="flex items-center gap-2 shrink-0">
                                {opt.priceDelta != null && opt.priceDelta > 0 && (
                                  <span className="text-[10px] font-extrabold text-[#B91C1C]">
                                    +R$ {opt.priceDelta.toFixed(2)}
                                  </span>
                                )}
                                <span
                                  className={`w-5 h-5 rounded-full flex items-center justify-center transition ${
                                    isSelected ? 'bg-[#B91C1C] text-white' : 'bg-white border border-[#E7E5E4]'
                                  }`}
                                >
                                  {isSelected && <Check className="w-3 h-3" />}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {missingSlot && (
                  <p className="text-[10px] text-[#B91C1C] font-bold bg-[#FEF2F2] border border-[#FCA5A5] rounded-xl p-2">
                    Escolha uma opção para "{missingSlot.label}" antes de adicionar.
                  </p>
                )}
              </div>
            </div>
          )}

          {product.allowedExtras && product.allowedExtras.length > 0 && (
            <div>
              <label className="block text-xs font-black text-[#1C1917] uppercase tracking-wider mb-2.5">
                Adicionais & Acompanhamentos
              </label>
              <div className="space-y-2">
                {product.allowedExtras.map((extra) => {
                  const isChecked = selectedExtras.some((e) => e.id === extra.id);
                  return (
                    <div
                      key={extra.id}
                      onClick={() => toggleExtra(extra)}
                      className={`p-3.5 rounded-2xl border cursor-pointer transition flex items-center justify-between ${
                        isChecked
                          ? 'bg-[#FEF2F2] border-[#B91C1C] shadow-xs'
                          : 'bg-[#F5F5F4]/60 border-[#E7E5E4] hover:bg-[#F5F5F4]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-5 h-5 rounded-md border flex items-center justify-center transition ${
                            isChecked
                              ? 'bg-[#B91C1C] border-[#B91C1C] text-white'
                              : 'border-[#A8A29E] bg-white'
                          }`}
                        >
                          {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </div>
                        <span className="text-xs font-bold text-[#1C1917]">{extra.name}</span>
                      </div>
                      <span className="text-xs font-extrabold text-[#B91C1C]">
                        +R$ {extra.price.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-black text-[#1C1917] uppercase tracking-wider mb-2">
              Observações do Pedido
            </label>
            <textarea
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              placeholder="Ex: Capricha no cheiro verde, mandar maionese caseira separada..."
              className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-3 text-xs text-[#1C1917] placeholder-[#A8A29E] focus:outline-none focus:ring-2 focus:ring-[#B91C1C] resize-none h-20"
            />
          </div>
        </div>

        <div className="p-3.5 pb-[calc(env(safe-area-inset-bottom)+14px)] bg-white border-t border-[#E7E5E4] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center bg-[#F5F5F4] rounded-full border border-[#E7E5E4] p-1">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="p-2 hover:bg-[#E7E5E4] rounded-full text-[#1C1917] transition"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="px-3 text-sm font-black text-[#1C1917]">{quantity}</span>
            <button
              onClick={() => setQuantity((q) => q + 1)}
              className="p-2 hover:bg-[#E7E5E4] rounded-full text-[#1C1917] transition"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={handleAddToCart}
            disabled={!canAdd}
            className={`flex-1 font-extrabold py-3.5 px-5 rounded-full shadow-md flex items-center justify-between transition active:scale-98 ${
              canAdd
                ? 'bg-[#B91C1C] hover:bg-[#991B1B] text-white'
                : 'bg-[#E7E5E4] text-[#A8A29E] cursor-not-allowed'
            }`}
          >
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4" />
              <span className="text-xs">{canAdd ? 'Adicionar ao Carrinho' : 'Escolha os sabores'}</span>
            </div>
            <span className="text-sm font-extrabold">R$ {totalItemPrice.toFixed(2)}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
