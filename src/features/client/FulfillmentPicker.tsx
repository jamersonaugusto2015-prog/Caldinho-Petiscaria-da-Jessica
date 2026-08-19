import React from 'react';
import { Bike, Store } from 'lucide-react';
import { useCart } from './CartStore';

/**
 * Escolha entre receber em casa e buscar no balcão. Fica no carrinho e no checkout
 * porque é ela que decide se existe frete e se o endereço é obrigatório.
 */
export const FulfillmentPicker: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { fulfillment, setFulfillment } = useCart();

  const options = [
    { id: 'delivery' as const, label: 'Entrega', hint: 'Motoboy leva até você', icon: Bike },
    { id: 'pickup' as const, label: 'Retirar na loja', hint: 'Você busca no balcão', icon: Store },
  ];

  return (
    <div className={`grid grid-cols-2 gap-2 ${className}`}>
      {options.map((option) => {
        const Icon = option.icon;
        const isSelected = fulfillment === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => setFulfillment(option.id)}
            aria-pressed={isSelected}
            className={`p-3 rounded-2xl border text-left transition flex items-center gap-2 ${
              isSelected
                ? 'bg-[#FEF2F2] border-[#B91C1C] ring-2 ring-[#B91C1C]/20 shadow-xs'
                : 'bg-[#F5F5F4]/60 border-[#E7E5E4] hover:bg-[#F5F5F4]'
            }`}
          >
            <Icon className={`w-4 h-4 shrink-0 ${isSelected ? 'text-[#B91C1C]' : 'text-[#57534E]'}`} />
            <span className="min-w-0">
              <span className={`block text-xs font-extrabold ${isSelected ? 'text-[#B91C1C]' : 'text-[#1C1917]'}`}>
                {option.label}
              </span>
              <span className="block text-[10px] text-[#57534E] truncate">{option.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
};
