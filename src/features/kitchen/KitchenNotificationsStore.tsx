import React from 'react';
import { AlertBannerProvider, useAlertBanner } from '../../ui/alertBanner';
import type { AlertUrgency } from '../../../contract/order/alerts';
type TriggerToast = (msg: string, urgency?: AlertUrgency) => void;

/**
 * A faixa da cozinha é a faixa compartilhada.
 *
 * Os nomes continuam os mesmos porque nove lojas de estado chamam
 * `useKitchenToast(msg)`; o que mudou é o que está atrás — o temporizador e a
 * região viva agora são os mesmos do cliente e do motoboy.
 */
export const KitchenNotificationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AlertBannerProvider>{children}</AlertBannerProvider>
);

export const useKitchenToast = (): TriggerToast => useAlertBanner();

