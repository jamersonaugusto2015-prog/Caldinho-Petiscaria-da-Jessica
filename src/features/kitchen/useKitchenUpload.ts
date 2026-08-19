import { useCallback } from 'react';
import { kitchenApi as api } from '../../lib/api';
import { useKitchenToast } from './KitchenNotificationsStore';

/** Uploading holds no state, so it stays a plain hook instead of a store. */
export const useKitchenUpload = () => {
  const triggerToast = useKitchenToast();

  return useCallback(
    async (dataUrl: string, filename?: string): Promise<string | null> => {
      try {
        const res = await api.post<{ url: string }>('/upload', { dataUrl, filename });
        return res.url;
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao enviar imagem.');
        return null;
      }
    },
    [triggerToast]
  );
};
