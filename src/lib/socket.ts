import React, { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export const socket: Socket = io('/', {
  autoConnect: true,
  transports: ['websocket', 'polling'],
});

// Rede de celular: quando o app WhatsApp/Instagram joga a webview pra trás
// (aba oculta) o navegador reduz os timers e o backoff automático do
// socket.io pode demorar minutos pra perceber que a conexão caiu. Ao voltar
// pra frente, ou quando o SO avisa que a rede voltou, força uma tentativa
// imediata em vez de esperar o próximo timer de reconexão. connect() é
// no-op se o socket já estiver conectado ou tentando conectar.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !socket.connected) {
      socket.connect();
    }
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (!socket.connected) socket.connect();
  });
}

export function useSocketEvent<T>(event: string, handler: (data: T) => void): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    const fn = (data: T) => ref.current(data);
    socket.on(event, fn);
    return () => {
      socket.off(event, fn);
    };
  }, [event]);
}
