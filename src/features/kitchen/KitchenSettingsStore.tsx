import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PublicStoreSettings } from '../../../contract/shop/types';
import { kitchenApi as api } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';
import { DEFAULT_STORE_SETTINGS } from '../../../contract/shop/defaults';
import { useKitchenToast } from './KitchenNotificationsStore';

interface KitchenSettingsContextType {
  settings: PublicStoreSettings;
  storeLogo: string;
  saveSettings: (s: Partial<PublicStoreSettings> & { kitchenPin?: string; backupServiceAccount?: string }) => Promise<boolean>;
  setStoreLogo: (logo: string) => Promise<void>;
  /** true só durante a primeira carga; uma recarga em segundo plano não acende de novo. */
  loading: boolean;
  /** erro da carga inicial — some assim que as configurações chegam uma vez. */
  error: string | null;
  reload: () => void;
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
    brandPrimaryColor: '',
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

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(
    (isInitial: boolean) => {
      if (isInitial) {
        setLoading(true);
        setError(null);
      }
      Promise.all([
        api.get<{ logo: string }>('/store').then((r) => setStoreLogoState(r.logo)),
        api.get<PublicStoreSettings>('/settings').then(setSettings),
      ])
        .then(() => {
          if (isInitial) setError(null);
        })
        .catch(() => {
          if (isInitial) {
            setError('Não deu para carregar as configurações da loja. Confira a conexão e tente de novo.');
          } else {
            // Recarga em segundo plano (reconexão): mantém as configurações já
            // exibidas na tela e só avisa que elas podem estar desatualizadas.
            triggerToast('Não deu para atualizar as configurações. Mostrando os últimos dados carregados.');
          }
        })
        .finally(() => {
          if (isInitial) setLoading(false);
        });
    },
    [triggerToast]
  );

  const refetch = useCallback(() => fetchSettings(false), [fetchSettings]);
  const loadInitial = useCallback(() => fetchSettings(true), [fetchSettings]);

  const applySettings = useCallback(
    (next: Partial<PublicStoreSettings>) => setSettings((previous) => ({ ...previous, ...next })),
    []
  );

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  useSocketEvent<{ logo: string }>('store:updated', ({ logo }) => setStoreLogoState(logo));

  const saveSettings = useCallback(
    async (s: Partial<PublicStoreSettings> & { kitchenPin?: string; backupServiceAccount?: string }) => {
      // Segredos (PIN, service account) não entram no estado público das configurações.
      const { kitchenPin, backupServiceAccount, ...publicPatch } = s;
      try {
        await api.post('/settings', s);
        setSettings((prev) => ({
          ...prev,
          ...publicPatch,
          ...(kitchenPin ? { kitchenPinSet: true } : {}),
          ...(backupServiceAccount ? { backupKeySet: true } : {}),
        }));
        triggerToast('Configurações salvas.');
        return true;
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao salvar configurações.');
        return false;
      }
    },
    [triggerToast]
  );

  const setStoreLogo = useCallback(
    async (logo: string) => {
      try {
        const res = await api.post<{ logo: string }>('/store/logo', { logo });
        setStoreLogoState(res.logo);
        triggerToast('Logo da loja atualizado.');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao atualizar o logo.');
      }
    },
    [triggerToast]
  );

  const value = useMemo<KitchenSettingsContextType>(
    () => ({ settings, storeLogo, saveSettings, setStoreLogo, loading, error, reload: loadInitial }),
    [settings, storeLogo, saveSettings, setStoreLogo, loading, error, loadInitial]
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
