import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Pin, Soup, X } from 'lucide-react';
import { logout } from '../../lib/auth';
import { useKitchenSettings } from './KitchenSettingsStore';
import { useKitchenShell } from './KitchenShellStore';
import { KITCHEN_ALERT_TABS, useKitchenNavCounts } from './useKitchenNavCounts';
import { KITCHEN_NAV, type KitchenTab } from './kitchenTabs';

export const KitchenSidebar: React.FC<{
  activeTab: KitchenTab;
  setActiveTab: (tab: KitchenTab) => void;
}> = ({ activeTab, setActiveTab }) => {
  const navigate = useNavigate();
  const { settings, storeLogo } = useKitchenSettings();
  const { railPinned, toggleRailPin, navOpen, closeNav } = useKitchenShell();
  const counts = useKitchenNavCounts();

  // Aberto por hover, por foco de teclado, por escolha (pin) ou pela gaveta do celular.
  const [hovering, setHovering] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const open = railPinned || hovering || focusInside || navOpen;

  const handleLogout = () => {
    logout('kitchen');
    navigate('/');
  };

  const pick = (tab: KitchenTab) => {
    setActiveTab(tab);
    closeNav();
  };

  const fade = `k-rail-fade whitespace-nowrap ${
    open ? 'opacity-100 translate-x-0' : 'pointer-events-none -translate-x-1 opacity-0'
  }`;

  return (
    <>
      <div
        aria-hidden
        onClick={closeNav}
        className={`fixed inset-0 z-30 bg-[#0C0A09]/70 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden ${
          navOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <aside
        aria-label="Navegação do painel"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocusCapture={() => setFocusInside(true)}
        onBlurCapture={() => setFocusInside(false)}
        className={[
          'k-rail fixed inset-y-0 left-0 z-40 flex w-[276px] flex-col overflow-hidden',
          'border-r border-white/[0.07] bg-[#131110] text-white',
          'transition-[width,transform,box-shadow] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
          navOpen ? 'translate-x-0 shadow-[0_32px_80px_-24px_rgba(0,0,0,0.85)]' : '-translate-x-full',
          'lg:translate-x-0',
          open ? 'lg:w-[276px]' : 'lg:w-[76px]',
          open && !railPinned ? 'lg:shadow-[0_32px_80px_-24px_rgba(0,0,0,0.85)]' : 'lg:shadow-none',
        ].join(' ')}
      >
        <div className="flex h-[68px] shrink-0 items-center border-b border-white/[0.07] pr-3">
          <span className="flex w-[76px] shrink-0 items-center justify-center">
            {storeLogo ? (
              <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.06]">
                <img src={storeLogo} alt="" className="h-full w-full object-contain p-0.5" />
              </span>
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#B91C1C] shadow-[0_6px_16px_-6px_rgba(185,28,28,0.9)]">
                <Soup className="h-[19px] w-[19px] text-white" />
              </span>
            )}
          </span>

          <div className={`min-w-0 flex-1 ${fade}`}>
            <div className="truncate text-sm font-extrabold leading-tight tracking-tight">
              {settings.storeName}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#78716C]">
              Painel da cozinha
            </div>
          </div>

          <button
            type="button"
            onClick={toggleRailPin}
            aria-pressed={railPinned}
            title={railPinned ? 'Soltar o menu — volta a fechar sozinho' : 'Fixar o menu aberto'}
            className={`hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-[#F87171]/70 lg:flex ${
              railPinned
                ? 'bg-[#B91C1C]/25 text-[#FCA5A5]'
                : 'text-[#78716C] hover:bg-white/[0.07] hover:text-white'
            } ${fade}`}
          >
            <Pin
              className={`h-4 w-4 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                railPinned ? 'rotate-0 fill-current' : 'rotate-45'
              }`}
            />
          </button>

          <button
            type="button"
            onClick={closeNav}
            title="Fechar menu"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#A8A29E] transition-colors duration-200 hover:bg-white/[0.07] hover:text-white lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="k-rail-scroll flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3">
          {KITCHEN_NAV.map((group, groupIndex) => (
            <div key={group.id}>
              <div className="relative h-9">
                <span
                  className={`absolute bottom-1 left-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#78716C] ${fade}`}
                >
                  {group.label}
                </span>
                {groupIndex > 0 && (
                  <span
                    aria-hidden
                    className={`absolute inset-x-2 bottom-[18px] h-px bg-white/[0.07] transition-opacity duration-200 ${
                      open ? 'opacity-0' : 'opacity-100'
                    }`}
                  />
                )}
              </div>

              <div className="space-y-0.5">
                {group.items.map((item, itemIndex) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  const count = counts[item.id] ?? 0;
                  const alerting = KITCHEN_ALERT_TABS.includes(item.id) && count > 0;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => pick(item.id)}
                      title={item.label}
                      aria-current={active ? 'page' : undefined}
                      className={`group relative flex h-11 w-full items-center rounded-xl outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-[#F87171]/70 ${
                        active
                          ? 'bg-[#B91C1C]/20 text-white'
                          : 'text-[#A8A29E] hover:bg-white/[0.06] hover:text-white'
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[#EF4444] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                          active ? 'scale-y-100' : 'scale-y-0'
                        }`}
                      />

                      <span className="relative flex h-11 w-[52px] shrink-0 items-center justify-center">
                        <Icon
                          className={`h-[18px] w-[18px] transition-colors duration-200 ${
                            active ? 'text-[#F87171]' : ''
                          }`}
                        />
                        {count > 0 && (
                          <span
                            aria-hidden
                            className={`absolute right-2 top-1.5 h-2 w-2 rounded-full ring-2 ring-[#131110] transition-opacity duration-200 ${
                              alerting ? 'bg-[#EF4444]' : 'bg-[#78716C]'
                            } ${open ? 'opacity-0' : 'opacity-100'}`}
                          />
                        )}
                      </span>

                      <span
                        className={`flex-1 text-left text-[13px] font-bold ${fade}`}
                        style={{ transitionDelay: open ? `${Math.min(itemIndex * 18, 90)}ms` : '0ms' }}
                      >
                        {item.label}
                      </span>

                      {count > 0 && (
                        <span
                          key={count}
                          className={`k-badge-pop mr-3 rounded-full px-2 py-0.5 text-[10px] font-black tabular-nums ${
                            alerting
                              ? 'bg-[#EF4444] text-white'
                              : active
                                ? 'bg-white/20 text-white'
                                : 'bg-white/[0.08] text-[#D6D3D1]'
                          } ${fade}`}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-white/[0.07] p-3">
          <button
            type="button"
            onClick={handleLogout}
            title="Sair do painel"
            className="flex h-11 w-full items-center rounded-xl text-[#A8A29E] outline-none transition-colors duration-200 hover:bg-[#B91C1C]/20 hover:text-[#FCA5A5] focus-visible:ring-2 focus-visible:ring-[#F87171]/70"
          >
            <span className="flex h-11 w-[52px] shrink-0 items-center justify-center">
              <LogOut className="h-[18px] w-[18px]" />
            </span>
            <span className={`text-[13px] font-bold ${fade}`}>Sair do painel</span>
          </button>
        </div>
      </aside>
    </>
  );
};
