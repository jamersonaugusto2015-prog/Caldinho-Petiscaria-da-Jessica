import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgePercent,
  CalendarClock,
  Copy,
  Megaphone,
  Pause,
  Pencil,
  Play,
  PlusCircle,
  RotateCcw,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import type { Promotion } from '../../../contract/catalog/types';
import { PROMOTION_KIND_LABELS, PROMOTION_STATUS_LABELS, WEEKDAY_LABELS, describePromotion, describeWindow, promotionStatus, type PromotionStatus } from '../../../contract/catalog/promotions';
import { useKitchenCatalog } from './KitchenCatalogStore';
import { KitchenPromotionEditor } from './KitchenPromotionEditor';
import { describeTarget, marginReport, targetProducts } from './kitchenPromotionDraft';
import { StatusPill, type PillTone } from './KitchenSettingsUI';
import { useNow } from './useNow';
import { formatMoney } from '../../../contract/pricing/money';


const STATUS_TONE: Record<PromotionStatus, PillTone> = {
  ativa: 'ok',
  pausada: 'muted',
  agendada: 'warn',
  fora_da_janela: 'warn',
  expirada: 'muted',
  esgotada: 'danger',
};

/** Uma promoção roda neste dia da semana? Vazio = todo dia. */
const runsOnWeekday = (promo: Promotion, day: number) =>
  promo.window.weekdays.length === 0 || promo.window.weekdays.includes(day);

export const KitchenPromotionsPanel: React.FC = () => {
  const { products, categories, promotions, savePromotion, deletePromotion, togglePromotion, resetPromotionUses } =
    useKitchenCatalog();
  // O estado ('valendo agora' vira 'fora do horário' às 20h) precisa mudar
  // sozinho na tela: o dono deixa o painel aberto o serviço inteiro.
  const nowMs = useNow(30000);
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const [editor, setEditor] = useState<Promotion | 'new' | null>(null);

  const decorated = useMemo(
    () =>
      promotions.map((promo) => ({
        promo,
        status: promotionStatus(promo, now),
        report: marginReport(promo, products),
      })),
    [promotions, products, now]
  );

  const liveCount = decorated.filter((item) => item.status === 'ativa').length;
  const scheduledCount = decorated.filter(
    (item) => item.status === 'agendada' || item.status === 'fora_da_janela'
  ).length;
  const totals = useMemo(
    () =>
      promotions.reduce(
        (acc, promo) => ({
          discount: acc.discount + (promo.totalDiscount || 0),
          revenue: acc.revenue + (promo.totalRevenue || 0),
          orders: acc.orders + (promo.totalOrders || 0),
        }),
        { discount: 0, revenue: 0, orders: 0 }
      ),
    [promotions]
  );

  // Duas promoções ligadas no mesmo produto: o motor pega só a melhor, mas quem
  // montou as regras precisa saber que uma delas nunca vai aparecer.
  const conflicts = useMemo(() => {
    const byProduct = new Map<string, string[]>();
    for (const { promo, status } of decorated) {
      if (status !== 'ativa' || (promo.kind !== 'desconto' && promo.kind !== 'leve_pague')) continue;
      for (const product of targetProducts(promo, products)) {
        byProduct.set(product.id, [...(byProduct.get(product.id) ?? []), promo.name]);
      }
    }
    const names = new Set<string>();
    for (const [productId, list] of byProduct) {
      if (list.length < 2) continue;
      const product = products.find((item) => item.id === productId);
      names.add(`${product?.name ?? productId}: ${list.join(' × ')}`);
    }
    return [...names];
  }, [decorated, products]);

  const groups: { title: string; items: typeof decorated }[] = [
    { title: 'Valendo agora', items: decorated.filter((item) => item.status === 'ativa') },
    {
      title: 'Esperando a hora',
      items: decorated.filter((item) => item.status === 'agendada' || item.status === 'fora_da_janela'),
    },
    {
      title: 'Fora do ar',
      items: decorated.filter(
        (item) => item.status === 'pausada' || item.status === 'expirada' || item.status === 'esgotada'
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-[#B91C1C] text-white flex items-center justify-center shrink-0">
            <Megaphone className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold text-[#1C1917] truncate">Promoções</h2>
            <p className="text-xs text-[#57534E]">
              {liveCount} valendo agora
              {scheduledCount > 0 && ` · ${scheduledCount} esperando a hora`}
            </p>
          </div>
        </div>
        <button className="btn-primary shrink-0" onClick={() => setEditor('new')}>
          <PlusCircle className="w-4 h-4" />
          Nova promoção
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric icon={<BadgePercent className="w-4 h-4" />} label="Pedidos com promoção" value={String(totals.orders)} />
        <Metric icon={<TrendingUp className="w-4 h-4" />} label="Faturamento gerado" value={formatMoney(totals.revenue)} />
        <Metric
          icon={<AlertTriangle className="w-4 h-4" />}
          label="Desconto concedido"
          value={formatMoney(totals.discount)}
          tone="warn"
        />
        <Metric
          icon={<TrendingUp className="w-4 h-4" />}
          label="Ticket médio promocional"
          value={totals.orders > 0 ? formatMoney(totals.revenue / totals.orders) : '—'}
        />
      </div>

      <WeekAgenda decorated={decorated} today={now.getDay()} />

      {conflicts.length > 0 && (
        <div className="rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-xs text-[#B45309]">
          <strong className="flex items-center gap-1.5 font-extrabold">
            <AlertTriangle className="w-4 h-4" />
            Promoções disputando o mesmo item
          </strong>
          <p className="mt-1 leading-relaxed">
            O cliente recebe só a melhor delas. Ajuste o alvo ou o horário para nenhuma ficar de enfeite.
          </p>
          <ul className="mt-1.5 list-disc pl-5">
            {conflicts.slice(0, 5).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {promotions.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[#E7E5E4] bg-white p-8 text-center">
          <p className="text-sm font-extrabold text-[#1C1917]">Nenhuma promoção criada ainda</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-[#78716C]">
            Uma promoção liga e desliga sozinha na hora que você marcar, mostra o preço novo no cardápio e diz quanto
            sobra em cada prato antes de você publicar.
          </p>
          <button className="btn-primary mt-4 mx-auto" onClick={() => setEditor('new')}>
            <PlusCircle className="w-4 h-4" />
            Criar a primeira
          </button>
        </div>
      )}

      {groups.map((group) =>
        group.items.length === 0 ? null : (
          <section key={group.title} className="space-y-2">
            <h3 className="text-xs font-extrabold uppercase tracking-wide text-[#78716C]">
              {group.title} ({group.items.length})
            </h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))] gap-3">
              {group.items.map(({ promo, status, report }) => (
                <PromotionCard
                  key={promo.id}
                  promo={promo}
                  status={status}
                  hasLoss={report.hasLoss}
                  target={describeTarget(promo, products, categories)}
                  onEdit={() => setEditor(promo)}
                  onToggle={() => void togglePromotion(promo)}
                  onDuplicate={() =>
                    setEditor({
                      ...promo,
                      id: `promo-${Date.now()}`,
                      name: `${promo.name} (cópia)`,
                      usedCount: 0,
                      totalDiscount: 0,
                      totalRevenue: 0,
                      totalOrders: 0,
                    })
                  }
                  onResetUses={() => void resetPromotionUses(promo.id)}
                  onDelete={() => {
                    if (window.confirm(`Excluir a promoção ${promo.name}?`)) void deletePromotion(promo.id);
                  }}
                />
              ))}
            </div>
          </section>
        )
      )}

      {editor && (
        <KitchenPromotionEditor
          value={editor}
          products={products}
          categories={categories}
          onClose={() => setEditor(null)}
          onSave={savePromotion}
        />
      )}
    </div>
  );
};

/**
 * A semana inteira em sete colunas. Responde de relance a pergunta que o dono
 * faz toda segunda: "que dia eu estou sem nenhuma promoção no ar?".
 */
const WeekAgenda: React.FC<{
  decorated: { promo: Promotion; status: PromotionStatus }[];
  today: number;
}> = ({ decorated, today }) => {
  const usable = decorated.filter(
    ({ status }) => status === 'ativa' || status === 'agendada' || status === 'fora_da_janela'
  );

  return (
    <section className="rounded-2xl border border-[#E7E5E4] bg-white p-3">
      <h3 className="flex items-center gap-1.5 text-xs font-extrabold text-[#1C1917]">
        <CalendarClock className="w-4 h-4 text-[#B91C1C]" />
        Agenda da semana
      </h3>
      <div className="mt-2.5 grid grid-cols-7 gap-1.5">
        {WEEKDAY_LABELS.map((label, day) => {
          const items = usable.filter(({ promo }) => runsOnWeekday(promo, day));
          return (
            <div
              key={label}
              className={`min-h-[76px] rounded-xl border p-1.5 ${
                day === today ? 'border-[#B91C1C] bg-[#FEF2F2]' : 'border-[#E7E5E4] bg-[#FAFAF9]'
              }`}
            >
              <span
                className={`block text-center text-[10px] font-extrabold uppercase ${
                  day === today ? 'text-[#B91C1C]' : 'text-[#78716C]'
                }`}
              >
                {label}
              </span>
              <div className="mt-1 space-y-1">
                {items.length === 0 ? (
                  <span className="block text-center text-[9px] text-[#A8A29E]">—</span>
                ) : (
                  items.slice(0, 3).map(({ promo }) => (
                    <span
                      key={promo.id}
                      title={`${promo.name} · ${describeWindow(promo.window)}`}
                      className="block truncate rounded bg-white px-1 py-0.5 text-[9px] font-bold text-[#1C1917] shadow-xs"
                    >
                      {promo.window.startTime ? `${promo.window.startTime} ` : ''}
                      {promo.name}
                    </span>
                  ))
                )}
                {items.length > 3 && (
                  <span className="block text-center text-[9px] font-bold text-[#78716C]">
                    +{items.length - 3}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

const Metric: React.FC<{ icon: React.ReactNode; label: string; value: string; tone?: 'warn' }> = ({
  icon,
  label,
  value,
  tone,
}) => (
  <div className="rounded-2xl border border-[#E7E5E4] bg-white p-3">
    <span
      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${
        tone === 'warn' ? 'bg-[#FFFBEB] text-[#B45309]' : 'bg-[#F5F5F4] text-[#57534E]'
      }`}
    >
      {icon}
    </span>
    <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-[#78716C]">{label}</p>
    <p className="text-lg font-black text-[#1C1917]">{value}</p>
  </div>
);

const PromotionCard: React.FC<{
  promo: Promotion;
  status: PromotionStatus;
  hasLoss: boolean;
  target: string;
  onEdit: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onResetUses: () => void;
  onDelete: () => void;
}> = ({ promo, status, hasLoss, target, onEdit, onToggle, onDuplicate, onResetUses, onDelete }) => {
  const usageRatio = promo.maxUses > 0 ? Math.min(1, promo.usedCount / promo.maxUses) : 0;

  return (
    <article
      className={`flex flex-col gap-3 rounded-2xl border bg-white p-4 transition-colors ${
        status === 'ativa' ? 'border-[#A7F3D0]' : 'border-[#E7E5E4] hover:border-[#D6D3D1]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-extrabold text-[#1C1917]" title={promo.name}>
            {promo.name}
          </h4>
          <p className="text-[11px] font-bold text-[#B91C1C]">{describePromotion(promo)}</p>
        </div>
        <StatusPill tone={STATUS_TONE[status]}>{PROMOTION_STATUS_LABELS[status]}</StatusPill>
      </div>

      <dl className="space-y-1 text-[11px] text-[#57534E]">
        <Row label="Tipo" value={PROMOTION_KIND_LABELS[promo.kind]} />
        <Row label="Pega em" value={target} />
        <Row label="Quando" value={describeWindow(promo.window)} />
        <Row
          label="Canal"
          value={promo.channel === 'ambos' ? 'Entrega e retirada' : promo.channel === 'delivery' ? 'Só entrega' : 'Só retirada'}
        />
        {promo.minOrderValue > 0 && <Row label="Pedido mínimo" value={formatMoney(promo.minOrderValue)} />}
      </dl>

      {hasLoss && (
        <p className="flex items-center gap-1.5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-2.5 py-2 text-[11px] font-bold text-[#B91C1C]">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Vende abaixo do custo em pelo menos um item.
        </p>
      )}

      {promo.maxUses > 0 && (
        <div>
          <div className="flex justify-between text-[10px] font-bold text-[#78716C]">
            <span>Usos</span>
            <span>
              {promo.usedCount} de {promo.maxUses}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#F5F5F4]">
            <div
              className={`h-full rounded-full ${usageRatio >= 1 ? 'bg-[#B91C1C]' : 'bg-[#059669]'}`}
              style={{ width: `${usageRatio * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 rounded-xl bg-[#FAFAF9] p-2 text-center">
        <Stat label="Pedidos" value={String(promo.totalOrders || 0)} />
        <Stat label="Faturou" value={formatMoney(promo.totalRevenue || 0)} />
        <Stat label="Descontou" value={formatMoney(promo.totalDiscount || 0)} />
      </div>

      <div className="mt-auto flex gap-1.5">
        <button className={promo.enabled ? 'btn-secondary flex-1' : 'btn-primary flex-1'} onClick={onToggle}>
          {promo.enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {promo.enabled ? 'Pausar' : 'Ligar'}
        </button>
        <button className="btn-secondary p-2 pointer-coarse:min-w-11" title="Editar" aria-label="Editar" onClick={onEdit}>
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button className="btn-secondary p-2 pointer-coarse:min-w-11" title="Duplicar" aria-label="Duplicar" onClick={onDuplicate}>
          <Copy className="w-3.5 h-3.5" />
        </button>
        {promo.maxUses > 0 && (
          <button
            className="btn-secondary p-2 pointer-coarse:min-w-11"
            title="Zerar o contador de usos"
            aria-label="Zerar o contador de usos"
            onClick={onResetUses}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
        <button className="btn-danger p-2 pointer-coarse:min-w-11" title="Excluir" aria-label="Excluir" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </article>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between gap-2">
    <dt className="shrink-0 font-bold text-[#78716C]">{label}</dt>
    <dd className="min-w-0 truncate text-right text-[#1C1917]" title={value}>
      {value}
    </dd>
  </div>
);

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="text-[9px] font-bold uppercase tracking-wide text-[#78716C]">{label}</p>
    <p className="text-xs font-extrabold text-[#1C1917]">{value}</p>
  </div>
);
