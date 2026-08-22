import React, { useMemo, useState } from 'react';
import { Bike, MessageCircle, Star, Store } from 'lucide-react';
import type { Order } from '../../../contract/order/types';
import { isPickup } from '../../../contract/order/fulfillment';
import { useKitchenOrders } from './KitchenOrdersStore';
import { useKitchenChat } from './KitchenChatStore';
import { Heading, Panel, Empty } from './KitchenPanels';
import { shortDateTime } from './kitchenOrderRules';
import { formatMoney } from '../../../contract/pricing/money';

/** Nota a partir da qual a avaliação é tratada como boa. Até 3 é problema para olhar. */
const NOTA_BAIXA_MAXIMA = 3;

type RatingFilter = 'todas' | 'atencao' | 'comentario';

/** Data que vale para ordenar: pedido antigo não tem `deliveredAt`. */
const ratingDate = (order: Order) => order.deliveredAt || order.createdAt;

const hasComment = (order: Order) => !!order.ratingComment?.trim();

const isLowRating = (order: Order) => (order.rating || 0) <= NOTA_BAIXA_MAXIMA;

export const KitchenRatingsPanel: React.FC = () => {
  const { orders } = useKitchenOrders();
  const { openThread } = useKitchenChat();
  const [filter, setFilter] = useState<RatingFilter>('todas');

  const rated = useMemo(
    () =>
      orders
        .filter((order): order is Order & { rating: number } => !!order.rating)
        .sort((a, b) => ratingDate(b).localeCompare(ratingDate(a))),
    [orders]
  );

  const counts = useMemo(
    () => ({
      todas: rated.length,
      atencao: rated.filter(isLowRating).length,
      comentario: rated.filter(hasComment).length,
    }),
    [rated]
  );

  const average = useMemo(
    () => (rated.length ? rated.reduce((sum, order) => sum + order.rating, 0) / rated.length : 0),
    [rated]
  );

  /** Quantas avaliações há em cada estrela, de 5 até 1, para a barra de distribuição. */
  const distribution = useMemo(
    () =>
      [5, 4, 3, 2, 1].map((star) => ({
        star,
        total: rated.filter((order) => order.rating === star).length,
      })),
    [rated]
  );

  const visible = useMemo(() => {
    if (filter === 'atencao') return rated.filter(isLowRating);
    if (filter === 'comentario') return rated.filter(hasComment);
    return rated;
  }, [rated, filter]);

  return (
    <div className="space-y-4">
      <Heading
        icon={<Star />}
        title="Avaliações"
        subtitle={`${counts.todas} ${counts.todas === 1 ? 'avaliação' : 'avaliações'} no total · ${counts.atencao} com nota baixa (até ${NOTA_BAIXA_MAXIMA}).`}
      />

      <Panel title="Resumo de todas as avaliações">
        <div className="grid grid-cols-3 gap-3">
          <SummaryCard
            label="Nota média"
            value={rated.length ? average.toFixed(1) : '—'}
            hint={rated.length ? `de ${counts.todas} ${counts.todas === 1 ? 'avaliação' : 'avaliações'}` : 'ninguém avaliou ainda'}
          />
          <SummaryCard label="Avaliações" value={String(counts.todas)} hint="desde o começo" />
          <SummaryCard
            label={`Nota baixa (até ${NOTA_BAIXA_MAXIMA})`}
            value={String(counts.atencao)}
            hint={counts.atencao ? 'precisam de resposta' : 'nenhuma no momento'}
            danger={counts.atencao > 0}
          />
        </div>
        {/* O dono compara esta tela com a aba Relatórios: os números divergem de propósito. */}
        <p className="mt-3 text-[11px] text-[#57534E]">
          Estes números contam <strong>todas</strong> as avaliações já recebidas. A aba Relatórios mostra a
          nota média só do período escolhido lá, por isso os dois valores podem ser diferentes.
        </p>
      </Panel>

      <Panel title="Distribuição por estrela">
        {rated.length ? (
          <div className="space-y-2">
            {distribution.map((row) => (
              <DistributionRow key={row.star} star={row.star} total={row.total} overall={rated.length} />
            ))}
          </div>
        ) : (
          <Empty text="Sem avaliações para distribuir." />
        )}
      </Panel>

      <Panel title="Avaliações recebidas">
        <div className="mb-3 flex flex-wrap gap-1.5">
          <FilterChip
            active={filter === 'todas'}
            label="Todas"
            count={counts.todas}
            onClick={() => setFilter('todas')}
          />
          <FilterChip
            active={filter === 'atencao'}
            label="Precisam de atenção"
            count={counts.atencao}
            onClick={() => setFilter('atencao')}
          />
          <FilterChip
            active={filter === 'comentario'}
            label="Só com comentário"
            count={counts.comentario}
            onClick={() => setFilter('comentario')}
          />
        </div>

        <div className="space-y-3">
          {visible.map((order) => (
            <RatingRow key={order.id} order={order} onChat={() => openThread(order.id)} />
          ))}
          {visible.length === 0 && (
            <Empty
              text={
                rated.length === 0
                  ? 'Nenhum cliente avaliou um pedido ainda.'
                  : 'Nenhuma avaliação neste filtro. Escolha "Todas" para ver o resto.'
              }
            />
          )}
        </div>
      </Panel>
    </div>
  );
};

const SummaryCard: React.FC<{ label: string; value: string; hint: string; danger?: boolean }> = ({
  label,
  value,
  hint,
  danger,
}) => (
  <div
    className={`rounded-2xl border p-3 ${
      danger ? 'border-[#FCA5A5] bg-[#FEF2F2]' : 'border-[#E7E5E4] bg-[#F5F5F4]'
    }`}
  >
    <p className="text-[10px] font-black uppercase text-[#57534E]">{label}</p>
    <p className={`text-2xl font-extrabold ${danger ? 'text-[#B91C1C]' : 'text-[#1C1917]'}`}>{value}</p>
    <p className="text-[10px] text-[#57534E]">{hint}</p>
  </div>
);

const DistributionRow: React.FC<{ star: number; total: number; overall: number }> = ({
  star,
  total,
  overall,
}) => {
  const percent = overall ? Math.round((total / overall) * 100) : 0;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex w-10 items-center gap-0.5 font-extrabold text-[#1C1917]">
        {star}
        <Star className="h-3 w-3 fill-[#D97706] text-[#D97706]" />
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#F5F5F4]">
        <div
          // Barra sempre com uma fatia mínima visível quando há ao menos uma avaliação.
          className={`h-full rounded-full ${star <= NOTA_BAIXA_MAXIMA ? 'bg-[#B91C1C]' : 'bg-[#059669]'}`}
          style={{ width: total ? `${Math.max(3, percent)}%` : '0%' }}
        />
      </div>
      <span className="w-8 text-right font-extrabold">{total}</span>
      <span className="w-10 text-right text-[10px] text-[#57534E]">{percent}%</span>
    </div>
  );
};

const Stars: React.FC<{ rating: number }> = ({ rating }) => (
  <span className="flex items-center gap-0.5" aria-label={`Nota ${rating} de 5`}>
    {[1, 2, 3, 4, 5].map((star) => (
      <Star
        key={star}
        className={`h-4 w-4 ${
          star <= rating ? 'fill-[#D97706] text-[#D97706]' : 'fill-transparent text-[#E7E5E4]'
        }`}
      />
    ))}
  </span>
);

const FilterChip: React.FC<{
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}> = ({ active, label, count, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
      active
        ? 'bg-[#B91C1C] text-white'
        : 'border border-[#E7E5E4] bg-[#F5F5F4] text-[#57534E] hover:bg-[#E7E5E4]'
    }`}
  >
    {label} · {count}
  </button>
);

const RatingRow: React.FC<{ order: Order & { rating: number }; onChat: () => void }> = ({
  order,
  onChat,
}) => {
  const low = isLowRating(order);
  const pickup = isPickup(order);
  const comment = order.ratingComment?.trim();

  return (
    <div
      className={`space-y-2 rounded-2xl border p-3 ${
        low ? 'border-[#FCA5A5] bg-[#FEF2F2]' : 'border-[#E7E5E4] bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Stars rating={order.rating} />
          <strong className={`text-xs ${low ? 'text-[#B91C1C]' : 'text-[#1C1917]'}`}>
            {order.rating}/5
          </strong>
        </div>
        <span className="text-[11px] text-[#57534E]">{shortDateTime(ratingDate(order))}</span>
      </div>

      {low && (
        <span className="inline-block rounded-full bg-[#B91C1C] px-2 py-0.5 text-[9px] font-black uppercase text-white">
          Nota baixa
        </span>
      )}

      {comment ? (
        <p
          className={`rounded-2xl border p-2.5 text-sm font-bold leading-snug ${
            low ? 'border-[#FCA5A5] bg-white text-[#B91C1C]' : 'border-[#E7E5E4] bg-[#F5F5F4] text-[#1C1917]'
          }`}
        >
          “{comment}”
        </p>
      ) : (
        <p className="text-[11px] italic text-[#A8A29E]">O cliente deu a nota, mas não escreveu nada.</p>
      )}

      <div className="text-[11px] text-[#57534E]">
        <strong className="text-[#1C1917]">{order.id}</strong> · {order.customerName} · {formatMoney(order.total)}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 rounded-full bg-[#F5F5F4] px-2 py-1 text-[10px] font-bold text-[#57534E]">
          {pickup ? <Store className="h-3 w-3" /> : <Bike className="h-3 w-3" />}
          {pickup
            ? 'Retirada na loja'
            : order.address.neighborhood
              ? `Entrega · ${order.address.neighborhood}`
              : 'Entrega'}
        </span>
        {/* O nome do motoboy fica à vista: é assim que se enxerga um entregador puxando as notas para baixo. */}
        {!pickup && (
          <span
            className={`rounded-full px-2 py-1 text-[10px] font-bold ${
              low ? 'bg-[#FEF2F2] text-[#B45309]' : 'bg-[#F5F5F4] text-[#57534E]'
            }`}
          >
            {order.driverName ? `Motoboy: ${order.driverName}` : 'Motoboy não registrado'}
          </span>
        )}
      </div>

      <button className="btn-secondary w-full" onClick={onChat}>
        <MessageCircle className="h-3.5 w-3.5" />
        Responder ao cliente
      </button>
    </div>
  );
};
