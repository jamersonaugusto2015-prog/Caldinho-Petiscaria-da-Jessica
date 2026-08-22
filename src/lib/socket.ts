import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { subscribePageLifecycle } from './pageLifecycle';
import { devShopHeader, devShopSlug } from './devShop';

/**
 * A loja do socket sai do `Host` do handshake, igual ao HTTP — o servidor
 * resolve e derruba a conexão que não pertence a loja nenhuma.
 *
 * Em desenvolvimento o `Host` é `localhost:3000`, sem subdomínio, então o
 * header vai junto no handshake. Em produção `devShopHeader()` devolve `{}` e o
 * servidor ignoraria o header de qualquer jeito.
 */
export const socket: Socket = io('/', {
  autoConnect: true,
  transports: ['websocket', 'polling'],
  // O `extraHeaders` NÃO sobrevive ao transporte WebSocket (a API do navegador
  // não deixa o cliente pôr header no handshake WS), então a loja de dev vai
  // TAMBÉM pela query — que chega nos dois transportes. Em produção
  // `devShopSlug()` é '' e nada disto viaja.
  extraHeaders: devShopHeader(),
  query: devShopSlug() ? { loja: devShopSlug() } : undefined,
});

// Este módulo é só transporte: conecta, reconecta e repassa eventos. Quem
// pergunta "a página está na frente?" é o `pageLifecycle`; aqui só escutamos a
// resposta. Enquanto os listeners de `visibilitychange`/`online` moravam neste
// arquivo, o ciclo de vida da página era um assunto do socket — e a presença do
// motoboy virava efeito colateral da conexão cair.
//
// Rede de celular: quando o app WhatsApp/Instagram joga a webview pra trás
// (aba oculta) o navegador reduz os timers e o backoff automático do socket.io
// pode demorar minutos pra perceber que a conexão caiu. Ao voltar pra frente,
// ou quando o SO avisa que a rede voltou, força uma tentativa imediata em vez
// de esperar o próximo timer de reconexão. connect() é no-op se o socket já
// estiver conectado ou tentando conectar.
// Qualquer estado que não seja `offline` merece uma tentativa: a aba oculta com
// a rede de volta é justamente o caso do motoboy com o celular no bolso.
subscribePageLifecycle((state) => {
  if (state !== 'offline' && !socket.connected) socket.connect();
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
