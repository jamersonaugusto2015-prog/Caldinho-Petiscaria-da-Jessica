import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Flame,
  ImageIcon,
  Layers,
  Link2,
  Loader2,
  PlusCircle,
  Star,
  Trash2,
  UploadCloud,
  X,
  Zap,
} from 'lucide-react';
import type { Category, ComboSlot, ExtraOption, Product } from '../../types';
import { ACCEPTED_IMAGE_TYPES, resizeImage, validateImageFile } from '../../lib/image';
import { useKitchenUpload } from './useKitchenUpload';

export const PRODUCT_IMAGE_FALLBACK =
  'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&q=80&w=800';

type Draft = {
  id: string;
  name: string;
  description: string;
  category: string;
  basePrice: string;
  image: string;
  prepTimeMinutes: string;
  available: boolean;
  isPopular: boolean;
  isFlashPromo: boolean;
  originalPrice: string;
};

function toDraft(original: Product | null, categories: Category[]): Draft {
  return {
    id: original?.id || `prod-${Date.now()}`,
    name: original?.name || '',
    description: original?.description || '',
    category: original?.category || categories[0]?.id || 'caldinhos',
    basePrice: original ? String(original.basePrice) : '',
    image: original?.image || '',
    prepTimeMinutes: String(original?.prepTimeMinutes || 15),
    available: original?.available ?? true,
    isPopular: original?.isPopular ?? false,
    isFlashPromo: original?.isFlashPromo ?? false,
    originalPrice: original?.originalPrice ? String(original.originalPrice) : '',
  };
}

interface Props {
  value: Product | 'new';
  categories: Category[];
  onClose: () => void;
  onSave: (product: Product) => Promise<void>;
}

export const KitchenProductEditor: React.FC<Props> = ({ value, categories, onClose, onSave }) => {
  const original = value === 'new' ? null : value;
  const uploadImage = useKitchenUpload();

  const [form, setForm] = useState<Draft>(() => toDraft(original, categories));
  const [extras, setExtras] = useState<ExtraOption[]>(() =>
    original?.allowedExtras ? original.allowedExtras.map((extra) => ({ ...extra })) : []
  );
  const [comboSlots, setComboSlots] = useState<ComboSlot[]>(() =>
    original?.comboSlots
      ? original.comboSlots.map((slot) => ({ ...slot, options: slot.options.map((option) => ({ ...option })) }))
      : []
  );
  const [errors, setErrors] = useState<Partial<Record<'name' | 'basePrice', string>>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const patch = useCallback((changes: Partial<Draft>) => setForm((current) => ({ ...current, ...changes })), []);

  // Esc fecha e o fundo para de rolar: sem isso a página de trás rola junto com o modal.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    nameInputRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const handleFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      const invalid = validateImageFile(file);
      if (invalid) {
        setUploadError(invalid);
        return;
      }
      setUploadError(null);
      setUploading(true);
      try {
        const dataUrl = await resizeImage(file);
        const url = await uploadImage(dataUrl, `produto-${form.id}`);
        if (url) patch({ image: url });
        else setUploadError('Não foi possível enviar a imagem. Tente de novo.');
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Falha ao processar a imagem.');
      } finally {
        setUploading(false);
      }
    },
    [form.id, patch, uploadImage]
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const price = Number(form.basePrice);
    const nextErrors: typeof errors = {};
    if (!form.name.trim()) nextErrors.name = 'Dê um nome ao produto.';
    if (!form.basePrice.trim() || !Number.isFinite(price) || price < 0)
      nextErrors.basePrice = 'Informe um preço válido.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      await onSave({
        ...(original || { rating: 0, reviewsCount: 0 }),
        ...form,
        name: form.name.trim(),
        description: form.description.trim(),
        basePrice: price,
        prepTimeMinutes: Number(form.prepTimeMinutes) || 15,
        originalPrice: form.originalPrice ? Number(form.originalPrice) : undefined,
        image: form.image.trim() || PRODUCT_IMAGE_FALLBACK,
        allowedExtras: extras
          .filter((extra) => extra.name.trim())
          .map((extra) => ({ ...extra, name: extra.name.trim() })),
        comboSlots: comboSlots
          .filter((slot) => slot.label.trim())
          .map((slot) => ({
            ...slot,
            label: slot.label.trim(),
            options: slot.options
              .filter((option) => option.label.trim())
              .map((option) => ({ ...option, label: option.label.trim() })),
          })),
      });
    } finally {
      setSaving(false);
    }
  };

  const preview = form.image.trim() || PRODUCT_IMAGE_FALLBACK;
  const usingFallback = !form.image.trim();
  const priceNumber = Number(form.basePrice);
  const originalNumber = Number(form.originalPrice);
  const discount =
    form.isFlashPromo && originalNumber > 0 && priceNumber > 0 && originalNumber > priceNumber
      ? Math.round(((originalNumber - priceNumber) / originalNumber) * 100)
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-[2px] p-0 sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="bg-white w-full sm:max-w-3xl max-h-[100dvh] sm:max-h-[92vh] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
      >
        <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#E7E5E4] bg-white">
          <div className="min-w-0">
            <h3 className="text-lg font-extrabold text-[#1C1917] truncate">
              {original ? 'Editar produto' : 'Novo produto'}
            </h3>
            <p className="text-xs text-[#57534E]">
              {original ? original.name : 'Preencha os dados e salve para publicar no cardápio.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 w-9 h-9 rounded-full border border-[#E7E5E4] text-[#57534E] hover:bg-[#F5F5F4] flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          <Section icon={<ImageIcon className="w-4 h-4" />} title="Imagem do produto">
            <div className="grid grid-cols-1 sm:grid-cols-[168px_1fr] gap-4">
              <div className="relative rounded-2xl overflow-hidden border border-[#E7E5E4] bg-[#F5F5F4] aspect-square">
                <img
                  src={preview}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={(event) => {
                    (event.currentTarget as HTMLImageElement).src = PRODUCT_IMAGE_FALLBACK;
                  }}
                />
                {usingFallback && (
                  <span className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] font-bold text-center py-1">
                    Imagem padrão
                  </span>
                )}
                {uploading && (
                  <span className="absolute inset-0 bg-white/80 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-[#B91C1C] animate-spin" />
                  </span>
                )}
              </div>

              <div className="space-y-3">
                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    void handleFile(event.dataTransfer.files?.[0]);
                  }}
                  className={`rounded-2xl border-2 border-dashed p-4 text-center transition ${
                    dragging ? 'border-[#B91C1C] bg-[#FEF2F2]' : 'border-[#E7E5E4] bg-[#FAFAF9]'
                  }`}
                >
                  <UploadCloud className="w-7 h-7 mx-auto text-[#B91C1C]" />
                  <p className="text-xs font-bold text-[#1C1917] mt-1.5">Arraste uma foto aqui</p>
                  <p className="text-[11px] text-[#57534E]">PNG, JPG, WEBP ou GIF · até 15 MB</p>
                  <button
                    type="button"
                    className="btn-primary mt-2.5"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                    {uploading ? 'Enviando...' : 'Escolher do computador'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_IMAGE_TYPES}
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      void handleFile(file);
                    }}
                  />
                </div>

                <label className="block">
                  <span className="text-[11px] font-bold text-[#57534E] flex items-center gap-1 mb-1">
                    <Link2 className="w-3 h-3" />
                    ...ou cole o endereço de uma imagem
                  </span>
                  <div className="flex gap-2">
                    <input
                      className="input"
                      placeholder="https://..."
                      value={form.image}
                      onChange={(event) => patch({ image: event.target.value })}
                    />
                    {form.image.trim() !== '' && (
                      <button
                        type="button"
                        className="btn-secondary shrink-0"
                        onClick={() => patch({ image: '' })}
                      >
                        Limpar
                      </button>
                    )}
                  </div>
                </label>

                {uploadError && (
                  <p className="text-[11px] text-[#B91C1C] font-bold flex items-start gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                    {uploadError}
                  </p>
                )}
              </div>
            </div>
          </Section>

          <Section icon={<Check className="w-4 h-4" />} title="Dados do produto">
            <div className="space-y-3">
              <Field label="Nome" required error={errors.name}>
                <input
                  ref={nameInputRef}
                  className="input"
                  placeholder="Ex.: Caldinho de Feijão Preto"
                  value={form.name}
                  onChange={(event) => {
                    patch({ name: event.target.value });
                    if (errors.name) setErrors((current) => ({ ...current, name: undefined }));
                  }}
                />
              </Field>

              <Field label="Descrição" hint="Aparece para o cliente no cardápio.">
                <textarea
                  className="input min-h-20 resize-y"
                  placeholder="Feijão preto cremoso, bacon e cheiro-verde."
                  value={form.description}
                  onChange={(event) => patch({ description: event.target.value })}
                />
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Categoria">
                  <select
                    className="input"
                    value={form.category}
                    onChange={(event) => patch({ category: event.target.value })}
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.emoji} {category.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Preço (R$)" required error={errors.basePrice}>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={form.basePrice}
                    onChange={(event) => {
                      patch({ basePrice: event.target.value });
                      if (errors.basePrice) setErrors((current) => ({ ...current, basePrice: undefined }));
                    }}
                  />
                </Field>

                <Field label="Preparo (min)">
                  <input
                    className="input"
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={form.prepTimeMinutes}
                    onChange={(event) => patch({ prepTimeMinutes: event.target.value })}
                  />
                </Field>
              </div>
            </div>
          </Section>

          <Section icon={<Star className="w-4 h-4" />} title="Destaques na loja">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Toggle
                checked={form.available}
                onChange={(checked) => patch({ available: checked })}
                label="Disponível"
                hint="Cliente pode pedir"
              />
              <Toggle
                icon={<Star className="w-3.5 h-3.5" />}
                checked={form.isPopular}
                onChange={(checked) => patch({ isPopular: checked })}
                label="Popular"
                hint="Selo de mais pedido"
              />
              <Toggle
                icon={<Zap className="w-3.5 h-3.5" />}
                checked={form.isFlashPromo}
                onChange={(checked) => patch({ isFlashPromo: checked })}
                label="Promoção flash"
                hint="Mostra preço antigo"
              />
            </div>

            {form.isFlashPromo && (
              <div className="mt-3 rounded-2xl bg-[#FFFBEB] border border-[#FDE68A] p-3">
                <Field
                  label="Preço original (R$)"
                  hint="O preço riscado que aparece ao lado da promoção."
                >
                  <input
                    className="input bg-white"
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={form.originalPrice}
                    onChange={(event) => patch({ originalPrice: event.target.value })}
                  />
                </Field>
                {discount !== null && (
                  <p className="text-[11px] font-bold text-[#B45309] mt-1.5 flex items-center gap-1">
                    <Flame className="w-3.5 h-3.5" />
                    Desconto de {discount}% para o cliente.
                  </p>
                )}
              </div>
            )}
          </Section>

          <Section
            icon={<PlusCircle className="w-4 h-4" />}
            title="Adicionais"
            subtitle="Itens opcionais que o cliente soma ao pedido."
          >
            <div className="space-y-2">
              {extras.map((extra, index) => (
                <div key={extra.id} className="flex gap-2 items-start">
                  <input
                    className="input flex-1"
                    placeholder="Nome do adicional"
                    value={extra.name}
                    onChange={(event) =>
                      setExtras((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, name: event.target.value } : item
                        )
                      )
                    }
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs text-[#57534E]">R$</span>
                    <input
                      className="input w-24"
                      type="number"
                      step="0.01"
                      min="0"
                      inputMode="decimal"
                      value={extra.price}
                      onChange={(event) =>
                        setExtras((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, price: Number(event.target.value) || 0 } : item
                          )
                        )
                      }
                    />
                  </div>
                  <button
                    type="button"
                    aria-label="Remover adicional"
                    className="btn-danger p-2 shrink-0"
                    onClick={() => setExtras((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {extras.length === 0 && <EmptyHint text="Nenhum adicional. O produto vai sozinho." />}
              <button
                type="button"
                className="btn-secondary w-full sm:w-auto"
                onClick={() =>
                  setExtras((current) => [...current, { id: `extra-${Date.now()}`, name: '', price: 0 }])
                }
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Adicionar adicional
              </button>
            </div>
          </Section>

          <Section
            icon={<Layers className="w-4 h-4" />}
            title="Escolhas do combo"
            subtitle="Só para combos: o cliente escolhe uma opção em cada bloco."
          >
            <div className="space-y-3">
              {comboSlots.map((slot, slotIndex) => (
                <div key={slot.id} className="rounded-2xl border border-[#E7E5E4] bg-[#FAFAF9] p-3 space-y-2">
                  <div className="flex gap-2">
                    <input
                      className="input flex-1 bg-white"
                      placeholder="Ex.: 1º Caldinho"
                      value={slot.label}
                      onChange={(event) =>
                        setComboSlots((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === slotIndex ? { ...item, label: event.target.value } : item
                          )
                        )
                      }
                    />
                    <button
                      type="button"
                      aria-label="Remover escolha"
                      className="btn-danger p-2 shrink-0"
                      onClick={() =>
                        setComboSlots((current) => current.filter((_, itemIndex) => itemIndex !== slotIndex))
                      }
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {slot.options.map((option, optionIndex) => (
                    <div key={option.id} className="flex gap-2 sm:pl-4">
                      <input
                        className="input flex-1 bg-white"
                        placeholder="Opção"
                        value={option.label}
                        onChange={(event) =>
                          setComboSlots((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex !== slotIndex
                                ? item
                                : {
                                    ...item,
                                    options: item.options.map((choice, choiceIndex) =>
                                      choiceIndex === optionIndex
                                        ? { ...choice, label: event.target.value }
                                        : choice
                                    ),
                                  }
                            )
                          )
                        }
                      />
                      <input
                        className="input w-24 bg-white shrink-0"
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        aria-label="Acréscimo"
                        value={option.priceDelta || 0}
                        onChange={(event) =>
                          setComboSlots((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex !== slotIndex
                                ? item
                                : {
                                    ...item,
                                    options: item.options.map((choice, choiceIndex) =>
                                      choiceIndex === optionIndex
                                        ? { ...choice, priceDelta: Number(event.target.value) || 0 }
                                        : choice
                                    ),
                                  }
                            )
                          )
                        }
                      />
                      <button
                        type="button"
                        aria-label="Remover opção"
                        className="btn-danger p-2 shrink-0"
                        onClick={() =>
                          setComboSlots((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex !== slotIndex
                                ? item
                                : {
                                    ...item,
                                    options: item.options.filter((_, choiceIndex) => choiceIndex !== optionIndex),
                                  }
                            )
                          )
                        }
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    className="btn-secondary sm:ml-4"
                    onClick={() =>
                      setComboSlots((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === slotIndex
                            ? {
                                ...item,
                                options: [
                                  ...item.options,
                                  { id: `option-${Date.now()}`, label: '', priceDelta: 0 },
                                ],
                              }
                            : item
                        )
                      )
                    }
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    Adicionar opção
                  </button>
                </div>
              ))}
              {comboSlots.length === 0 && <EmptyHint text="Este produto não é um combo." />}
              <button
                type="button"
                className="btn-secondary w-full sm:w-auto"
                onClick={() =>
                  setComboSlots((current) => [
                    ...current,
                    { id: `slot-${Date.now()}`, label: `Escolha ${current.length + 1}`, required: true, options: [] },
                  ])
                }
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Adicionar escolha
              </button>
            </div>
          </Section>
        </div>

        <footer className="flex gap-2 px-5 py-4 border-t border-[#E7E5E4] bg-white">
          <button type="button" className="btn-secondary flex-1 py-3" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary flex-1 py-3" disabled={saving || uploading}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saving ? 'Salvando...' : original ? 'Salvar alterações' : 'Criar produto'}
          </button>
        </footer>
      </form>
    </div>
  );
};

const Section: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ icon, title, subtitle, children }) => (
  <section>
    <div className="flex items-center gap-2 mb-2.5">
      <span className="w-7 h-7 rounded-xl bg-[#FEF2F2] text-[#B91C1C] flex items-center justify-center shrink-0">
        {icon}
      </span>
      <div className="min-w-0">
        <h4 className="text-sm font-extrabold text-[#1C1917] leading-tight">{title}</h4>
        {subtitle && <p className="text-[11px] text-[#57534E] leading-tight">{subtitle}</p>}
      </div>
    </div>
    {children}
  </section>
);

const Field: React.FC<{
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}> = ({ label, hint, required, error, children }) => (
  <label className="block">
    <span className="text-[11px] font-bold text-[#57534E] block mb-1">
      {label}
      {required && <span className="text-[#B91C1C]"> *</span>}
    </span>
    {children}
    {error ? (
      <span className="text-[11px] text-[#B91C1C] font-bold flex items-center gap-1 mt-1">
        <AlertCircle className="w-3 h-3" />
        {error}
      </span>
    ) : (
      hint && <span className="text-[11px] text-[#A8A29E] block mt-1">{hint}</span>
    )}
  </label>
);

const Toggle: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
  icon?: React.ReactNode;
}> = ({ checked, onChange, label, hint, icon }) => (
  <label
    className={`flex items-start gap-2 rounded-2xl border p-3 cursor-pointer transition ${
      checked ? 'border-[#B91C1C] bg-[#FEF2F2]' : 'border-[#E7E5E4] bg-white hover:bg-[#FAFAF9]'
    }`}
  >
    <input
      type="checkbox"
      className="mt-0.5 w-4 h-4 accent-[#B91C1C] shrink-0"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span className="min-w-0">
      <span className="text-xs font-extrabold text-[#1C1917] flex items-center gap-1">
        {icon}
        {label}
      </span>
      <span className="text-[11px] text-[#57534E] block leading-tight">{hint}</span>
    </span>
  </label>
);

const EmptyHint: React.FC<{ text: string }> = ({ text }) => (
  <p className="text-[11px] text-[#A8A29E] italic py-1">{text}</p>
);
