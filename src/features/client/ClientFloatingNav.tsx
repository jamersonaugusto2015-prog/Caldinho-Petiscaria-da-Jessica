import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Home, ClipboardList, Search, ShoppingBag } from 'lucide-react';
import { formatMoney } from '../../../contract/pricing/money';

export type ClientTab = 'inicio' | 'pedidos' | 'busca';

interface ClientFloatingNavProps {
  view: ClientTab;
  onChangeView: (view: ClientTab) => void;
  onOpenCart: () => void;
  cartCount: number;
  cartTotal: number;
  activeOrderCount: number;
}

export const ClientFloatingNav: React.FC<ClientFloatingNavProps> = ({
  view,
  onChangeView,
  onOpenCart,
  cartCount,
  cartTotal,
  activeOrderCount,
}) => {
  const reduceMotion = useReducedMotion();

  return (
    <motion.nav
      initial={reduceMotion ? false : { y: 64, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28, delay: 0.15 }}
      className="fixed z-40 bottom-[calc(env(safe-area-inset-bottom)+14px)] left-1/2 -translate-x-1/2 w-[calc(100%-28px)] max-w-[402px]"
      aria-label="Navegação principal"
    >
      <div className="client-blob-nav grid grid-cols-4 items-end gap-0.5 rounded-[28px] border border-white/70 bg-white/80 p-1.5 shadow-[0_18px_50px_rgba(28,25,23,0.18),0_2px_8px_rgba(28,25,23,0.06)] backdrop-blur-2xl">
        <NavTab
          label="Início"
          icon={Home}
          active={view === 'inicio'}
          onClick={() => onChangeView('inicio')}
        />
        <NavTab
          label="Pedidos"
          icon={ClipboardList}
          active={view === 'pedidos'}
          onClick={() => onChangeView('pedidos')}
          badge={activeOrderCount > 0 ? activeOrderCount : undefined}
        />

        <motion.button
          type="button"
          onClick={onOpenCart}
          aria-label={
            cartCount > 0
              ? `Abrir sacola, ${cartCount} itens, ${formatMoney(cartTotal)}`
              : 'Abrir sacola'
          }
          whileTap={reduceMotion ? undefined : { scale: 0.9 }}
          whileHover={reduceMotion ? undefined : { scale: 1.03 }}
          className="relative -mt-5 mb-0.5 flex h-[58px] w-full flex-col items-center justify-center justify-self-center rounded-full bg-[#B91C1C] text-white shadow-[0_12px_28px_rgba(185,28,28,0.45),0_2px_6px_rgba(127,29,29,0.35)] ring-[3px] ring-white"
          style={{ maxWidth: 58 }}
        >
          <ShoppingBag className="h-5 w-5" strokeWidth={2.5} />
          {cartCount > 0 ? (
            <>
              <span className="mt-0.5 text-[9px] font-black leading-none tabular-nums">
                R$ {cartTotal.toFixed(0)}
              </span>
              <AnimatePresence>
                <motion.span
                  key={cartCount}
                  initial={reduceMotion ? false : { scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#D97706] px-1 text-[9px] font-black tabular-nums ring-2 ring-white"
                >
                  {cartCount}
                </motion.span>
              </AnimatePresence>
            </>
          ) : (
            <span className="mt-0.5 text-[9px] font-extrabold leading-none text-white/85">Sacola</span>
          )}
        </motion.button>

        <NavTab
          label="Busca"
          icon={Search}
          active={view === 'busca'}
          onClick={() => onChangeView('busca')}
        />
      </div>
    </motion.nav>
  );
};

const NavTab: React.FC<{
  label: string;
  icon: typeof Home;
  active: boolean;
  onClick: () => void;
  badge?: number;
}> = ({ label, icon: Icon, active, onClick, badge }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`relative flex h-12 w-full flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-extrabold transition active:scale-95 ${
        active ? 'text-[#B91C1C]' : 'text-[#78716C]'
      }`}
    >
      {active && (
        <motion.span
          layoutId="client-nav-blob"
          className="absolute inset-y-1 inset-x-0.5 rounded-[18px] bg-[#FEF2F2] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        />
      )}
      <span className="relative z-10 flex items-center justify-center">
        <Icon className={`h-[18px] w-[18px] ${active ? 'scale-105' : ''}`} strokeWidth={active ? 2.6 : 2.1} />
        {badge != null && (
          <span className="absolute -right-2.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#D97706] px-1 text-[8px] font-black text-white">
            {badge}
          </span>
        )}
      </span>
      <span className="relative z-10 leading-none">{label}</span>
    </button>
  );
};
