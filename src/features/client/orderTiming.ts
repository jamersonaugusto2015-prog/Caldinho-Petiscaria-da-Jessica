import { useEffect, useState } from 'react';
import {
  CANCEL_REQUEST_RESPONSE_MINUTES,
  COMPLAINT_WINDOW_HOURS,
  type CancellationRequest,
  type Order,
} from '../../types';

/**
 * O servidor não tem timer: prazo de resposta, atraso e janela de reclamação
 * são calculados na tela. Este relógio faz a tela reagir sozinha ao tempo passar.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Data ISO vinda do servidor pode faltar ou vir quebrada: nesse caso não há prazo. */
function parseTime(iso?: string): number | null {
  if (!iso) return null;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : null;
}

export function cancelRequestDeadline(request?: CancellationRequest): number | null {
  const requestedAt = parseTime(request?.requestedAt);
  if (requestedAt == null) return null;
  return requestedAt + CANCEL_REQUEST_RESPONSE_MINUTES * 60000;
}

export function isCancelRequestExpired(request: CancellationRequest | undefined, now: number): boolean {
  if (!request || request.status !== 'pendente') return false;
  const deadline = cancelRequestDeadline(request);
  return deadline != null && now > deadline;
}

/** Minutos que faltam para o prazo, nunca negativo. */
export function minutesLeft(deadline: number | null, now: number): number {
  if (deadline == null) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 60000));
}

export function isOrderLate(order: Order, now: number): boolean {
  if (order.status === 'entregue' || order.status === 'cancelado') return false;
  const createdAt = parseTime(order.createdAt);
  if (createdAt == null || !order.estimatedDeliveryMinutes) return false;
  return now > createdAt + order.estimatedDeliveryMinutes * 60000;
}

export function canOpenComplaint(order: Order, now: number): boolean {
  if (order.status !== 'entregue' || order.complaint) return false;
  const createdAt = parseTime(order.createdAt);
  if (createdAt == null) return false;
  return now < createdAt + COMPLAINT_WINDOW_HOURS * 3600000;
}

export function formatShortDate(iso?: string): string {
  const value = parseTime(iso);
  if (value == null) return '';
  return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
