import React, { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { WifiOff } from 'lucide-react';
import { ClientProvider, useClientShell } from './ClientStore';
import { ClientHeader } from './ClientHeader';
import { ClientView } from './ClientView';
import { SplashScreen } from '../../components/SplashScreen';

const LoadErrorScreen: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <div className="min-h-screen flex flex-col items-center justify-center text-center p-8 gap-4">
    <div className="w-16 h-16 rounded-2xl bg-[#FEF2F2] text-[#B91C1C] flex items-center justify-center">
      <WifiOff className="w-8 h-8" />
    </div>
    <div>
      <h2 className="text-lg font-extrabold text-[#1C1917]">Não foi possível carregar a loja</h2>
      <p className="text-xs text-[#57534E] mt-1.5 max-w-xs">
        Verifique sua conexão com a internet e tente novamente. Nenhum pedido pode ser feito
        enquanto o cardápio não carregar.
      </p>
    </div>
    <button
      onClick={onRetry}
      className="px-6 py-3 rounded-full bg-[#B91C1C] hover:bg-[#991B1B] text-white font-extrabold text-sm shadow-md transition"
    >
      Tentar de novo
    </button>
  </div>
);

const ClientShell: React.FC<{ splashDone: boolean }> = ({ splashDone }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const { loadError, retryLoad } = useClientShell();

  useEffect(() => {
    if (!splashDone) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.client-header',
        { y: -48, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.65, ease: 'power3.out', clearProps: 'transform,opacity' }
      );
      gsap.fromTo(
        '.client-main > *',
        { y: 34, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.6,
          stagger: 0.09,
          ease: 'power3.out',
          delay: 0.12,
          clearProps: 'transform,opacity',
        }
      );
    }, contentRef);

    return () => ctx.revert();
  }, [splashDone]);

  return (
    <div
      ref={contentRef}
      className="min-h-screen bg-[#121214] text-[#1C1917] font-sans antialiased flex justify-center selection:bg-[#B91C1C] selection:text-white"
    >
      <div className="w-full max-w-[430px] min-h-screen bg-[#F5F5F4] flex flex-col shadow-2xl shadow-black/40">
        {loadError ? (
          <LoadErrorScreen onRetry={retryLoad} />
        ) : (
          <div>
            <div className="client-header">
              <ClientHeader />
            </div>
            <main className="client-main px-3 pt-4">
              <ClientView />
            </main>
          </div>
        )}
      </div>
    </div>
  );
};

const SplashBridge: React.FC<{ splashDone: boolean; setSplashDone: (v: boolean) => void }> = ({
  splashDone,
  setSplashDone,
}) => {
  const { storeLogo, storeName, city, ready } = useClientShell();
  if (splashDone) return null;

  // Só anima quando a logo/nome reais chegaram (evita flash de imagem antiga/padrão)
  if (!ready) {
    return (
      <div className="fixed inset-0 z-[100] bg-gradient-to-br from-[#7F1D1D] via-[#991B1B] to-[#B91C1C] flex items-center justify-center">
        <span className="w-8 h-8 rounded-full border-4 border-white/30 border-t-white animate-spin" />
      </div>
    );
  }

  return (
    <SplashScreen
      storeLogo={storeLogo}
      storeName={storeName}
      city={city}
      onComplete={() => setSplashDone(true)}
    />
  );
};

export const ClientApp: React.FC = () => {
  const [splashDone, setSplashDone] = useState(false);

  return (
    <ClientProvider>
      <SplashBridge splashDone={splashDone} setSplashDone={setSplashDone} />
      <ClientShell splashDone={splashDone} />
    </ClientProvider>
  );
};
