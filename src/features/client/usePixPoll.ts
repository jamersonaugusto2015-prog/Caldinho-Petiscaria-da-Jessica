import { useEffect, useRef, useState } from 'react';
import type { Order } from '../../../contract/order/types';
import { api } from '../../lib/api';

const POLL_INTERVAL_MS = 4000;
const MAX_ATTEMPTS = 12;
const MAX_BACKOFF_MS = 30000;

interface UsePixPaymentPollOptions {
  orderId: string | undefined;
  customerId: string;
  mpPaymentId: string | undefined;
  isPaid: boolean;
  /** Pedido cancelado não tem mais pagamento a confirmar: o poll para. */
  isCanceled?: boolean;
  onUpdate: (order: Order) => void;
}

interface UsePixPaymentPollResult {
  /** true quando o polling desistiu após falhas repetidas; use retry() para tentar de novo. */
  failed: boolean;
  retry: () => void;
}

/**
 * Poll de status do pagamento PIX compartilhado entre CheckoutModal e OrderTrackingModal,
 * para que as duas telas nunca fiquem com implementações divergentes (uma delas descartando
 * a resposta, ou tentando de novo sem limite após falha).
 */
export function usePixPaymentPoll({
  orderId,
  customerId,
  mpPaymentId,
  isPaid,
  isCanceled = false,
  onUpdate,
}: UsePixPaymentPollOptions): UsePixPaymentPollResult {
  const [failed, setFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!orderId || !mpPaymentId || isPaid || isCanceled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    setFailed(false);

    const scheduleNext = (delay: number) => {
      timer = setTimeout(() => void tick(), delay);
    };

    const tick = async () => {
      try {
        const updated = await api.get<Order>(
          `/orders/${orderId}/pix-status?customerId=${encodeURIComponent(customerId)}`
        );
        if (cancelled) return;
        attempts = 0;
        onUpdateRef.current(updated);
        if (!updated.payment.isPaid) scheduleNext(POLL_INTERVAL_MS);
      } catch {
        if (cancelled) return;
        attempts += 1;
        if (attempts > MAX_ATTEMPTS) {
          setFailed(true);
          return;
        }
        scheduleNext(Math.min(POLL_INTERVAL_MS * 2 ** attempts, MAX_BACKOFF_MS));
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [orderId, mpPaymentId, isPaid, isCanceled, customerId, retryTick]);

  return { failed, retry: () => setRetryTick((t) => t + 1) };
}
