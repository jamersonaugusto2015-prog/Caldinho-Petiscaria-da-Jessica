import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ClientApp } from './features/client/ClientApp';
import { KitchenApp } from './features/kitchen/KitchenApp';
import { DriverApp } from './features/driver/DriverApp';
import { NotFoundScreen } from './components/NotFoundScreen';
import './index.css';
import 'leaflet/dist/leaflet.css';

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
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#F5F5F4] text-[#1C1917] p-6 text-center">
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ClientApp />} />
          <Route path="/cozinha" element={<KitchenApp />} />
          <Route path="/entregador" element={<DriverApp />} />
          <Route path="*" element={<NotFoundScreen />} />
        </Routes>
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>
);
