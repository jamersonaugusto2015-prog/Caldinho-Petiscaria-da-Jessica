import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { PublicStoreSettings } from '../../types';
import { kitchenApi as api } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';
import { DEFAULT_STORE_SETTINGS } from '../../shared/defaults';
import { useKitchenToast } from './KitchenNotificationsStore';

interface KitchenSettingsContextType {
  settings: PublicStoreSettings;
  storeLogo: string;
  saveSettings: (s: Partial<PublicStoreSettings> & { kitchenPin?: string; backupServiceAccount?: string }) => Promise<void>;
  setStoreLogo: (logo: string) => Promise<void>;
}

interface KitchenSettingsSyncContextType {
  applySettings: (next: Partial<PublicStoreSettings>) => void;
  refetch: () => void;
}

const KitchenSettingsContext = createContext<KitchenSettingsContextType | undefined>(undefined);
const KitchenSettingsSyncContext = createContext<KitchenSettingsSyncContextType | undefined>(undefined);

export const KitchenSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const triggerToast = useKitchenToast();
  const [storeLogo, setStoreLogoState] = useState('');
  const [settings, setSettings] = useState<PublicStoreSettings>({
    ...DEFAULT_STORE_SETTINGS,
    kitchenPinSet: false,
    isOpen: true,
    pixEnabled: false,
    mercadoPagoConnected: false,
    mercadoPagoOAuthReady: false,
    mercadoPagoTestMode: false,
    mercadoPagoPublicKey: '',
    mercadoPagoUserId: '',
    backupEnabled: false,
    backupFrequencyDays: 1,
    backupFolderId: '',
    backupKeySet: false,
    backupLastRun: '',
    backupLastStatus: '',
    backupLastFile: '',
  });

  const refetch = useCallback(() => {
    api
      .get<{ logo: string }>('/store')
      .then((r) => setStoreLogoState(r.logo))
      .catch(() => {});
    api.get<PublicStoreSettings>('/settings').then(setSettings).catch(() => {});
  }, []);

  const applySettings = useCallback(
    (next: Partial<PublicStoreSettings>) => setSettings((previous) => ({ ...previous, ...next })),
    []
  );

  useEffect(() => {
    refetch();
  }, [refetch]);

  useSocketEvent<{ logo: string }>('store:updated', ({ logo }) => setStoreLogoState(logo));

  const saveSettings = useCallback(
    async (s: Partial<PublicStoreSettings> & { kitchenPin?: string; backupServiceAccount?: string }) => {
      try {
        await api.post('/settings', s);
        setSettings((prev) => ({ ...prev, ...s }));
        triggerToast('⚙️ Configurações salvas!');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao salvar configurações.');
      }
    },
    [triggerToast]
  );

  const setStoreLogo = useCallback(
    async (logo: string) => {
      try {
        const res = await api.post<{ logo: string }>('/store/logo', { logo });
        setStoreLogoState(res.logo);
        triggerToast('🏷️ Logo da loja atualizado!');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao atualizar o logo.');
      }
    },
    [triggerToast]
  );

  const value = useMemo<KitchenSettingsContextType>(
    () => ({ settings, storeLogo, saveSettings, setStoreLogo }),
    [settings, storeLogo, saveSettings, setStoreLogo]
  );

  const sync = useMemo<KitchenSettingsSyncContextType>(
    () => ({ applySettings, refetch }),
    [applySettings, refetch]
  );

  return (
    <KitchenSettingsSyncContext.Provider value={sync}>
      <KitchenSettingsContext.Provider value={value}>{children}</KitchenSettingsContext.Provider>
    </KitchenSettingsSyncContext.Provider>
  );
};

export const useKitchenSettings = () => {
  const context = useContext(KitchenSettingsContext);
  if (!context) throw new Error('useKitchenSettings deve ser usado dentro de KitchenProvider');
  return context;
};

export const useKitchenSettingsSync = () => {
  const context = useContext(KitchenSettingsSyncContext);
  if (!context) throw new Error('useKitchenSettingsSync deve ser usado dentro de KitchenProvider');
  return context;
};
