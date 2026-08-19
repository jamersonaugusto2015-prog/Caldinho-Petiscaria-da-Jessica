import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Order } from '../../types';
import { money } from './kitchenOrderRules';

const PRESET_REASONS = [
  'Faltou ingrediente',
  'Cozinha sobrecarregada',
  'Endereço fora da área de entrega',
  'Endereço incorreto ou incompleto',
  'Cliente pediu por telefone',
  'Pagamento não confirmado',
];

const OTHER = 'Outro motivo';

export const KitchenCancelOrderModal: React.FC<{
  order: Order;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}> = ({ order, busy, onClose, onConfirm }) => {
  const [choice, setChoice] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const reason = choice === OTHER ? note.trim() : choice || '';
  const ready = reason.length > 0;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    onConfirm(reason);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-2xl p-5 w-full max-w-md space-y-3 max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="font-extrabold text-lg">Cancelar pedido {order.id}</h3>
          <p className="text-xs text-[#57534E]">
            {order.customerName} · {money(order.total)}
          </p>
        </div>

        {order.payment.isPaid && (
          <div className="flex gap-2 rounded-2xl border border-[#FCA5A5] bg-[#FEF2F2] p-3 text-[#B91C1C]">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="text-xs font-extrabold leading-snug">
              Este pedido está pago. Cancelar vai gerar uma devolução de {money(order.total)}.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <span className="text-[10px] uppercase font-bold text-[#57534E]">Motivo do cancelamento</span>
          {[...PRESET_REASONS, OTHER].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setChoice(option)}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold border transition ${
                choice === option
                  ? 'border-[#B91C1C] bg-[#FEF2F2] text-[#B91C1C]'
                  : 'border-[#E7E5E4] bg-[#F5F5F4] text-[#1C1917] hover:bg-[#E7E5E4]'
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        {choice === OTHER && (
          <textarea
            autoFocus
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Escreva o motivo que o cliente vai ler"
            className="input w-full resize-none"
          />
        )}

        <div className="flex gap-2 pt-1">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>
            Voltar
          </button>
          <button className="btn-danger flex-1" disabled={!ready || busy}>
            {busy ? 'Cancelando...' : order.payment.isPaid ? 'Cancelar e devolver' : 'Cancelar pedido'}
          </button>
        </div>
      </form>
    </div>
  );
};
