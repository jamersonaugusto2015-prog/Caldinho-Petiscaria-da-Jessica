import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useAlertChannel, type AlertChannel, type SystemPermission } from '../../lib/alertChannel';
import { bannerTextFor, useAlertBanner } from '../../ui/alertBanner';
import type { OrderAlert } from '../../../contract/order/alerts';
import { useKitchenSettings } from './KitchenSettingsStore';

interface KitchenSoundContextType {
  soundEnabled: boolean;
  toggleSound: () => void;
  /** Toca o alerta configurado, sem faixa: o teste ao ligar o som. */
  previewSound: () => void;
  requestSystemPermission: () => Promise<SystemPermission>;
}

interface KitchenAlertContextType {
  /** Entrega o que a tabela decidiu. `null` (a resposta mais comum) não faz nada. */
  deliver: (alert: OrderAlert | null) => void;
  channel: AlertChannel;
}

const KitchenSoundContext = createContext<KitchenSoundContextType | undefined>(undefined);
const KitchenAlertContext = createContext<KitchenAlertContextType | undefined>(undefined);

export const KitchenSoundProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { settings } = useKitchenSettings();
  const triggerToast = useAlertBanner();
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      return localStorage.getItem('ce_kitchen_sound') !== 'off';
    } catch {
      return true;
    }
  });

  // A loja continua dona do botão e do áudio da loja; ela só não decide mais o
  // que tocar. Os valores vão para o canal como getters porque a entrega parte
  // de um handler de socket, que capturaria um valor velho.
  const channel = useAlertChannel({
    soundEnabled: () => soundEnabled,
    customSoundUrl: () => settings.orderSoundUrl,
    onBanner: (alert) => triggerToast(bannerTextFor(alert), alert.urgency),
  });

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

  const value = useMemo<KitchenSoundContextType>(
    () => ({
      soundEnabled,
      toggleSound,
      previewSound: channel.preview,
      requestSystemPermission: channel.requestSystemPermission,
    }),
    [channel, soundEnabled, toggleSound]
  );

  const alerts = useMemo<KitchenAlertContextType>(
    () => ({ deliver: channel.deliver, channel }),
    [channel]
  );

  return (
    <KitchenAlertContext.Provider value={alerts}>
      <KitchenSoundContext.Provider value={value}>{children}</KitchenSoundContext.Provider>
    </KitchenAlertContext.Provider>
  );
};

export const useKitchenSound = () => {
  const context = useContext(KitchenSoundContext);
  if (!context) throw new Error('useKitchenSound deve ser usado dentro de KitchenProvider');
  return context;
};

export const useKitchenSoundAlert = () => {
  const context = useContext(KitchenAlertContext);
  if (!context) throw new Error('useKitchenSoundAlert deve ser usado dentro de KitchenProvider');
  return context;
};
