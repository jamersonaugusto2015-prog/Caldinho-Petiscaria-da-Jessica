import React from 'react';
import { Product } from '../../types';
import { Star, Flame, Plus, Clock, Tag } from 'lucide-react';

interface ProductCardProps {
  product: Product;
  onSelect: (product: Product) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product, onSelect }) => {
  return (
    <div
      onClick={() => product.available && onSelect(product)}
      className={`group relative bg-white rounded-2xl border border-[#E7E5E4] overflow-hidden shadow-sm transition-all duration-200 active:scale-[0.98] flex flex-col justify-between ${
        !product.available ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
      }`}
    >
      <div>
        <div className="relative h-32 w-full overflow-hidden bg-[#F5F5F4]">
          <img
            src={product.image}
            alt={product.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />

          <div className="absolute top-2 left-2 flex flex-col gap-1 items-start">
            {product.isCaldinhoDoDia && (
              <span className="bg-[#B91C1C] text-white text-[8px] font-extrabold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shadow-sm uppercase tracking-wide">
                <Flame className="w-2.5 h-2.5 fill-[#FDE68A] text-[#FDE68A]" />
                <span>HOJE</span>
              </span>
            )}

            {product.isFlashPromo && !product.isCaldinhoDoDia && (
              <span className="bg-[#D97706] text-white text-[8px] font-extrabold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shadow-sm uppercase tracking-wide">
                <Tag className="w-2.5 h-2.5" />
                <span>
                  {product.originalPrice
                    ? `-${Math.round(((product.originalPrice - product.basePrice) / product.originalPrice) * 100)}%`
                    : 'PROMO'}
                </span>
              </span>
            )}

            {product.isPopular && !product.isCaldinhoDoDia && !product.isFlashPromo && (
              <span className="bg-[#1C1917] text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
                ⭐ TOP
              </span>
            )}
          </div>

          <div className="absolute top-2 right-2 bg-white/90 backdrop-blur-xs text-[#1C1917] text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 border border-[#E7E5E4] shadow-xs">
            {product.rating > 0 ? (
              <>
                <Star className="w-2.5 h-2.5 fill-[#D97706] text-[#D97706]" />
                <span>{product.rating.toFixed(1)}</span>
              </>
            ) : (
              <span>NOVO</span>
            )}
          </div>

          {!product.available && (
            <div className="absolute inset-0 bg-[#1C1917]/70 backdrop-blur-xs flex items-center justify-center">
              <span className="bg-[#B91C1C] text-white text-[9px] font-bold px-2 py-1 rounded-full uppercase tracking-wider">
                Esgotado
              </span>
            </div>
          )}
        </div>

        <div className="p-3">
          <div className="flex items-center gap-1 text-[8px] text-[#57534E] uppercase font-bold tracking-wider mb-1">
            <Clock className="w-2.5 h-2.5 text-[#D97706]" />
            <span>~{product.prepTimeMinutes} min</span>
          </div>

          <h3 className="font-extrabold text-xs text-[#1C1917] line-clamp-2 mb-1 leading-snug">
            {product.name}
          </h3>
        </div>
      </div>

      <div className="p-3 pt-0 flex items-center justify-between gap-1.5 border-t border-[#F5F5F4] mt-1.5">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1">
            <span className="text-sm font-black text-[#1C1917]">
              R$ {product.basePrice.toFixed(2)}
            </span>
            {product.originalPrice && (
              <span className="text-[10px] text-[#A8A29E] line-through">
                R$ {product.originalPrice.toFixed(2)}
              </span>
            )}
          </div>
        </div>

        <button
          disabled={!product.available}
          onClick={(e) => {
            e.stopPropagation();
            if (product.available) onSelect(product);
          }}
          className="bg-[#B91C1C] active:bg-[#991B1B] text-white p-2.5 rounded-full shadow-sm transition active:scale-95 flex items-center justify-center shrink-0"
          aria-label={`Adicionar ${product.name} ao carrinho`}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};