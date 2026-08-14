import React, { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export const socket: Socket = io('/', {
  autoConnect: true,
  transports: ['websocket', 'polling'],
});

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
