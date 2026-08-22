import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ComboChoice, ComboSlot, ComboSlotOption, Product } from '../../../contract/catalog/types';
import type { CartItemExtra } from '../../../contract/order/types';
import { useCart } from './CartStore';
import { useClientShell } from './ClientStore';
import { computeCartItemTotal } from '../../../contract/pricing/pricing';
import { bestProductPromotion } from '../../../contract/catalog/promotions';
import {
  ArrowDown,
  Check,
  Clock,
  Expand,
  Flame,
  Minus,
  Plus,
  ShoppingBag,
  Sparkles,
  Star,
  X,
  Zap,
} from 'lucide-react';
import { formatMoney } from '../../../contract/pricing/money';

interface ProductModalProps {
  product: Product;
  onClose: () => void;
}


/** Soma as unidades escolhidas num bloco (ex.: 2× Feijão + 1× Camarão = 3). */
function countSlotChoices(slotCounts: Record<string, number> | undefined): number {
  let total = 0;
  for (const key in slotCounts) total += slotCounts[key] ?? 0;
  return total;
}

/** Rótulo curto da regra do bloco: "Escolha 3", "Escolha 1–2" ou "Escolha até 4". */
function slotPickLabel(min: number, max: number): string {
  if (min === max) return `Escolha ${min}`;
  if (min === 0) return `Escolha até ${max}`;
  return `Escolha ${min}–${max}`;
}

/** Observações que quase todo mundo escreve — um toque poupa a digitação no celular. */
const QUICK_NOTES = [
  'Sem cebola',
  'Sem pimenta',
  'Bem quente',
  'Capricha no molho',
  'Molho à parte',
  'Sem coentro',
];

export const ProductModal: React.FC<ProductModalProps> = ({ product, onClose }) => {
  const { addToCart } = useCart();
  const { settings, promotions } = useClientShell();
  const reduceMotion = useReducedMotion();

  const slots = product.comboSlots ?? [];
  const extrasList = product.allowedExtras ?? [];
  const [comboCounts, setComboCounts] = useState<Record<string, Record<string, number>>>({});
  const [selectedExtras, setSelectedExtras] = useState<CartItemExtra[]>([]);
  const [observation, setObservation] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [zoomed, setZoomed] = useState(false);
  const [nudged, setNudged] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const slotMin = (slot: ComboSlot) => slot.minChoices ?? (slot.required ? 1 : 0);
  const slotMax = (slot: ComboSlot) => slot.maxChoices ?? slot.minChoices ?? (slot.required ? 1 : 0);
  const chosenCount = slots.reduce((sum, slot) => sum + countSlotChoices(comboCounts[slot.id]), 0);
  const totalRequired = slots.reduce((sum, slot) => sum + slotMin(slot), 0);
  const missingSlot = slots.find((slot) => countSlotChoices(comboCounts[slot.id]) < slotMin(slot));
  const canAdd = !missingSlot;

  // Tocar numa opção sempre soma uma unidade (pode repetir o sabor); o "−" do
  // estepe tira uma. Se o bloco já está no máximo e a opção não está escolhida,
  // ela trava — igual ao seletor de antes.
  const addComboOption = (slot: ComboSlot, option: ComboSlotOption) => {
    setComboCounts((current) => {
      const slotCounts = { ...(current[slot.id] ?? {}) };
      if (countSlotChoices(slotCounts) >= slotMax(slot)) return current;
      slotCounts[option.id] = (slotCounts[option.id] ?? 0) + 1;
      return { ...current, [slot.id]: slotCounts };
    });
  };

  const removeComboOption = (slot: ComboSlot, option: ComboSlotOption) => {
    setComboCounts((current) => {
      const slotCounts = { ...(current[slot.id] ?? {}) };
      const next = (slotCounts[option.id] ?? 0) - 1;
      if (next <= 0) delete slotCounts[option.id];
      else slotCounts[option.id] = next;
      return { ...current, [slot.id]: slotCounts };
    });
  };

  const previewChoices = useMemo(
    () =>
      slots.flatMap((slot) => {
        const slotCounts = comboCounts[slot.id] ?? {};
        const out: ComboChoice[] = [];
        for (const option of slot.options) {
          const count = slotCounts[option.id] ?? 0;
          for (let i = 0; i < count; i++) {
            out.push({
              slotId: slot.id,
              slotLabel: slot.label,
              optionId: option.id,
              optionLabel: option.label,
              priceDelta: option.priceDelta ?? 0,
            });
          }
        }
        return out;
      }),
    [comboCounts, slots]
  );

  const unitPrice = computeCartItemTotal(
    { product, selectedExtras, comboChoices: previewChoices, quantity: 1 },
    settings.sizeOptions
  );
  const totalItemPrice = computeCartItemTotal(
    { product, selectedExtras, comboChoices: previewChoices, quantity },
    settings.sizeOptions
  );
  const addOnTotal = Math.round((unitPrice - product.basePrice) * 100) / 100;
  // A promoção não muda o preço da linha: ela é abatida no total do carrinho.
  // A ficha mostra o preço promocional para bater com o cartão do cardápio, e
  // a nota perto do botão explica o valor cheio que aparece nele.
  const promotion = bestProductPromotion(product, promotions);
  const promoSaving = promotion
    ? Math.round((product.basePrice - promotion.price) * quantity * 100) / 100
    : 0;
  const discountPercent =
    product.originalPrice && product.originalPrice > product.basePrice
      ? Math.round(((product.originalPrice - product.basePrice) / product.originalPrice) * 100)
      : null;

  // Esc fecha (a foto ampliada primeiro) e o cardápio atrás para de rolar.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (zoomed) setZoomed(false);
      else onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, zoomed]);

  const toggleExtra = (extra: { id: string; name: string; price: number }) =>
    setSelectedExtras((current) =>
      current.some((item) => item.id === extra.id)
        ? current.filter((item) => item.id !== extra.id)
        : [...current, extra]
    );

  const toggleNote = (note: string) =>
    setObservation((current) => {
      const parts = current.split(',').map((part) => part.trim()).filter(Boolean);
      const next = parts.includes(note) ? parts.filter((part) => part !== note) : [...parts, note];
      return next.join(', ');
    });

  /**
   * Botão desabilitado é um beco sem saída: o cliente clica, nada acontece e ele
   * não sabe o que falta. Aqui o clique leva até a escolha que falta e a destaca.
   */
  const goToMissing = useCallback(() => {
    if (!missingSlot) return;
    const node = slotRefs.current[missingSlot.id];
    node?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    setNudged(missingSlot.id);
    window.setTimeout(() => setNudged((current) => (current === missingSlot.id ? null : current)), 1200);
  }, [missingSlot, reduceMotion]);

  const handleAddToCart = () => {
    if (!canAdd) {
      goToMissing();
      return;
    }
    const added = addToCart({
      product,
      ...(slots.length > 0 ? { comboChoices: previewChoices } : {}),
      selectedExtras,
      observation,
      quantity,
    });
    if (added) onClose();
  };

  return createPortal(
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 backdrop-blur-sm p-0 md:p-6"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={product.name}
          initial={reduceMotion ? { opacity: 0 } : { y: '6%', opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { y: '6%', opacity: 0, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 380, damping: 34 }}
          className="relative bg-white text-[#1C1917] w-full md:max-w-4xl h-[94dvh] md:h-[min(86dvh,720px)] rounded-t-3xl md:rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row"
        >
          {/* ------------------------------------------------------------ foto */}
          <div className="relative shrink-0 h-56 sm:h-64 md:h-auto md:w-[42%] bg-[#F5F5F4] overflow-hidden">
            <img
              src={product.image}
              alt={product.name}
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/10 md:via-black/20" />

            <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
              {product.isFeatured && (
                <Badge className="bg-[#FEF3C7] text-[#92400E]">
                  <Flame className="w-3 h-3" /> Do dia
                </Badge>
              )}
              {product.isPopular && (
                <Badge className="bg-white text-[#1C1917]">
                  <Star className="w-3 h-3 fill-[#D97706] text-[#D97706]" /> Mais pedido
                </Badge>
              )}
              {product.isFlashPromo && (
                <Badge className="bg-[#7C3AED] text-white">
                  <Zap className="w-3 h-3" /> Flash
                </Badge>
              )}
            </div>

            <button
              type="button"
              onClick={() => setZoomed(true)}
              aria-label="Ver a foto em tela cheia"
              className="absolute top-[max(12px,env(safe-area-inset-top))] right-14 md:right-3 flex items-center gap-1.5 rounded-full bg-black/45 hover:bg-black/65 text-white px-3 py-2 text-[11px] font-bold backdrop-blur-sm transition"
            >
              <Expand className="w-3.5 h-3.5" />
              Ver foto
            </button>

            <div className="absolute bottom-0 inset-x-0 p-4 md:p-5 text-white">
              <h2 className="text-xl md:text-2xl font-extrabold leading-tight">{product.name}</h2>
              <p className="text-[11px] md:text-xs text-white/80 mt-1 line-clamp-2 md:line-clamp-3">
                {product.description}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2.5">
                <span className="text-lg font-extrabold">
                  {formatMoney(promotion ? promotion.price : product.basePrice)}
                </span>
                {promotion ? (
                  <>
                    <span className="text-xs text-white/60 line-through">
                      {formatMoney(product.basePrice)}
                    </span>
                    <span className="rounded-full bg-[#059669] px-2 py-0.5 text-[10px] font-black">
                      {promotion.promo.badge ||
                        `-${Math.round(((product.basePrice - promotion.price) / product.basePrice) * 100)}%`}
                    </span>
                  </>
                ) : (
                  discountPercent && (
                    <>
                      <span className="text-xs text-white/60 line-through">
                        {formatMoney(product.originalPrice!)}
                      </span>
                      <span className="rounded-full bg-[#059669] px-2 py-0.5 text-[10px] font-black">
                        -{discountPercent}%
                      </span>
                    </>
                  )
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-white/75 font-semibold">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />~{product.prepTimeMinutes} min
                </span>
                {product.rating > 0 && (product.reviewsCount ?? 0) > 0 && (
                  <span className="flex items-center gap-1">
                    <Star className="w-3.5 h-3.5 fill-[#FBBF24] text-[#FBBF24]" />
                    {product.rating.toFixed(1)}
                    {product.reviewsCount > 0 && ` (${product.reviewsCount})`}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* -------------------------------------------------------- conteúdo */}
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="absolute top-[max(12px,env(safe-area-inset-top))] right-3 z-20 w-11 h-11 rounded-full bg-white/90 hover:bg-white text-[#1C1917] border border-[#E7E5E4] shadow-md backdrop-blur-sm flex items-center justify-center transition"
          >
            <X className="w-4.5 h-4.5" />
          </button>

          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain scroll-slim px-4 md:px-6 py-5 space-y-6">
              {slots.length > 0 && (
                <section>
                  <SectionTitle
                    icon={<Sparkles className="w-3.5 h-3.5 text-[#D97706]" />}
                    title="Monte o seu combo"
                    trailing={
                      <span
                        className={`text-[10px] font-black px-2 py-0.5 rounded-full transition-colors ${
                          canAdd ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-[#FEF2F2] text-[#B91C1C]'
                        }`}
                      >
                        {chosenCount}/{totalRequired || slots.length}
                      </span>
                    }
                  />
                  <div className="h-1 rounded-full bg-[#F5F5F4] overflow-hidden mb-3">
                    <motion.div
                      className="h-full rounded-full bg-[#B91C1C]"
                      initial={false}
                      animate={{ width: `${Math.min(100, ((chosenCount / (totalRequired || 1)) * 100))}%` }}
                      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
                    />
                  </div>

                  <div className="space-y-4">
                    {slots.map((slot) => {
                      const slotCounts = comboCounts[slot.id] ?? {};
                      const slotChosen = countSlotChoices(slotCounts);
                      const isNudged = nudged === slot.id;
                      const min = slotMin(slot);
                      const max = slotMax(slot);
                      const done = slotChosen >= min;
                      return (
                        <motion.div
                          key={slot.id}
                          ref={(node) => {
                            slotRefs.current[slot.id] = node;
                          }}
                          animate={isNudged && !reduceMotion ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
                          transition={{ duration: 0.45 }}
                          className={`rounded-2xl transition-shadow ${
                            isNudged ? 'ring-2 ring-[#B91C1C] ring-offset-2' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="text-[11px] font-extrabold text-[#1C1917]">
                              {slot.label}
                              {min > 0 && <span className="text-[#B91C1C]"> *</span>}
                            </span>
                            <span className="text-[10px] font-bold text-[#57534E] flex items-center gap-1">
                              {slotPickLabel(min, max)}
                              <span
                                className={`ml-1 px-1.5 py-0.5 rounded-full tabular-nums ${
                                  done ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-[#F5F5F4] text-[#A8A29E]'
                                }`}
                              >
                                {slotChosen}/{max}
                              </span>
                            </span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {slot.options.map((option) => {
                              const count = slotCounts[option.id] ?? 0;
                              const isSelected = count > 0;
                              const locked = !isSelected && slotChosen >= max;
                              const plusDisabled = slotChosen >= max;
                              return (
                                <div
                                  key={option.id}
                                  role="button"
                                  tabIndex={locked ? -1 : 0}
                                  aria-pressed={isSelected}
                                  aria-label={option.label}
                                  onClick={() => {
                                    if (!locked) addComboOption(slot, option);
                                  }}
                                  onKeyDown={(event) => {
                                    if (locked) return;
                                    if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault();
                                      addComboOption(slot, option);
                                    }
                                  }}
                                  className={`p-3 rounded-2xl border text-left transition flex items-center justify-between gap-2 cursor-pointer select-none active:scale-[0.98] ${
                                    isSelected
                                      ? 'bg-[#FEF2F2] border-[#B91C1C] shadow-sm'
                                      : locked
                                      ? 'bg-[#FAFAF9] border-[#E7E5E4] opacity-40 cursor-default'
                                      : 'bg-[#FAFAF9] border-[#E7E5E4] hover:bg-[#F5F5F4]'
                                  }`}
                                >
                                  {/* Sem `min-w-0` o `truncate` não vale nada num
                                      filho de flex: "Caldinho de camarão com
                                      queijo coalho" empurrava o preço para fora
                                      do cartão. */}
                                  <span className="min-w-0 truncate text-xs font-bold text-[#1C1917]">
                                    {option.label}
                                  </span>
                                  <span className="flex items-center gap-2 shrink-0">
                                    {option.priceDelta != null && option.priceDelta > 0 && (
                                      <span className="text-[10px] font-extrabold text-[#B91C1C]">
                                        +{formatMoney(option.priceDelta)}
                                      </span>
                                    )}
                                    {isSelected ? (
                                      <span className="flex items-center gap-1 pointer-coarse:gap-1.5">
                                        <button
                                          type="button"
                                          aria-label={`Remover um ${option.label}`}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            removeComboOption(slot, option);
                                          }}
                                          className="w-7 h-7 rounded-full border border-[#D6D3D1] bg-white text-[#57534E] hover:bg-[#F5F5F4] transition flex items-center justify-center"
                                        >
                                          <Minus className="w-3.5 h-3.5" />
                                        </button>
                                        <span className="min-w-[2ch] text-center text-xs font-black text-[#B91C1C] tabular-nums">
                                          {count}×
                                        </span>
                                        <button
                                          type="button"
                                          aria-label={`Adicionar mais um ${option.label}`}
                                          disabled={plusDisabled}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            addComboOption(slot, option);
                                          }}
                                          className="w-7 h-7 rounded-full border border-[#D6D3D1] bg-white text-[#1C1917] hover:bg-[#F5F5F4] transition flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                                        >
                                          <Plus className="w-3.5 h-3.5" />
                                        </button>
                                      </span>
                                    ) : (
                                      <span
                                        className={`w-5 h-5 rounded-full flex items-center justify-center transition ${
                                          isSelected
                                            ? 'bg-[#B91C1C] text-white'
                                            : 'bg-white border border-[#E7E5E4]'
                                        }`}
                                      >
                                        {isSelected && <Check className="w-3 h-3" strokeWidth={3} />}
                                      </span>
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </section>
              )}

              {extrasList.length > 0 && (
                <section>
                  <SectionTitle
                    title="Adicionais"
                    subtitle="Opcional"
                    trailing={
                      selectedExtras.length > 0 ? (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#FEF2F2] text-[#B91C1C]">
                          {selectedExtras.length} · +{formatMoney(
                            selectedExtras.reduce((sum, extra) => sum + extra.price, 0)
                          )}
                        </span>
                      ) : null
                    }
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {extrasList.map((extra) => {
                      const isChecked = selectedExtras.some((item) => item.id === extra.id);
                      return (
                        <button
                          key={extra.id}
                          type="button"
                          aria-pressed={isChecked}
                          onClick={() => toggleExtra(extra)}
                          className={`p-3 rounded-2xl border transition flex items-center justify-between gap-2 text-left active:scale-[0.98] ${
                            isChecked
                              ? 'bg-[#FEF2F2] border-[#B91C1C] shadow-sm'
                              : 'bg-[#FAFAF9] border-[#E7E5E4] hover:bg-[#F5F5F4]'
                          }`}
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <span
                              className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition ${
                                isChecked
                                  ? 'bg-[#B91C1C] border-[#B91C1C] text-white'
                                  : 'border-[#A8A29E] bg-white'
                              }`}
                            >
                              {isChecked && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                            </span>
                            <span className="text-xs font-bold text-[#1C1917] truncate">{extra.name}</span>
                          </span>
                          <span className="text-xs font-extrabold text-[#B91C1C] shrink-0">
                            +{formatMoney(extra.price)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              <section>
                <SectionTitle title="Observações" subtitle="Opcional" />
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {QUICK_NOTES.map((note) => {
                    const active = observation
                      .split(',')
                      .map((part) => part.trim())
                      .includes(note);
                    return (
                      <button
                        key={note}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleNote(note)}
                        className={`rounded-full px-3 py-1.5 text-[11px] font-bold border transition active:scale-95 ${
                          active
                            ? 'bg-[#1C1917] text-white border-[#1C1917]'
                            : 'bg-white text-[#57534E] border-[#E7E5E4] hover:bg-[#F5F5F4]'
                        }`}
                      >
                        {note}
                      </button>
                    );
                  })}
                </div>
                <textarea
                  value={observation}
                  onChange={(event) => setObservation(event.target.value)}
                  maxLength={200}
                  placeholder="Ex.: capricha no cheiro verde, maionese à parte"
                  className="w-full bg-[#FAFAF9] border border-[#E7E5E4] rounded-2xl p-3 text-xs text-[#1C1917] placeholder-[#A8A29E] focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/40 focus:border-[#B91C1C] resize-none h-20"
                />
                <p className="text-right text-[10px] text-[#A8A29E] mt-1 tabular-nums">
                  {observation.length}/200
                </p>
              </section>
            </div>

            {/* ---------------------------------------------------------- rodapé */}
            <div className="shrink-0 border-t border-[#E7E5E4] bg-white px-4 md:px-6 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)] space-y-2.5">
              <AnimatePresence>
                {!canAdd && (
                  <motion.button
                    type="button"
                    onClick={goToMissing}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="w-full flex items-center gap-2 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] px-3 py-2 text-[11px] font-bold text-[#92400E] text-left"
                  >
                    <ArrowDown className="w-3.5 h-3.5 shrink-0" />
                    Falta escolher “{missingSlot?.label}”. Toque para ir até lá.
                  </motion.button>
                )}
              </AnimatePresence>

              {promotion && promoSaving > 0 && (
                <p className="rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] px-3 py-2 text-[11px] font-bold text-[#047857]">
                  {promotion.promo.name}: −{formatMoney(promoSaving)} descontado no carrinho.
                </p>
              )}

              {addOnTotal > 0 && (
                <div className="flex items-center justify-between text-[11px] text-[#57534E]">
                  <span>
                    {formatMoney(product.basePrice)} + {formatMoney(addOnTotal)} em adicionais
                  </span>
                  <span className="font-bold text-[#1C1917]">{formatMoney(unitPrice)} cada</span>
                </div>
              )}

              <div className="flex items-center gap-3">
                {/* 32 px por botão, colados: no dedo, "3 unidades" vira "1". O
                    `::before` invisível leva cada alvo a 44 px sem engordar a
                    pílula nem o rodapé, que já divide a linha com o botão de
                    adicionar. */}
                <div className="flex items-center bg-[#F5F5F4] rounded-full border border-[#E7E5E4] p-1 shrink-0">
                  <button
                    onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                    disabled={quantity <= 1}
                    aria-label="Diminuir quantidade"
                    className="relative p-2 hover:bg-[#E7E5E4] rounded-full text-[#1C1917] transition disabled:opacity-30 before:absolute before:-inset-1.5 before:content-['']"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="px-3 text-sm font-black text-[#1C1917] tabular-nums min-w-[2ch] text-center">
                    {quantity}
                  </span>
                  <button
                    onClick={() => setQuantity((current) => current + 1)}
                    aria-label="Aumentar quantidade"
                    className="relative p-2 hover:bg-[#E7E5E4] rounded-full text-[#1C1917] transition before:absolute before:-inset-1.5 before:content-['']"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                <button
                  onClick={handleAddToCart}
                  aria-disabled={!canAdd}
                  className={`flex-1 font-extrabold py-3.5 px-5 rounded-full shadow-md flex items-center justify-between gap-2 transition active:scale-[0.98] ${
                    canAdd
                      ? 'bg-[#B91C1C] hover:bg-[#991B1B] text-white'
                      : 'bg-[#F5F5F4] text-[#A8A29E] border border-[#E7E5E4]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4" />
                    <span className="text-xs">
                      {canAdd ? 'Adicionar ao carrinho' : 'Escolha o que falta'}
                    </span>
                  </span>
                  <span className="text-sm font-extrabold tabular-nums">{formatMoney(totalItemPrice)}</span>
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>

      <AnimatePresence>
        {zoomed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            role="dialog"
            aria-modal="true"
            aria-label={`Foto de ${product.name}. Toque para fechar.`}
            className="fixed inset-0 z-[60] flex h-dscreen cursor-zoom-out flex-col bg-black/95"
            onClick={() => setZoomed(false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setZoomed(false);
            }}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3 pt-safe text-white">
              <p className="truncate pt-3 text-sm font-extrabold">{product.name}</p>
              <button
                type="button"
                onClick={() => setZoomed(false)}
                aria-label="Fechar a foto"
                className="mt-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <motion.img
              src={product.image}
              alt=""
              initial={reduceMotion ? false : { scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="min-h-0 w-full flex-1 object-contain px-4 pb-2"
            />
            <p className="shrink-0 pb-safe px-4 pt-1 text-center text-[11px] font-bold text-white/70">
              Toque em qualquer lugar para fechar
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body
  );
};

const Badge: React.FC<{ className: string; children: React.ReactNode }> = ({ className, children }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black shadow-sm ${className}`}
  >
    {children}
  </span>
);

const SectionTitle: React.FC<{
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
}> = ({ title, subtitle, icon, trailing }) => (
  <div className="flex items-center justify-between gap-2 mb-2.5">
    <h3 className="flex items-center gap-1.5 text-xs font-black text-[#1C1917] uppercase tracking-wider">
      {icon}
      {title}
      {subtitle && (
        <span className="text-[10px] font-bold text-[#A8A29E] normal-case tracking-normal">
          · {subtitle}
        </span>
      )}
    </h3>
    {trailing}
  </div>
);
