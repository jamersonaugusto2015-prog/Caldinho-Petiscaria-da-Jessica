import React from 'react';
import { RevenuePoint } from '../../types';
import { TrendingUp, CalendarDays, Crown, ShoppingBag } from 'lucide-react';

interface RevenueChartProps {
  points: RevenuePoint[];
  periodLabel: string; // ex: 'últimos 30 dias'
  currency?: boolean;
}

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const RevenueChart: React.FC<RevenueChartProps> = ({ points, periodLabel }) => {
  if (points.length === 0) {
    return <p className="text-xs text-[#A8A29E] italic py-8 text-center">Sem dados de faturamento neste período.</p>;
  }

  const max = Math.max(...points.map((p) => p.revenue), 1);
  const total = points.reduce((s, p) => s + p.revenue, 0);
  const totalOrders = points.reduce((s, p) => s + p.orders, 0);
  const days = points.length;
  const avg = days > 0 ? total / days : 0;
  const best = points.reduce((a, b) => (b.revenue > a.revenue ? b : a), points[0]);
  const bestIdx = points.findIndex((p) => p.date === best.date);

  // rótulos a cada ~5 barras (evita sobreposição com 30 pontos)
  const labelStep = Math.ceil(points.length / 8);

  return (
    <div className="space-y-4">
      {/* Estatísticas do período */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="bg-[#F5F5F4] rounded-2xl p-3 border border-[#E7E5E4]">
          <div className="flex items-center gap-1.5 text-[10px] text-[#57534E] font-bold uppercase">
            <TrendingUp className="w-3 h-3 text-[#B91C1C]" />
            Faturamento {periodLabel}
          </div>
          <div className="font-extrabold text-lg text-[#1C1917] mt-0.5">{fmtBRL(total)}</div>
        </div>
        <div className="bg-[#F5F5F4] rounded-2xl p-3 border border-[#E7E5E4]">
          <div className="flex items-center gap-1.5 text-[10px] text-[#57534E] font-bold uppercase">
            <CalendarDays className="w-3 h-3 text-[#2563EB]" />
            Média {periodLabel}
          </div>
          <div className="font-extrabold text-lg text-[#1C1917] mt-0.5">{fmtBRL(avg)}</div>
        </div>
        <div className="bg-[#F5F5F4] rounded-2xl p-3 border border-[#E7E5E4]">
          <div className="flex items-center gap-1.5 text-[10px] text-[#57534E] font-bold uppercase">
            <Crown className="w-3 h-3 text-[#D97706]" />
            Melhor período
          </div>
          <div className="font-extrabold text-lg text-[#D97706] mt-0.5">
            {best ? `${fmtBRL(best.revenue)}` : '—'}
          </div>
          <div className="text-[9px] text-[#A8A29E] font-bold">{best?.label ?? ''}</div>
        </div>
        <div className="bg-[#F5F5F4] rounded-2xl p-3 border border-[#E7E5E4]">
          <div className="flex items-center gap-1.5 text-[10px] text-[#57534E] font-bold uppercase">
            <ShoppingBag className="w-3 h-3 text-[#059669]" />
            Pedidos {periodLabel}
          </div>
          <div className="font-extrabold text-lg text-[#1C1917] mt-0.5">{totalOrders}</div>
        </div>
      </div>

      {/* Gráfico de barras */}
      <div className="bg-[#F5F5F4] rounded-2xl border border-[#E7E5E4] p-4">
        <div className="flex items-end gap-[3px] h-44">
          {points.map((p, i) => {
            const pct = Math.max((p.revenue / max) * 100, p.revenue > 0 ? 3 : 1);
            const isBest = i === bestIdx && best.revenue > 0;
            return (
              <div key={p.date} className="flex-1 flex flex-col justify-end items-center group relative h-full">
                {/* tooltip */}
                <div className="absolute bottom-full mb-1.5 hidden group-hover:block z-10 bg-[#1C1917] text-white text-[9px] font-bold px-2 py-1 rounded-lg whitespace-nowrap shadow-lg pointer-events-none">
                  {p.label}: {fmtBRL(p.revenue)}
                  <span className="block text-[8px] text-[#A8A29E]">{p.orders} pedido(s)</span>
                </div>
                <div
                  className={`w-full rounded-t-md transition-all duration-300 ${
                    isBest
                      ? 'bg-gradient-to-t from-[#D97706] to-[#FBBF24]'
                      : 'bg-gradient-to-t from-[#991B1B] to-[#DC2626] group-hover:from-[#7F1D1D]'
                  }`}
                  style={{ height: `${pct}%` }}
                />
              </div>
            );
          })}
        </div>

        {/* Rótulos do eixo X */}
        <div className="flex items-end gap-[3px] mt-1.5">
          {points.map((p, i) => (
            <div
              key={p.date}
              // `min-w-0`: sem ele o `flex-1` respeita a largura intrínseca do
              // rótulo, e um mês inteiro de pontos soma umas trinta datas que
              // estouram o painel no celular em vez de se apertarem.
              className={`min-w-0 flex-1 text-center text-[8px] font-bold ${
                i === bestIdx && best.revenue > 0 ? 'text-[#D97706]' : 'text-[#A8A29E]'
              } ${i % labelStep === 0 ? '' : 'opacity-0 pointer-events-none'}`}
            >
              {p.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
