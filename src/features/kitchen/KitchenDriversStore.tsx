import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Driver } from '../../types';
import { kitchenApi as api } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';
import { useKitchenToast } from './KitchenNotificationsStore';

interface KitchenDriversContextType {
  drivers: Driver[];
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

  const refetch = useCallback(() => {
    api.get<Driver[]>('/drivers').then(setDrivers).catch(() => {});
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useSocketEvent('drivers:updated', refetch);

  const createDriver = useCallback(
    async (data: Pick<Driver, 'name' | 'phone' | 'password' | 'bikeModel' | 'plate' | 'active'>) => {
      try {
        const created = await api.post<Driver>('/drivers', data);
        setDrivers((prev) => [...prev, created]);
        triggerToast(`🛵 Motoboy ${created.name} cadastrado!`);
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
        triggerToast('✅ Motoboy atualizado!');
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
        triggerToast('🗑️ Motoboy removido.');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao remover motoboy.');
      }
    },
    [triggerToast]
  );

  const value = useMemo<KitchenDriversContextType>(
    () => ({ drivers, createDriver, updateDriver, deleteDriver }),
    [drivers, createDriver, updateDriver, deleteDriver]
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
