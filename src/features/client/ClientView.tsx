import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCart } from './CartStore';
import { useCheckout } from './CheckoutStore';
import { useClientShell, useCartTotals } from './ClientStore';
import { ProductCard } from './ProductCard';
import { ProductModal } from './ProductModal';
import { CartDrawer } from './CartDrawer';
import { CheckoutModal } from './CheckoutModal';
import { OrderTrackingModal } from './OrderTrackingModal';
import { ChatModal } from './ChatModal';
import { LoyaltySection } from './LoyaltySection';
import { ClosedStoreModal } from './ClosedStoreModal';
import { ClientFloatingNav, ClientTab } from './ClientFloatingNav';
import { Category, OpeningHour, Order, Product } from '../../types';
import { Flame, Sparkles, ShoppingBag, ClipboardList, Search, ChevronRight, Clock } from 'lucide-react';

function formatTodayHours(hours: OpeningHour | null): string {
  if (!hours) return 'Fechado hoje';
  return `${hours.open} às ${hours.close}`;
}

function statusLabel(status: Order['status']): string {
  switch (status) {
    case 'recebido':
      return 'Recebido';
    case 'em_preparo':
      return 'Em preparo';
    case 'pronto':
      return 'Pronto';
    case 'saiu_entrega':
      return 'Saiu p/ entrega';
    case 'entregue':
      return 'Entregue';
    case 'cancelado':
      return 'Cancelado';
    default:
      return String(status).replace('_', ' ');
  }
}

function statusTone(status: Order['status']): string {
  if (status === 'entregue') return 'bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]';
  if (status === 'cancelado') return 'bg-[#F5F5F4] text-[#78716C] border-[#E7E5E4]';
  return 'bg-[#FEF2F2] text-[#B91C1C] border-[#FCA5A5]';
}

const OrderCard: React.FC<{ order: Order; onOpen: () => void; index?: number }> = ({
  order,
  onOpen,
  index = 0,
}) => {
  const reduceMotion = useReducedMotion();
  const live = !['entregue', 'cancelado'].includes(order.status);
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: reduceMotion ? 0 : Math.min(index, 6) * 0.05, ease: [0.16, 1, 0.3, 1] }}
      whileTap={reduceMotion ? undefined : { scale: 0.985 }}
      className="w-full rounded-2xl border border-[#E7E5E4] bg-white p-4 text-left shadow-sm transition hover:border-[#B91C1C]/35"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-extrabold text-[#1C1917]">{order.id}</span>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${statusTone(order.status)} ${
              live ? 'animate-pulse' : ''
            }`}
          >
            {statusLabel(order.status)}
          </span>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-[#A8A29E]" />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate pr-2 text-[11px] text-[#57534E]">
          {order.items.map((i) => i.product.name).join(', ')}
        </span>
        <span className="shrink-0 text-xs font-extrabold text-[#B91C1C]">
          R$ {order.total.toFixed(2)}
        </span>
      </div>
      <div className="mt-1 text-[10px] text-[#A8A29E]">
        {new Date(order.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
      </div>
    </motion.button>
  );
};

const viewTransition = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.26, ease: [0.16, 1, 0.3, 1] as const },
};

export const ClientView: React.FC = () => {
  const { products, categories, selectedCategory, setSelectedCategory, searchQuery, setSearchQuery, settings } =
    useClientShell();
  const { orders, trackingOrderId, setTrackingOrderId } = useCheckout();
  const { cart, isCartOpen, setIsCartOpen, isClosedModalOpen, setClosedModalOpen } = useCart();
  const { total } = useCartTotals();

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [view, setView] = useState<ClientTab>('inicio');

  const caldinhoDoDia = products.find((p) => p.isCaldinhoDoDia && p.available) || null;

  const categoryList: Category[] = categories.length > 0 ? [...categories].sort((a, b) => a.sort - b.sort) : [];
  if (categoryList.length === 0) {
    const known: Record<string, { label: string; emoji: string; color: string }> = {
      caldinhos: { label: 'Caldinhos', emoji: '🍲', color: '#C2410C' },
      petiscos: { label: 'Petiscos', emoji: '🍤', color: '#7C3AED' },
      bebidas: { label: 'Bebidas', emoji: '🥤', color: '#2563EB' },
      combos: { label: 'Combos', emoji: '🍱', color: '#059669' },
    };
    const seen = new Set<string>();
    for (const p of products) {
      const id = String(p.category);
      if (seen.has(id)) continue;
      seen.add(id);
      categoryList.push({
        id,
        label: known[id]?.label || id,
        emoji: known[id]?.emoji || '🍽️',
        color: known[id]?.color || '#B91C1C',
        sort: categoryList.length,
      });
    }
  }

  const filteredProducts = products.filter((p) => {
    const matchesCat = selectedCategory === 'all' || p.category === selectedCategory;
    const matchesSearch =
      !searchQuery ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const activeOrderCount = useMemo(
    () => orders.filter((o) => !['entregue', 'cancelado'].includes(o.status)).length,
    [orders]
  );
  const reduceMotion = useReducedMotion();
  const vt = reduceMotion
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12 } }
    : viewTransition;

  return (
    <div className="space-y-4 pb-32">
      {!settings.isOpen && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#FCD34D] bg-[#FEF3C7] px-4 py-2.5 text-xs font-bold text-[#92400E]">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0" />
            <span>Loja fechada no momento</span>
          </div>
          <span className="shrink-0 rounded-full border border-[#FCD34D] bg-white px-2.5 py-1 text-[10px] font-extrabold">
            Hoje: {formatTodayHours(settings.openingHours[new Date().getDay()] ?? null)}
          </span>
        </div>
      )}

      <AnimatePresence mode="wait">
      {view === 'inicio' && (
        <motion.div key="inicio" className="space-y-4" {...vt}>
          {caldinhoDoDia && !searchQuery && selectedCategory === 'all' && (
            <motion.article
              layout={!reduceMotion}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              onClick={() => setSelectedProduct(caldinhoDoDia)}
              className="group relative w-full cursor-pointer overflow-hidden rounded-[22px] bg-[#7F1D1D] shadow-xl shadow-[#B91C1C]/15"
              whileTap={reduceMotion ? undefined : { scale: 0.99 }}
            >
              <div className="relative aspect-[16/10] w-full overflow-hidden">
                <img
                  src={caldinhoDoDia.image}
                  alt={caldinhoDoDia.name}
                  className="h-full w-full object-cover saturate-125 contrast-105 sepia-[0.08] transition-transform duration-700 group-hover:scale-105"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-black/20" />

                <div className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full bg-[#B91C1C] px-2.5 py-1 text-[8px] font-black uppercase tracking-wider text-white shadow-md">
                  <Flame className="h-3 w-3 fill-[#FDE68A] text-[#FDE68A]" />
                  <span>Promoção do dia</span>
                </div>

                <div className="absolute inset-x-0 bottom-0 p-3.5">
                  <p className="line-clamp-1 text-sm font-extrabold text-white drop-shadow">{caldinhoDoDia.name}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-[#FDE68A]">
                      R$ {caldinhoDoDia.basePrice.toFixed(2)}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-white px-3.5 py-2 text-[11px] font-black text-[#B91C1C] shadow-lg">
                      <ShoppingBag className="h-3.5 w-3.5" />
                      <span>Adicionar</span>
                    </span>
                  </div>
                </div>
              </div>
            </motion.article>
          )}

          <div className="-mx-0.5 flex gap-2 overflow-x-auto px-0.5 pb-1 no-scrollbar">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              aria-pressed={selectedCategory === 'all'}
              className="relative flex shrink-0 flex-col items-center gap-1.5 py-1 transition-all active:scale-95"
            >
              <div
                className={`relative flex h-14 w-14 items-center justify-center rounded-2xl text-xl transition-all ${
                  selectedCategory === 'all' ? 'shadow-md shadow-[#B91C1C]/15' : ''
                }`}
                style={{ backgroundColor: selectedCategory === 'all' ? '#FEE2E2' : '#FEF2F2' }}
              >
                {selectedCategory === 'all' && !reduceMotion && (
                  <motion.span
                    layoutId="cat-ring"
                    className="absolute inset-0 rounded-2xl ring-2 ring-[#B91C1C]"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  />
                )}
                {selectedCategory === 'all' && reduceMotion && (
                  <span className="absolute inset-0 rounded-2xl ring-2 ring-[#B91C1C]" />
                )}
                <Sparkles
                  className="relative h-7 w-7"
                  style={{ color: selectedCategory === 'all' ? '#B91C1C' : '#DC2626' }}
                  strokeWidth={2}
                />
              </div>
              <span
                className={`text-center text-[10px] font-semibold leading-tight ${
                  selectedCategory === 'all' ? 'text-[#B91C1C]' : 'text-[#44403C]'
                }`}
              >
                Todos
              </span>
            </button>

            {categoryList.map((cat) => {
              const isSelected = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  aria-pressed={isSelected}
                  className="relative flex shrink-0 flex-col items-center gap-1.5 py-1 transition-all active:scale-95"
                >
                  <div
                    className={`relative flex h-14 w-14 items-center justify-center rounded-2xl text-2xl transition-all ${
                      isSelected ? 'shadow-md shadow-[#B91C1C]/15' : ''
                    }`}
                    style={{ backgroundColor: isSelected ? '#FEE2E2' : `${cat.color}1A` }}
                  >
                    {isSelected && !reduceMotion && (
                      <motion.span
                        layoutId="cat-ring"
                        className="absolute inset-0 rounded-2xl ring-2 ring-[#B91C1C]"
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      />
                    )}
                    {isSelected && reduceMotion && (
                      <span className="absolute inset-0 rounded-2xl ring-2 ring-[#B91C1C]" />
                    )}
                    <span className="relative">{cat.emoji}</span>
                  </div>
                  <span
                    className={`max-w-[64px] truncate text-center text-[10px] font-semibold leading-tight ${
                      isSelected ? 'text-[#B91C1C]' : 'text-[#44403C]'
                    }`}
                  >
                    {cat.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div>
            <div className="mb-3 flex items-end justify-between gap-2">
              <h3 className="text-base font-extrabold leading-tight text-[#1C1917]">
                {selectedCategory === 'all'
                  ? 'Mais vendidos'
                  : categoryList.find((c) => c.id === selectedCategory)?.label}
              </h3>
              <span className="text-[11px] font-bold text-[#B91C1C]">{filteredProducts.length} itens</span>
            </div>

            {filteredProducts.length === 0 ? (
              <div className="rounded-2xl border border-[#E7E5E4] bg-white p-8 text-center text-[#57534E]">
                <p className="mb-1 text-lg font-bold text-[#1C1917]">Nenhum produto encontrado</p>
                <p className="text-xs">Tente buscar por outro termo ou escolha outra categoria.</p>
              </div>
            ) : (
              <motion.div layout className="grid grid-cols-2 gap-2.5" key={selectedCategory + searchQuery}>
                <AnimatePresence mode="popLayout">
                  {filteredProducts.map((product, i) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      index={i}
                      onSelect={(p) => setSelectedProduct(p)}
                    />
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </div>

          <LoyaltySection />
        </motion.div>
      )}

      {view === 'pedidos' && (
        <motion.div key="pedidos" className="space-y-4" {...vt}>
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#FEF2F2] text-[#B91C1C]">
              <ClipboardList className="h-5 w-5" strokeWidth={2.4} />
            </span>
            <div>
              <h2 className="text-base font-extrabold text-[#1C1917]">Meus pedidos</h2>
              <p className="text-[11px] text-[#78716C]">Toque para acompanhar ou repetir</p>
            </div>
          </div>

          {orders.length === 0 ? (
            <div className="rounded-2xl border border-[#E7E5E4] bg-white p-8 text-center text-[#57534E]">
              <p className="mb-1 text-lg font-bold text-[#1C1917]">Nenhum pedido ainda</p>
              <p className="text-xs">Seus pedidos aparecem aqui para você acompanhar.</p>
              <button
                type="button"
                onClick={() => setView('inicio')}
                className="mt-4 rounded-full bg-[#B91C1C] px-5 py-2.5 text-xs font-extrabold text-white shadow-md"
              >
                Ver cardápio
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {orders.map((ord, i) => (
                <OrderCard key={ord.id} order={ord} index={i} onOpen={() => setTrackingOrderId(ord.id)} />
              ))}
            </div>
          )}
        </motion.div>
      )}

      {view === 'busca' && (
        <motion.div key="busca" className="space-y-4" {...vt}>
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A8A29E]" />
            <input
              autoFocus
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar caldinho, petisco, bebida..."
              className="w-full rounded-2xl border border-[#E7E5E4] bg-white py-3.5 pl-10 pr-4 text-sm font-medium text-[#1C1917] placeholder-[#A8A29E] shadow-sm focus:border-[#B91C1C] focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/15"
            />
          </div>

          {searchQuery.trim() === '' ? (
            <div className="rounded-2xl border border-[#E7E5E4] bg-white p-8 text-center text-[#57534E]">
              <p className="mb-1 text-lg font-bold text-[#1C1917]">Digite para buscar</p>
              <p className="text-xs">Encontre seu caldinho preferido em segundos.</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="rounded-2xl border border-[#E7E5E4] bg-white p-8 text-center text-[#57534E]">
              <p className="mb-1 text-lg font-bold text-[#1C1917]">Nada encontrado</p>
              <p className="text-xs">Tente buscar por outro termo.</p>
            </div>
          ) : (
            <motion.div layout className="grid grid-cols-2 gap-2.5">
              <AnimatePresence mode="popLayout">
                {filteredProducts.map((product, i) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    index={i}
                    onSelect={(p) => setSelectedProduct(p)}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </motion.div>
      )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedProduct && (
          <ProductModal product={selectedProduct} onClose={() => setSelectedProduct(null)} />
        )}
      </AnimatePresence>

      <AnimatePresence>{isCartOpen && <CartDrawer onOpenCheckout={() => setIsCheckoutOpen(true)} />}</AnimatePresence>

      {isCheckoutOpen && (
        <CheckoutModal onClose={() => setIsCheckoutOpen(false)} onOrderPlaced={() => setIsCheckoutOpen(false)} />
      )}

      {trackingOrderId && (
        <OrderTrackingModal
          orderId={trackingOrderId}
          onClose={() => setTrackingOrderId(null)}
          onOpenChat={() => setIsChatOpen(true)}
        />
      )}

      {isChatOpen && trackingOrderId && (
        <ChatModal
          orderId={trackingOrderId}
          customerName={orders.find((o) => o.id === trackingOrderId)?.customerName}
          onClose={() => setIsChatOpen(false)}
        />
      )}

      {isClosedModalOpen && <ClosedStoreModal onClose={() => setClosedModalOpen(false)} />}

      <ClientFloatingNav
        view={view}
        onChangeView={setView}
        onOpenCart={() => setIsCartOpen(true)}
        cartCount={cartCount}
        cartTotal={total}
        activeOrderCount={activeOrderCount}
      />
    </div>
  );
};
