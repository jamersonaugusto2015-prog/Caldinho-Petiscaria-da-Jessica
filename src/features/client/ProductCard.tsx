import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Product } from '../../types';
import { Star, Flame, Plus, Clock, Tag } from 'lucide-react';
import { bestProductPromotion, productPromotionBadges } from '../../shared/promotions';
import { useClientShell } from './ClientStore';

interface ProductCardProps {
  product: Product;
  onSelect: (product: Product) => void;
  index?: number;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product, onSelect, index = 0 }) => {
  const reduceMotion = useReducedMotion();
  const { promotions } = useClientShell();
  const promotion = bestProductPromotion(product, promotions);
  const badges = productPromotionBadges(product, promotions);
  const price = promotion ? promotion.price : product.basePrice;
  const strikePrice = promotion ? product.basePrice : product.originalPrice;

  const primaryBadge = product.isCaldinhoDoDia
    ? { tone: 'hoje' as const, label: 'Hoje' }
    : product.isFlashPromo
      ? {
          tone: 'promo' as const,
          label: product.originalPrice
            ? `−${Math.round(((product.originalPrice - product.basePrice) / product.originalPrice) * 100)}%`
            : 'Promo',
        }
      : promotion
        ? {
            tone: 'deal' as const,
            label:
              promotion.promo.badge ||
              `−${Math.round(((product.basePrice - promotion.price) / product.basePrice) * 100)}%`,
          }
        : badges[0]
          ? { tone: 'tag' as const, label: badges[0] }
          : product.isPopular
            ? { tone: 'top' as const, label: 'Top' }
            : null;

  return (
    <motion.article
      layout={!reduceMotion}
      initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0, scale: 0.97 }}
      transition={{
        duration: 0.34,
        delay: reduceMotion ? 0 : Math.min(index, 8) * 0.045,
        ease: [0.16, 1, 0.3, 1],
      }}
      onClick={() => product.available && onSelect(product)}
      className={`group relative flex flex-col overflow-hidden rounded-[22px] border border-[#E7E5E4] bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04),0_10px_24px_rgba(28,25,23,0.05)] ${
        !product.available ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      }`}
      whileTap={product.available && !reduceMotion ? { scale: 0.98 } : undefined}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#F5F5F4]">
        <img
          src={product.image}
          alt={product.name}
          className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]"
          loading="lazy"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-black/10" />

        <div className="absolute left-2 top-2 flex max-w-[70%] flex-col items-start gap-1">
          {primaryBadge && (
            <span
              className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-wide text-white shadow-sm ${
                primaryBadge.tone === 'hoje'
                  ? 'bg-[#B91C1C]'
                  : primaryBadge.tone === 'promo'
                    ? 'bg-[#D97706]'
                    : primaryBadge.tone === 'deal'
                      ? 'bg-[#059669]'
                      : primaryBadge.tone === 'tag'
                        ? 'bg-[#7C3AED]'
                        : 'bg-[#1C1917]'
              }`}
            >
              {primaryBadge.tone === 'hoje' ? (
                <Flame className="h-2.5 w-2.5 fill-[#FDE68A] text-[#FDE68A]" />
              ) : primaryBadge.tone === 'top' ? null : (
                <Tag className="h-2.5 w-2.5" />
              )}
              <span>{primaryBadge.label}</span>
            </span>
          )}
        </div>

        <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-full border border-white/70 bg-white/90 px-1.5 py-0.5 text-[9px] font-bold text-[#1C1917] shadow-xs backdrop-blur-sm">
          {product.rating > 0 ? (
            <>
              <Star className="h-2.5 w-2.5 fill-[#D97706] text-[#D97706]" />
              <span>{product.rating.toFixed(1)}</span>
            </>
          ) : (
            <span>Novo</span>
          )}
        </div>

        {product.available && (
          <motion.button
            type="button"
            whileTap={reduceMotion ? undefined : { scale: 0.88 }}
            whileHover={reduceMotion ? undefined : { scale: 1.06 }}
            transition={{ type: 'spring', stiffness: 500, damping: 22 }}
            disabled={!product.available}
            onClick={(e) => {
              e.stopPropagation();
              if (product.available) onSelect(product);
            }}
            className="absolute bottom-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-[#B91C1C] text-white shadow-[0_8px_18px_rgba(185,28,28,0.4)] ring-2 ring-white"
            aria-label={`Adicionar ${product.name} ao carrinho`}
          >
            <Plus className="h-4 w-4" strokeWidth={2.6} />
          </motion.button>
        )}

        {!product.available && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1C1917]/70 backdrop-blur-[2px]">
            <span className="rounded-full bg-[#B91C1C] px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-white">
              Esgotado
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3 pt-2.5">
        <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-[#78716C]">
          <Clock className="h-3 w-3 text-[#D97706]" />
          <span>~{product.prepTimeMinutes} min</span>
        </div>

        <h3 className="line-clamp-2 text-[13px] font-extrabold leading-snug text-[#1C1917]">
          {product.name}
        </h3>

        {product.description && (
          <p className="line-clamp-2 text-[10px] leading-snug text-[#78716C]">{product.description}</p>
        )}

        <div className="mt-auto flex items-baseline gap-1.5 pt-1">
          <span className={`text-[15px] font-black tabular-nums ${promotion ? 'text-[#059669]' : 'text-[#1C1917]'}`}>
            R$ {price.toFixed(2)}
          </span>
          {strikePrice && strikePrice > price && (
            <span className="text-[10px] font-semibold tabular-nums text-[#A8A29E] line-through">
              R$ {strikePrice.toFixed(2)}
            </span>
          )}
        </div>
      </div>
    </motion.article>
  );
};
