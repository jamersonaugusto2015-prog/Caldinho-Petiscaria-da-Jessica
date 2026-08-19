import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
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
import { CategoryId, Category, Product, OpeningHour } from '../../types';
import { Flame, Sparkles, History, ShoppingBag, Home, ClipboardList, Search, ChevronRight, Clock, Store } from 'lucide-react';

function formatTodayHours(hours: OpeningHour | null): string {
  if (!hours) return 'Fechado hoje';
  return `${hours.open} às ${hours.close}`;
}

export const ClientView: React.FC = () => {
  const { products, categories, selectedCategory, setSelectedCategory, searchQuery, setSearchQuery, settings } = useClientShell();
  const { orders, trackingOrderId, setTrackingOrderId } = useCheckout();
  const { cart, isCartOpen, setIsCartOpen, addToCart, isClosedModalOpen, setClosedModalOpen } = useCart();
  const { total } = useCartTotals();

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [view, setView] = useState<'inicio' | 'pedidos' | 'busca'>('inicio');

  // Promoção do dia: só aparece quando a cozinha marca um produto (de qualquer categoria) e ele está disponível.
  const caldinhoDoDia = products.find((p) => p.isCaldinhoDoDia && p.available) || null;

  // Categorias dinâmicas (do painel da cozinha), com fallback derivado dos produtos
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

  return (
    <div className="space-y-4 pb-28">
      {/* Status da loja (aberta/fechada) */}
      {settings.isOpen ? (
        <div className="flex items-center gap-2 bg-[#ECFDF5] border border-[#A7F3D0] rounded-2xl px-4 py-2.5 text-xs font-extrabold text-[#065F46]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#059669] animate-pulse shrink-0" />
          <Store className="w-4 h-4 shrink-0" />
          <span>Loja aberta — recebendo pedidos agora</span>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 bg-[#FEF3C7] border border-[#FCD34D] rounded-2xl px-4 py-2.5 text-xs font-bold text-[#92400E]">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 shrink-0" />
            <span>Loja fechada no momento</span>
          </div>
          <span className="shrink-0 bg-white border border-[#FCD34D] rounded-full px-2.5 py-1 text-[10px] font-extrabold">
            Hoje: {formatTodayHours(settings.openingHours[new Date().getDay()] ?? null)}
          </span>
        </div>
      )}

      {view === 'inicio' && (
        <>
          {caldinhoDoDia && !searchQuery && selectedCategory === 'all' && (
            <article
              onClick={() => setSelectedProduct(caldinhoDoDia)}
              className="group relative w-full overflow-hidden rounded-2xl bg-[#7F1D1D] shadow-xl shadow-[#B91C1C]/15 transition-all duration-300 active:scale-[0.99]"
            >
              <div className="relative aspect-[16/10] w-full overflow-hidden">
                <img
                  src={caldinhoDoDia.image}
                  alt={caldinhoDoDia.name}
                  className="w-full h-full object-cover saturate-125 contrast-105 sepia-[0.08] transition-transform duration-700 group-hover:scale-105"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />

                <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-[#B91C1C] px-2.5 py-1 text-[8px] font-black uppercase tracking-wider text-white shadow-md">
                  <Flame className="h-3 w-3 fill-[#FDE68A] text-[#FDE68A]" />
                  <span>Promoção do dia</span>
                </div>

                <div className="absolute bottom-3 right-3">
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-4 py-2.5 text-[11px] font-black text-[#B91C1C] shadow-lg active:scale-95 transition">
                    <ShoppingBag className="h-3.5 w-3.5" />
                    <span>Adicionar</span>
                  </span>
                </div>
              </div>
            </article>
          )}

      <div className="grid grid-cols-5 gap-1.5 px-0.5">
        <button
          key="all"
          onClick={() => setSelectedCategory('all')}
          aria-pressed={selectedCategory === 'all'}
          className="flex flex-col items-center gap-1.5 py-2 transition-all active:scale-95"
        >
          <div
            className={`flex h-14 w-14 items-center justify-center rounded-2xl text-xl transition-all ${
              selectedCategory === 'all' ? 'ring-2 ring-[#B91C1C] shadow-md shadow-[#B91C1C]/15' : ''
            }`}
            style={{ backgroundColor: selectedCategory === 'all' ? '#FEE2E2' : '#FEF2F2' }}
          >
            <Sparkles
              className="h-7 w-7"
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
              onClick={() => setSelectedCategory(cat.id)}
              aria-pressed={isSelected}
              className="flex flex-col items-center gap-1.5 py-2 transition-all active:scale-95"
            >
              <div
                className={`flex h-14 w-14 items-center justify-center rounded-2xl text-2xl transition-all ${
                  isSelected ? 'ring-2 ring-[#B91C1C] shadow-md shadow-[#B91C1C]/15' : ''
                }`}
                style={{ backgroundColor: isSelected ? '#FEE2E2' : `${cat.color}1A` }}
              >
                <span>{cat.emoji}</span>
              </div>
              <span
                className={`text-center text-[10px] font-semibold leading-tight ${
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
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-base font-extrabold text-[#1C1917] flex items-center gap-2">
            <span>
              {selectedCategory === 'all'
                ? '⭐ Mais Vendidos & Destaques'
                : categoryList.find((c) => c.id === selectedCategory)?.label}
            </span>
            <span className="text-[11px] text-[#B91C1C] font-bold">({filteredProducts.length})</span>
          </h3>
        </div>

        {filteredProducts.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center text-[#57534E] border border-[#E7E5E4]">
            <p className="text-lg font-bold text-[#1C1917] mb-1">Nenhum produto encontrado</p>
            <p className="text-xs">Tente buscar por outro termo ou escolha outra categoria.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {filteredProducts.map((product) => (
              <ProductCard key={product.id} product={product} onSelect={(p) => setSelectedProduct(p)} />
            ))}
          </div>
        )}
      </div>

      <LoyaltySection />

      {orders.length > 0 && (
        <div className="bg-white rounded-2xl p-5 border border-[#E7E5E4] space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-extrabold text-[#1C1917] flex items-center gap-2">
              <History className="w-4 h-4 text-[#B91C1C]" />
              <span>Histórico de Pedidos</span>
            </h3>
          </div>

          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {orders.map((ord) => (
              <div
                key={ord.id}
                onClick={() => setTrackingOrderId(ord.id)}
                className="bg-[#F5F5F4]/70 hover:bg-[#F5F5F4] p-3.5 rounded-2xl border border-[#E7E5E4] cursor-pointer transition flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-xs text-[#1C1917]">{ord.id}</span>
                    <span
                      className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                        ord.status === 'entregue'
                          ? 'bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]'
                          : ord.status === 'cancelado'
                          ? 'bg-[#F5F5F4] text-[#78716C] border border-[#E7E5E4]'
                          : 'bg-[#FEF2F2] text-[#B91C1C] border border-[#FCA5A5] animate-pulse'
                      }`}
                    >
                      {ord.status.replace('_', ' ').toUpperCase()}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#57534E] mt-0.5">
                    {ord.items.map((i) => i.product.name).join(', ')}
                  </p>
                </div>

                <div className="text-right">
                  <div className="font-extrabold text-xs text-[#B91C1C]">R$ {ord.total.toFixed(2)}</div>
                  <div className="text-[10px] text-[#A8A29E]">
                    {new Date(ord.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedProduct && (
        <ProductModal product={selectedProduct} onClose={() => setSelectedProduct(null)} />
      )}
        </>
      )}

      {view === 'pedidos' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-[#B91C1C]" />
            <h2 className="text-base font-extrabold text-[#1C1917]">Meus Pedidos</h2>
          </div>

          {orders.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center text-[#57534E] border border-[#E7E5E4]">
              <p className="text-lg font-bold text-[#1C1917] mb-1">Nenhum pedido ainda</p>
              <p className="text-xs">Seus pedidos aparecerão aqui para você acompanhar.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map((ord) => (
                <div
                  key={ord.id}
                  onClick={() => setTrackingOrderId(ord.id)}
                  className="bg-white rounded-2xl p-4 border border-[#E7E5E4] shadow-sm cursor-pointer transition hover:border-[#B91C1C]/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-xs text-[#1C1917]">{ord.id}</span>
                      <span
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                          ord.status === 'entregue'
                            ? 'bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]'
                            : ord.status === 'cancelado'
                            ? 'bg-[#F5F5F4] text-[#78716C] border border-[#E7E5E4]'
                            : 'bg-[#FEF2F2] text-[#B91C1C] border border-[#FCA5A5] animate-pulse'
                        }`}
                      >
                        {ord.status.replace('_', ' ').toUpperCase()}
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#A8A29E] shrink-0" />
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[11px] text-[#57534E] truncate pr-2">
                      {ord.items.map((i) => i.product.name).join(', ')}
                    </span>
                    <span className="font-extrabold text-xs text-[#B91C1C] shrink-0">
                      R$ {ord.total.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-[10px] text-[#A8A29E] mt-1">
                    {new Date(ord.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'busca' && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 text-[#A8A29E] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              autoFocus
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar caldinho, petisco, bebida..."
              className="w-full bg-white border border-[#E7E5E4] text-[#1C1917] placeholder-[#A8A29E] text-xs rounded-2xl pl-9 pr-8 py-3 focus:outline-none focus:ring-2 focus:ring-[#B91C1C]"
            />
          </div>

          {searchQuery.trim() === '' ? (
            <div className="bg-white rounded-2xl p-8 text-center text-[#57534E] border border-[#E7E5E4]">
              <p className="text-lg font-bold text-[#1C1917] mb-1">Digite para buscar</p>
              <p className="text-xs">Encontre seu caldinho preferido em segundos.</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center text-[#57534E] border border-[#E7E5E4]">
              <p className="text-lg font-bold text-[#1C1917] mb-1">Nada encontrado</p>
              <p className="text-xs">Tente buscar por outro termo.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {filteredProducts.map((product) => (
                <ProductCard key={product.id} product={product} onSelect={(p) => setSelectedProduct(p)} />
              ))}
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {isCartOpen && <CartDrawer onOpenCheckout={() => setIsCheckoutOpen(true)} />}
      </AnimatePresence>

      {isCheckoutOpen && (
        <CheckoutModal
          onClose={() => setIsCheckoutOpen(false)}
          onOrderPlaced={() => setIsCheckoutOpen(false)}
        />
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

      {/* Barra flutuante Ver Sacola (mobile) — acima da bottom bar */}
      <AnimatePresence>
        {cart.reduce((sum, i) => sum + i.quantity, 0) > 0 && !isCartOpen && (
          <motion.div
            key="cart-fab"
            initial={{ y: 90, opacity: 0, scale: 0.85 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 90, opacity: 0, scale: 0.85 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className="md:hidden fixed z-40 bottom-[calc(env(safe-area-inset-bottom)+88px)] left-1/2 -translate-x-1/2 w-[calc(100%-24px)] max-w-[406px]"
          >
            <button
              onClick={() => setIsCartOpen(true)}
              className="w-full flex items-center justify-between bg-[#B91C1C] hover:bg-[#991B1B] text-white rounded-full py-3.5 px-5 shadow-2xl shadow-[#B91C1C]/40 border border-white/20 transition active:scale-[0.98]"
            >
              <span className="flex items-center gap-2.5 text-sm font-extrabold">
                <span className="relative">
                  <ShoppingBag className="w-5 h-5" />
                  <span className="absolute -top-2 -right-2.5 bg-[#D97706] text-white text-[9px] font-black w-4.5 h-4.5 min-w-[18px] px-1 rounded-full flex items-center justify-center border border-white">
                    {cart.reduce((sum, i) => sum + i.quantity, 0)}
                  </span>
                </span>
                <span>itens</span>
              </span>
              <span className="text-sm font-black flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wide text-[#FDE68A]">Ver Sacola</span>
                <span>R$ {total.toFixed(2)}</span>
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Barra inferior de navegação (somente mobile) */}
      <nav className="md:hidden fixed bottom-0 left-1/2 -translate-x-1/2 z-40 w-full max-w-[430px] bg-white border-t border-[#E7E5E4] pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_24px_rgba(0,0,0,0.10)]">
        <div className="flex items-stretch">
          {(
            [
              { id: 'inicio' as const, label: 'Início', icon: Home },
              { id: 'pedidos' as const, label: 'Pedidos', icon: ClipboardList },
              { id: 'busca' as const, label: 'Busca', icon: Search },
            ]
          ).map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={`relative flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-extrabold transition-all active:scale-95 ${
                  active ? 'text-[#B91C1C]' : 'text-[#A8A29E] hover:text-[#1C1917]'
                }`}
              >
                {active && (
                  <span className="absolute -top-0.5 h-1 w-10 rounded-full bg-[#B91C1C]" />
                )}
                <span
                  className={`flex items-center justify-center rounded-2xl px-4 py-1 transition-all ${
                    active ? 'bg-[#FEF2F2]' : ''
                  }`}
                >
                  <Icon className={`w-5 h-5 ${active ? 'scale-110' : ''}`} strokeWidth={active ? 2.5 : 2} />
                  {item.id === 'pedidos' && orders.length > 0 && (
                    <span className="absolute -top-1 -right-1 bg-[#D97706] text-white text-[8px] font-black min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center border-2 border-white">
                      {orders.length}
                    </span>
                  )}
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
