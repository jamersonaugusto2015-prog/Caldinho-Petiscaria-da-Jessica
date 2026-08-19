import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const PIN_KEY = 'ce_kitchen_rail_pinned';

interface KitchenShellContextType {
  /** Rail fixo aberto por escolha do usuário (persistido). */
  railPinned: boolean;
  toggleRailPin: () => void;
  /** Gaveta de navegação no celular. */
  navOpen: boolean;
  openNav: () => void;
  closeNav: () => void;
}

const KitchenShellContext = createContext<KitchenShellContextType | undefined>(undefined);

export const KitchenShellProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [railPinned, setRailPinned] = useState(() => {
    try {
      return localStorage.getItem(PIN_KEY) === 'on';
    } catch {
      return false;
    }
  });
  const [navOpen, setNavOpen] = useState(false);

  const toggleRailPin = useCallback(() => {
    setRailPinned((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PIN_KEY, next ? 'on' : 'off');
      } catch {
        /* ignora */
      }
      return next;
    });
  }, []);

  const openNav = useCallback(() => setNavOpen(true), []);
  const closeNav = useCallback(() => setNavOpen(false), []);

  // A gaveta só existe abaixo de lg: ao passar para desktop ela precisa sumir,
  // senão o rail acorda expandido sem ninguém ter pedido.
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const sync = () => {
      if (desktop.matches) setNavOpen(false);
    };
    sync();
    desktop.addEventListener('change', sync);
    return () => desktop.removeEventListener('change', sync);
  }, []);

  // Gaveta aberta trava a rolagem do fundo e responde ao Esc.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [navOpen]);

  const value = useMemo<KitchenShellContextType>(
    () => ({ railPinned, toggleRailPin, navOpen, openNav, closeNav }),
    [railPinned, toggleRailPin, navOpen, openNav, closeNav]
  );

  return <KitchenShellContext.Provider value={value}>{children}</KitchenShellContext.Provider>;
};

export const useKitchenShell = () => {
  const context = useContext(KitchenShellContext);
  if (!context) throw new Error('useKitchenShell deve ser usado dentro de KitchenShellProvider');
  return context;
};
