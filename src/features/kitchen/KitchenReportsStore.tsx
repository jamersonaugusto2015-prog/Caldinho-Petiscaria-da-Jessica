import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { RevenueTrends, SalesReport } from '../../../contract/report/types';
import { kitchenApi as api } from '../../lib/api';

interface KitchenReportsContextType {
  report: SalesReport | null;
  trends: RevenueTrends | null;
  /** Erro da última carga — some quando os dados chegam. Sem isto o painel
   *  mostrava "Sem dados." numa queda de rede, e o dono lia "vendi nada". */
  error: string | null;
  reload: () => void;
  loadReport: (from?: string, to?: string) => Promise<void>;
  loadTrends: () => Promise<void>;
}

interface KitchenReportsSyncContextType {
  loadReport: (from?: string, to?: string) => Promise<void>;
  loadTrends: () => Promise<void>;
  refetch: () => void;
}

const KitchenReportsContext = createContext<KitchenReportsContextType | undefined>(undefined);
const KitchenReportsSyncContext = createContext<KitchenReportsSyncContextType | undefined>(undefined);

export const KitchenReportsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [report, setReport] = useState<SalesReport | null>(null);
  const [trends, setTrends] = useState<RevenueTrends | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTrends = useCallback(async () => {
    try {
      const t = await api.get<RevenueTrends>('/reports/trends');
      setTrends(t);
    } catch {
      setError('Não deu para carregar os relatórios.');
    }
  }, []);

  const loadReport = useCallback(async (from?: string, to?: string) => {
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      const r = await api.get<SalesReport>(`/reports${qs ? `?${qs}` : ''}`);
      setReport(r);
      setError(null);
    } catch {
      setError('Não deu para carregar os relatórios.');
    }
  }, []);

  const refetch = useCallback(() => {
    void loadReport();
    void loadTrends();
  }, [loadReport, loadTrends]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const value = useMemo<KitchenReportsContextType>(
    () => ({ report, trends, error, reload: refetch, loadReport, loadTrends }),
    [report, trends, error, refetch, loadReport, loadTrends]
  );

  const sync = useMemo<KitchenReportsSyncContextType>(
    () => ({ loadReport, loadTrends, refetch }),
    [loadReport, loadTrends, refetch]
  );

  return (
    <KitchenReportsSyncContext.Provider value={sync}>
      <KitchenReportsContext.Provider value={value}>{children}</KitchenReportsContext.Provider>
    </KitchenReportsSyncContext.Provider>
  );
};

export const useKitchenReports = () => {
  const context = useContext(KitchenReportsContext);
  if (!context) throw new Error('useKitchenReports deve ser usado dentro de KitchenProvider');
  return context;
};

export const useKitchenReportsSync = () => {
  const context = useContext(KitchenReportsSyncContext);
  if (!context) throw new Error('useKitchenReportsSync deve ser usado dentro de KitchenProvider');
  return context;
};
