import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { playNewOrderSound, announceNewOrder, playOrderMp3, unlockAudio } from '../../lib/sound';
import { useKitchenSettings } from './KitchenSettingsStore';

interface KitchenSoundContextType {
  soundEnabled: boolean;
  toggleSound: () => void;
}

interface KitchenSoundAlertContextType {
  announceOrder: (orderId: string) => void;
}

const KitchenSoundContext = createContext<KitchenSoundContextType | undefined>(undefined);
const KitchenSoundAlertContext = createContext<KitchenSoundAlertContextType | undefined>(undefined);

export const KitchenSoundProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { settings } = useKitchenSettings();
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      return localStorage.getItem('ce_kitchen_sound') !== 'off';
    } catch {
      return true;
    }
  });

  // The announcement fires from a socket handler, so it reads the latest values
  // through refs instead of capturing them.
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const orderSoundUrlRef = useRef(settings.orderSoundUrl);
  orderSoundUrlRef.current = settings.orderSoundUrl;

  useEffect(() => {
    unlockAudio();
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('ce_kitchen_sound', next ? 'on' : 'off');
      } catch {
        /* ignora */
      }
      return next;
    });
  }, []);

  const announceOrder = useCallback((orderId: string) => {
    if (!soundEnabledRef.current) return;
    if (orderSoundUrlRef.current) {
      playOrderMp3(orderSoundUrlRef.current);
    } else {
      playNewOrderSound();
      announceNewOrder(orderId);
    }
  }, []);

  const value = useMemo<KitchenSoundContextType>(
    () => ({ soundEnabled, toggleSound }),
    [soundEnabled, toggleSound]
  );

  const alert = useMemo<KitchenSoundAlertContextType>(() => ({ announceOrder }), [announceOrder]);

  return (
    <KitchenSoundAlertContext.Provider value={alert}>
      <KitchenSoundContext.Provider value={value}>{children}</KitchenSoundContext.Provider>
    </KitchenSoundAlertContext.Provider>
  );
};

export const useKitchenSound = () => {
  const context = useContext(KitchenSoundContext);
  if (!context) throw new Error('useKitchenSound deve ser usado dentro de KitchenProvider');
  return context;
};

export const useKitchenSoundAlert = () => {
  const context = useContext(KitchenSoundAlertContext);
  if (!context) throw new Error('useKitchenSoundAlert deve ser usado dentro de KitchenProvider');
  return context;
};
