import React, { useMemo, useState } from 'react';
import { AlertTriangle, Bike, Check, Gift, Layers, Percent, ShoppingBag, Store, Truck, X } from 'lucide-react';
import type { Category, Product, Promotion, PromotionKind, PromotionScope } from '../../types';
import { PROMOTION_KIND_LABELS, WEEKDAY_LABELS, describeWindow } from '../../shared/promotions';
import { Field, FieldGrid, FieldNote, INPUT_CLASS, NumberField, SwitchGroup, SwitchRow } from './KitchenSettingsUI';
import { PROMOTION_PRESETS, marginReport } from './kitchenPromotionDraft';

const money = (value: number) => `R$ ${value.toFixed(2)}`;

const KIND_ICONS: Record<PromotionKind, React.ReactNode> = {
  desconto: <Percent className="w-4 h-4" />,
  leve_pague: <Layers className="w-4 h-4" />,
  brinde: <Gift className="w-4 h-4" />,
  frete: <Truck className="w-4 h-4" />,
};

const KIND_HINTS: Record<PromotionKind, string> = {
  desconto: 'Baixa o preço de produtos ou categorias escolhidas.',
  leve_pague: 'A partir de N unidades, algumas saem sem custo.',
  brinde: 'Acima de um valor, um produto vai junto de graça.',
  frete: 'Zera ou abate a taxa de entrega.',
};

type PriceMode = 'percent' | 'fixed' | 'price';

function priceModeOf(promo: Promotion): PriceMode {
  if (promo.fixedPrice) return 'price';
  if (promo.discountFixed) return 'fixed';
  return 'percent';
}

interface Props {
  value: Promotion | 'new';
  products: Product[];
  categories: Category[];
  onClose: () => void;
  onSave: (promo: Promotion) => Promise<boolean>;
}

export const KitchenPromotionEditor: React.FC<Props> = ({ value, products, categories, onClose, onSave }) => {
  const isNew = value === 'new';
  const [form, setForm] = useState<Promotion>(() =>
    isNew ? PROMOTION_PRESETS[0].build() : { ...(value as Promotion) }
  );
  const [priceMode, setPriceMode] = useState<PriceMode>(() =>
    isNew ? 'percent' : priceModeOf(value as Promotion)
  );
  const [saving, setSaving] = useState(false);

  const patch = (next: Partial<Promotion>) => setForm((prev) => ({ ...prev, ...next }));
  const patchWindow = (next: Partial<Promotion['window']>) =>
    setForm((prev) => ({ ...prev, window: { ...prev.window, ...next } }));

  /** Trocar de tipo limpa os campos do tipo antigo: eles não fazem sentido no novo. */
  const changeKind = (kind: PromotionKind) => {
    setForm((prev) => ({
      ...prev,
      kind,
      scope: kind === 'frete' || kind === 'brinde' ? 'todos' : prev.scope === 'todos' ? 'produtos' : prev.scope,
      channel: kind === 'frete' ? 'delivery' : prev.channel,
      discountPercent: kind === 'desconto' ? prev.discountPercent ?? 15 : undefined,
      discountFixed: kind === 'desconto' ? prev.discountFixed : undefined,
      fixedPrice: kind === 'desconto' ? prev.fixedPrice : undefined,
      buyQty: kind === 'leve_pague' ? prev.buyQty ?? 3 : undefined,
      payQty: kind === 'leve_pague' ? prev.payQty ?? 2 : undefined,
      giftProductId: kind === 'brinde' ? prev.giftProductId : undefined,
      deliveryFree: kind === 'frete' ? prev.deliveryFree ?? true : undefined,
      deliveryDiscount: kind === 'frete' ? prev.deliveryDiscount : undefined,
    }));
    if (kind === 'desconto') setPriceMode(priceModeOf(form));
  };

  const setPrice = (mode: PriceMode, amount: number) => {
    setPriceMode(mode);
    patch({
      discountPercent: mode === 'percent' ? amount : undefined,
      discountFixed: mode === 'fixed' ? amount : undefined,
      fixedPrice: mode === 'price' ? amount : undefined,
    });
  };

  const report = useMemo(() => marginReport(form, products), [form, products]);

  const toggleId = (list: string[], id: string) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    const ok = await onSave(form);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-[2px] p-0 sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        /* Um campo de hora apagado pela metade fica "inválido" para o navegador e
           trava o submit sem dizer nada. Quem valida a promoção é o servidor. */
        noValidate
        className="bg-white w-full sm:max-w-3xl max-h-[100dvh] sm:max-h-[92vh] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
      >
        <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#E7E5E4]">
          <div className="min-w-0">
            <h3 className="text-lg font-extrabold text-[#1C1917] truncate">
              {isNew ? 'Nova promoção' : 'Editar promoção'}
            </h3>
            <p className="text-xs text-[#57534E]">
              {isNew ? 'Comece por um modelo pronto e ajuste o que precisar.' : form.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 w-9 h-9 rounded-full border border-[#E7E5E4] text-[#57534E] hover:bg-[#F5F5F4] flex items-center justify-center transition pointer-coarse:w-11 pointer-coarse:h-11"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {isNew && (
            <Block title="Modelos prontos" hint="Um clique preenche a promoção inteira. Depois é só ajustar.">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(220px,100%),1fr))] gap-2">
                {PROMOTION_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      const built = preset.build();
                      setForm(built);
                      setPriceMode(priceModeOf(built));
                    }}
                    className="text-left rounded-xl border border-[#E7E5E4] bg-[#FAFAF9] p-3 hover:border-[#B91C1C] hover:bg-white transition"
                  >
                    <span className="text-sm font-extrabold text-[#1C1917]">
                      {preset.emoji} {preset.title}
                    </span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-[#78716C]">{preset.hint}</span>
                  </button>
                ))}
              </div>
            </Block>
          )}

          <Block title="Tipo de promoção">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {(Object.keys(PROMOTION_KIND_LABELS) as PromotionKind[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => changeKind(kind)}
                  aria-pressed={form.kind === kind}
                  className={`rounded-xl border p-3 text-left transition ${
                    form.kind === kind
                      ? 'border-[#B91C1C] bg-[#FEF2F2] text-[#B91C1C]'
                      : 'border-[#E7E5E4] bg-white text-[#57534E] hover:bg-[#FAFAF9]'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-xs font-extrabold">
                    {KIND_ICONS[kind]}
                    {PROMOTION_KIND_LABELS[kind]}
                  </span>
                  <span className="mt-1 block text-[11px] leading-snug text-[#78716C]">{KIND_HINTS[kind]}</span>
                </button>
              ))}
            </div>
          </Block>

          <Block title="Identificação">
            <FieldGrid>
              <Field
                label="Nome da promoção"
                value={form.name}
                onChange={(name) => patch({ name })}
                placeholder="Ex.: Happy hour de quinta"
                hint="Aparece no carrinho do cliente e no relatório."
              />
              <Field
                label="Selo no cardápio (opcional)"
                value={form.badge ?? ''}
                onChange={(badge) => patch({ badge })}
                placeholder="Ex.: HAPPY HOUR"
                hint="Texto curto na etiqueta da foto do produto."
              />
            </FieldGrid>
          </Block>

          <Block title="A regra">
            {form.kind === 'desconto' && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  <ModeChip active={priceMode === 'percent'} onClick={() => setPrice('percent', form.discountPercent || 10)}>
                    Porcentagem
                  </ModeChip>
                  <ModeChip active={priceMode === 'fixed'} onClick={() => setPrice('fixed', form.discountFixed || 5)}>
                    Valor em reais
                  </ModeChip>
                  <ModeChip active={priceMode === 'price'} onClick={() => setPrice('price', form.fixedPrice || 19.9)}>
                    Por apenas
                  </ModeChip>
                </div>
                <FieldGrid>
                  {priceMode === 'percent' && (
                    <NumberField
                      label="Desconto"
                      value={form.discountPercent ?? 0}
                      onChange={(amount) => setPrice('percent', amount)}
                      suffix="%"
                      hint="Tirado do preço de cada item alcançado."
                    />
                  )}
                  {priceMode === 'fixed' && (
                    <NumberField
                      label="Desconto por unidade"
                      value={form.discountFixed ?? 0}
                      onChange={(amount) => setPrice('fixed', amount)}
                      prefix="R$"
                    />
                  )}
                  {priceMode === 'price' && (
                    <NumberField
                      label="Preço promocional"
                      value={form.fixedPrice ?? 0}
                      onChange={(amount) => setPrice('price', amount)}
                      prefix="R$"
                      hint="Itens mais baratos que isso não sobem de preço."
                    />
                  )}
                </FieldGrid>
              </div>
            )}

            {form.kind === 'leve_pague' && (
              <FieldGrid>
                <NumberField
                  label="O cliente leva"
                  value={form.buyQty ?? 3}
                  onChange={(buyQty) => patch({ buyQty: Math.max(2, Math.round(buyQty)) })}
                  suffix="un."
                  min={2}
                />
                <NumberField
                  label="E paga"
                  value={form.payQty ?? 2}
                  onChange={(payQty) => patch({ payQty: Math.max(1, Math.round(payQty)) })}
                  suffix="un."
                  min={1}
                  hint="As unidades grátis saem sempre das mais baratas do carrinho."
                />
              </FieldGrid>
            )}

            {form.kind === 'brinde' && (
              <div className="space-y-3">
                <label className="block text-xs font-bold text-[#44403C]">Produto que vai de brinde</label>
                <select
                  className={INPUT_CLASS}
                  value={form.giftProductId ?? ''}
                  onChange={(event) => patch({ giftProductId: event.target.value })}
                >
                  <option value="">Escolha um produto…</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} — {money(product.basePrice)}
                    </option>
                  ))}
                </select>
                <FieldNote>
                  O brinde entra como desconto do valor do produto. Combine com um pedido mínimo abaixo.
                </FieldNote>
              </div>
            )}

            {form.kind === 'frete' && (
              <div className="space-y-3">
                <SwitchGroup>
                  <SwitchRow
                    label="Frete grátis"
                    description="Zera a taxa de entrega quando a regra bate."
                    checked={form.deliveryFree ?? true}
                    onChange={(deliveryFree) => patch({ deliveryFree })}
                  />
                </SwitchGroup>
                {!form.deliveryFree && (
                  <NumberField
                    label="Abater do frete"
                    value={form.deliveryDiscount ?? 0}
                    onChange={(deliveryDiscount) => patch({ deliveryDiscount })}
                    prefix="R$"
                    hint="Nunca deixa a taxa negativa."
                  />
                )}
              </div>
            )}
          </Block>

          {(form.kind === 'desconto' || form.kind === 'leve_pague') && (
            <Block title="Onde a promoção pega">
              <div className="flex flex-wrap gap-1.5">
                {(['produtos', 'categorias', 'todos'] as PromotionScope[]).map((scope) => (
                  <ModeChip key={scope} active={form.scope === scope} onClick={() => patch({ scope })}>
                    {scope === 'produtos' ? 'Produtos escolhidos' : scope === 'categorias' ? 'Categorias' : 'Cardápio inteiro'}
                  </ModeChip>
                ))}
              </div>

              {form.scope === 'categorias' && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {categories.map((category) => (
                    <PickChip
                      key={category.id}
                      active={form.categoryIds.includes(category.id)}
                      onClick={() => patch({ categoryIds: toggleId(form.categoryIds, category.id) })}
                    >
                      {category.emoji} {category.label}
                    </PickChip>
                  ))}
                </div>
              )}

              {form.scope === 'produtos' && (
                <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-[#E7E5E4] divide-y divide-[#F5F5F4]">
                  {products.map((product) => {
                    const picked = form.productIds.includes(product.id);
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => patch({ productIds: toggleId(form.productIds, product.id) })}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
                          picked ? 'bg-[#FEF2F2]' : 'hover:bg-[#FAFAF9]'
                        }`}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            picked ? 'border-[#B91C1C] bg-[#B91C1C] text-white' : 'border-[#D6D3D1]'
                          }`}
                        >
                          {picked && <Check className="w-3 h-3" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-bold text-[#1C1917]">{product.name}</span>
                        <span className="shrink-0 text-[#57534E]">{money(product.basePrice)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Block>
          )}

          <Block title="Quando vale" hint={describeWindow(form.window)}>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_LABELS.map((label, day) => {
                const picked = form.window.weekdays.includes(day);
                return (
                  <PickChip
                    key={label}
                    active={picked}
                    onClick={() =>
                      patchWindow({
                        weekdays: picked
                          ? form.window.weekdays.filter((item) => item !== day)
                          : [...form.window.weekdays, day],
                      })
                    }
                  >
                    {label}
                  </PickChip>
                );
              })}
              <PickChip active={form.window.weekdays.length === 0} onClick={() => patchWindow({ weekdays: [] })}>
                Todo dia
              </PickChip>
            </div>

            <FieldGrid>
              <TimeField
                label="Começa às"
                value={form.window.startTime ?? ''}
                onChange={(startTime) => patchWindow({ startTime: startTime || undefined })}
                onClear={() => patchWindow({ startTime: undefined, endTime: undefined })}
                clearable={Boolean(form.window.startTime || form.window.endTime)}
              />
              <TimeField
                label="Termina às"
                value={form.window.endTime ?? ''}
                onChange={(endTime) => patchWindow({ endTime: endTime || undefined })}
                onClear={() => patchWindow({ startTime: undefined, endTime: undefined })}
                clearable={Boolean(form.window.startTime || form.window.endTime)}
              />
              <DateField
                label="Primeiro dia (opcional)"
                value={form.window.startDate ?? ''}
                onChange={(startDate) => patchWindow({ startDate: startDate || undefined })}
              />
              <DateField
                label="Último dia (opcional)"
                value={form.window.endDate ?? ''}
                onChange={(endDate) => patchWindow({ endDate: endDate || undefined })}
              />
            </FieldGrid>
            <FieldNote>
              Sem horário, a promoção vale o dia inteiro. Um horário que termina antes de começar (22:00 → 02:00)
              atravessa a madrugada.
            </FieldNote>
          </Block>

          <Block title="Condições do pedido">
            <FieldGrid>
              <NumberField
                label="Pedido mínimo"
                value={form.minOrderValue}
                onChange={(minOrderValue) => patch({ minOrderValue })}
                prefix="R$"
                hint="0 = sem mínimo."
              />
              <NumberField
                label="Limite de pedidos"
                value={form.maxUses}
                onChange={(maxUses) => patch({ maxUses: Math.round(maxUses) })}
                suffix="pedidos"
                hint="0 = sem limite. Bom para promoção relâmpago."
              />
            </FieldGrid>

            <div className="flex flex-wrap gap-1.5">
              <ChannelChip
                active={form.channel === 'ambos'}
                disabled={form.kind === 'frete'}
                onClick={() => patch({ channel: 'ambos' })}
                icon={<ShoppingBag className="w-3.5 h-3.5" />}
              >
                Entrega e retirada
              </ChannelChip>
              <ChannelChip
                active={form.channel === 'delivery'}
                onClick={() => patch({ channel: 'delivery' })}
                icon={<Bike className="w-3.5 h-3.5" />}
              >
                Só entrega
              </ChannelChip>
              <ChannelChip
                active={form.channel === 'pickup'}
                disabled={form.kind === 'frete'}
                onClick={() => patch({ channel: 'pickup' })}
                icon={<Store className="w-3.5 h-3.5" />}
              >
                Só retirada
              </ChannelChip>
            </div>

            <SwitchGroup>
              <SwitchRow
                label="Pode somar com cupom"
                description="Desligado, o cliente escolhe: ou o cupom, ou a promoção."
                checked={form.stacksWithCoupon}
                onChange={(stacksWithCoupon) => patch({ stacksWithCoupon })}
              />
              <SwitchRow
                label="Mostrar selo no cardápio"
                description="O cliente vê o preço promocional já na foto do produto."
                checked={form.highlight}
                onChange={(highlight) => patch({ highlight })}
              />
              <SwitchRow
                label="Promoção ligada"
                description="Desligue para guardar a regra sem publicar."
                checked={form.enabled}
                onChange={(enabled) => patch({ enabled })}
              />
            </SwitchGroup>
          </Block>

          <MarginGuard report={report} kind={form.kind} />
        </div>

        {/* No celular a folha encosta no rodapé da tela: a barra de gestos do iOS
            cobria estes botões. `pb-safe` vai num invólucro porque a classe
            (que é CSS solto, fora das camadas do Tailwind) sobrescreveria o
            `py-4` do rodapé e colaria os botões na borda no desktop. */}
        <footer className="pb-safe border-t border-[#E7E5E4]">
          <div className="flex items-center justify-end gap-2 px-5 py-4">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              <Check className="w-4 h-4" />
              {saving ? 'Salvando…' : 'Salvar promoção'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
};

/**
 * O que nenhum concorrente mostra na hora de criar a promoção: quanto sobra.
 * Sem custo cadastrado a conta não existe, e a tela diz isso em vez de fingir.
 */
const MarginGuard: React.FC<{ report: ReturnType<typeof marginReport>; kind: PromotionKind }> = ({ report, kind }) => {
  if (kind === 'frete') {
    return (
      <Block title="Quanto isso custa">
        <FieldNote>
          Cada pedido que usar esta promoção deixa de cobrar a taxa de entrega. O motoboy continua recebendo: o valor
          sai do seu lucro. Use um pedido mínimo que cubra a taxa média.
        </FieldNote>
      </Block>
    );
  }

  if (!report.rows.length) {
    return (
      <Block title="Quanto sobra">
        <FieldNote>Escolha os produtos ou categorias para ver a margem antes de publicar.</FieldNote>
      </Block>
    );
  }

  const visible = report.rows.slice(0, 6);

  return (
    <Block title="Quanto sobra" hint="Conferido item a item, com o custo cadastrado no cardápio.">
      {report.hasLoss && (
        <div className="flex items-start gap-2 rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs font-bold text-[#B91C1C]">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            Esta promoção vende abaixo do custo em{' '}
            {report.rows.filter((row) => row.belowCost).length} item(ns). Cada venda dá prejuízo.
          </span>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[#E7E5E4]">
        <table className="w-full min-w-[420px] text-xs">
          <thead className="bg-[#FAFAF9] text-[10px] uppercase tracking-wide text-[#78716C]">
            <tr>
              <th className="px-3 py-2 text-left font-bold">Produto</th>
              <th className="px-3 py-2 text-right font-bold">De</th>
              <th className="px-3 py-2 text-right font-bold">Por</th>
              <th className="px-3 py-2 text-right font-bold">Custo</th>
              <th className="px-3 py-2 text-right font-bold">Sobra</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F5F5F4]">
            {visible.map((row) => (
              <tr key={row.productId} className={row.belowCost ? 'bg-[#FEF2F2]' : ''}>
                <td className="px-3 py-2 font-bold text-[#1C1917]">{row.name}</td>
                <td className="px-3 py-2 text-right text-[#A8A29E] line-through">{money(row.basePrice)}</td>
                <td className="px-3 py-2 text-right font-bold text-[#059669]">{money(row.promoPrice)}</td>
                <td className="px-3 py-2 text-right text-[#57534E]">{row.cost ? money(row.cost) : '—'}</td>
                <td
                  className={`px-3 py-2 text-right font-extrabold ${
                    row.profit === null ? 'text-[#A8A29E]' : row.profit < 0 ? 'text-[#B91C1C]' : 'text-[#047857]'
                  }`}
                >
                  {row.profit === null
                    ? 'sem custo'
                    : `${money(row.profit)}${row.marginAfter !== null ? ` · ${row.marginAfter.toFixed(0)}%` : ''}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report.rows.length > visible.length && (
        <FieldNote>Mostrando 6 de {report.rows.length} itens alcançados.</FieldNote>
      )}
      {report.missingCost > 0 && (
        <FieldNote tone="danger">
          {report.missingCost} produto(s) sem custo cadastrado. Preencha o campo "Custo do prato" no cardápio para a
          conta ficar completa.
        </FieldNote>
      )}
    </Block>
  );
};

// ---------- Peças pequenas ----------

const Block: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section className="space-y-3">
    <div>
      <h4 className="text-sm font-extrabold text-[#1C1917]">{title}</h4>
      {hint && <p className="mt-0.5 text-[11px] text-[#78716C]">{hint}</p>}
    </div>
    {children}
  </section>
);

const ModeChip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
      active ? 'border-[#B91C1C] bg-[#B91C1C] text-white' : 'border-[#E7E5E4] bg-[#F5F5F4] text-[#57534E] hover:bg-[#E7E5E4]'
    }`}
  >
    {children}
  </button>
);

const PickChip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
      active
        ? 'border-[#047857] bg-[#ECFDF5] text-[#047857]'
        : 'border-[#E7E5E4] bg-white text-[#57534E] hover:bg-[#FAFAF9]'
    }`}
  >
    {children}
  </button>
);

const ChannelChip: React.FC<{
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ active, disabled, onClick, icon, children }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    aria-pressed={active}
    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
      active ? 'border-[#B91C1C] bg-[#FEF2F2] text-[#B91C1C]' : 'border-[#E7E5E4] bg-white text-[#57534E] hover:bg-[#FAFAF9]'
    }`}
  >
    {icon}
    {children}
  </button>
);

/** O botão "dia inteiro" existe porque apagar um campo de hora à mão deixa o
    input num meio-termo que o navegador recusa. */
const TimeField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  clearable: boolean;
}> = ({ label, value, onChange, onClear, clearable }) => (
  <div className="min-w-0">
    <div className="flex items-center justify-between gap-2">
      <label className="text-xs font-bold text-[#44403C]">{label}</label>
      {clearable && (
        <button
          type="button"
          onClick={onClear}
          className="text-[11px] font-bold text-[#B91C1C] hover:underline"
        >
          Dia inteiro
        </button>
      )}
    </div>
    <input
      type="time"
      className={`${INPUT_CLASS} mt-1.5`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  </div>
);

const DateField: React.FC<{ label: string; value: string; onChange: (value: string) => void }> = ({
  label,
  value,
  onChange,
}) => (
  <div className="min-w-0">
    <label className="block text-xs font-bold text-[#44403C]">{label}</label>
    <input
      type="date"
      className={`${INPUT_CLASS} mt-1.5`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  </div>
);
