import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Driver } from '../../../contract/driver/types';
import { kitchenApi as api } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';
import { useKitchenToast } from './KitchenNotificationsStore';

interface KitchenDriversContextType {
  drivers: Driver[];
  /** true só durante a primeira carga; uma recarga em segundo plano não acende de novo. */
  loading: boolean;
  /** erro da carga inicial — some assim que os motoboys chegam uma vez. */
  error: string | null;
  reload: () => void;
  createDriver: (d: Pick<Driver, 'name' | 'phone' | 'password' | 'bikeModel' | 'plate' | 'active'>) => Promise<void>;
  updateDriver: (id: string, patch: Partial<Driver>) => Promise<void>;
  deleteDriver: (id: string) => Promise<void>;
}

interface KitchenDriversSyncContextType {
  refetch: () => void;
}

const KitchenDriversContext = createContext<KitchenDriversContextType | undefined>(undefined);
const KitchenDriversSyncContext = createContext<KitchenDriversSyncContextType | undefined>(undefined);

export const KitchenDriversProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const triggerToast = useKitchenToast();
  const [drivers, setDrivers] = useState<Driver[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDrivers = useCallback(
    (isInitial: boolean) => {
      if (isInitial) {
        setLoading(true);
        setError(null);
      }
      api
        .get<Driver[]>('/drivers')
        .then((list) => {
          setDrivers(list);
          if (isInitial) setError(null);
        })
        .catch(() => {
          if (isInitial) {
            setError('Não deu para carregar os motoboys. Confira a conexão e tente de novo.');
          } else {
            triggerToast('Não deu para atualizar os motoboys. Mostrando os últimos carregados.');
          }
        })
        .finally(() => {
          if (isInitial) setLoading(false);
        });
    },
    [triggerToast]
  );

  const refetch = useCallback(() => fetchDrivers(false), [fetchDrivers]);
  const loadInitial = useCallback(() => fetchDrivers(true), [fetchDrivers]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  useSocketEvent('drivers:updated', refetch);

  const createDriver = useCallback(
    async (data: Pick<Driver, 'name' | 'phone' | 'password' | 'bikeModel' | 'plate' | 'active'>) => {
      try {
        const created = await api.post<Driver>('/drivers', data);
        setDrivers((prev) => [...prev, created]);
        triggerToast(`Motoboy ${created.name} cadastrado.`);
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao criar motoboy.');
      }
    },
    [triggerToast]
  );

  const updateDriver = useCallback(
    async (id: string, patch: Partial<Driver>) => {
      try {
        const updated = await api.patch<Driver>(`/drivers/${id}`, patch);
        setDrivers((prev) => prev.map((d) => (d.id === id ? updated : d)));
        triggerToast('Motoboy atualizado.');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao atualizar motoboy.');
      }
    },
    [triggerToast]
  );

  const deleteDriver = useCallback(
    async (id: string) => {
      try {
        await api.delete(`/drivers/${id}`);
        setDrivers((prev) => prev.filter((d) => d.id !== id));
        triggerToast('Motoboy removido.');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao remover motoboy.');
      }
    },
    [triggerToast]
  );

  const value = useMemo<KitchenDriversContextType>(
    () => ({ drivers, loading, error, reload: loadInitial, createDriver, updateDriver, deleteDriver }),
    [drivers, loading, error, loadInitial, createDriver, updateDriver, deleteDriver]
  );

  const sync = useMemo<KitchenDriversSyncContextType>(() => ({ refetch }), [refetch]);

  return (
    <KitchenDriversSyncContext.Provider value={sync}>
      <KitchenDriversContext.Provider value={value}>{children}</KitchenDriversContext.Provider>
    </KitchenDriversSyncContext.Provider>
  );
};

export const useKitchenDrivers = () => {
  const context = useContext(KitchenDriversContext);
  if (!context) throw new Error('useKitchenDrivers deve ser usado dentro de KitchenProvider');
  return context;
};

export const useKitchenDriversSync = () => {
  const context = useContext(KitchenDriversSyncContext);
  if (!context) throw new Error('useKitchenDriversSync deve ser usado dentro de KitchenProvider');
  return context;
};
