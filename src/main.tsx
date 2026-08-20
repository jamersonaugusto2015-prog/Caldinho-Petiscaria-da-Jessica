import { Component, StrictMode, Suspense, lazy, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { installAppShell } from './lib/appShell';
import './index.css';

/**
 * Os três apps entram por `lazy`, não por import direto.
 *
 * Importados de uma vez, o Rollup junta tudo num arquivo só e o cliente que
 * abre o cardápio baixa o painel da cozinha inteiro — Leaflet, GSAP, motion,
 * confete e o cupom da impressora térmica — antes de ver a primeira sopa. Num
 * plano de dados pré-pago isso é a experiência de instalação do app.
 *
 * O CSS do Leaflet não passa por aqui: quem o importa é o próprio `LiveMap`, e
 * ele já entra por `lazy`. Puxá-lo junto do app do papel — como se fazia
 * enquanto o `LiveMap` não carregava o próprio estilo — devolvia os 15 kB do
 * mapa para o caminho da primeira pintura dos três papéis, inclusive os que
 * nunca abrem um mapa.
 */
const ClientApp = lazy(() =>
  import('./features/client/ClientApp').then((m) => ({ default: m.ClientApp }))
);
const KitchenApp = lazy(() =>
  import('./features/kitchen/KitchenApp').then((m) => ({ default: m.KitchenApp }))
);
const DriverApp = lazy(() =>
  import('./features/driver/DriverApp').then((m) => ({ default: m.DriverApp }))
);
// A 404 também entra por `lazy`: ela anima com GSAP, e importada direto puxava
// o pacote inteiro de animação para o carregamento inicial dos TRÊS apps —
// 200 kB pagos por todo mundo por causa de uma tela que quase ninguém vê.
const NotFoundScreen = lazy(() =>
  import('./components/NotFoundScreen').then((m) => ({ default: m.NotFoundScreen }))
);

/**
 * Espera do pedaço da rota. Aparece só depois de 240 ms (ver `.shell-loading`
 * em `index.css`): num 4G decente o pedaço chega antes disso, e um flash de
 * tela vazia entre o toque e o app é pior que meio segundo de nada.
 */
const shellFallback = (
  <div className="shell-loading min-h-dscreen flex items-center justify-center bg-[#F5F5F4]">
    <div className="h-1.5 w-32 overflow-hidden rounded-full bg-[#E7E5E4]">
      <div className="shell-loading-bar h-full w-1/3 rounded-full bg-[#B91C1C]" />
    </div>
  </div>
);

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Sem isto, um erro de render em qualquer tela (ex.: um pedido antigo com
 * campo faltando) derruba a árvore inteira do React e o cliente vê uma tela
 * branca no meio do pedido, sem nenhuma saída além de fechar o app.
 */
class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  // O shim de tipos do React disponível neste projeto (via react-router, sem
  // @types/react dedicado) não propaga `props` da classe base — declara
  // explicitamente sem afetar o valor real que o React injeta em runtime.
  declare props: Readonly<{ children: ReactNode }>;
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Erro não tratado na interface:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-dscreen flex flex-col items-center justify-center gap-4 bg-[#F5F5F4] text-[#1C1917] p-6 text-center">
          <div className="text-4xl">😕</div>
          <h1 className="text-lg font-extrabold">Algo deu errado</h1>
          <p className="text-sm text-[#57534E] max-w-xs">
            Tivemos um problema para mostrar esta tela. Seu pedido não foi perdido — tente recarregar.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="bg-[#B91C1C] hover:bg-[#991B1B] text-white font-extrabold py-3 px-6 rounded-full shadow-md transition"
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Antes do render: o navegador decide se a página é instalável olhando o head
// no carregamento. Manifesto injetado depois do primeiro paint chega tarde.
installAppShell();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={shellFallback}>
          <Routes>
            <Route path="/" element={<ClientApp />} />
            <Route path="/cozinha" element={<KitchenApp />} />
            <Route path="/entregador" element={<DriverApp />} />
            <Route path="*" element={<NotFoundScreen />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>
);
