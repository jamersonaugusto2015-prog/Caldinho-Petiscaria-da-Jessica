import React, { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ClientProvider, useClient } from './ClientStore';
import { ClientHeader } from './ClientHeader';
import { ClientView } from './ClientView';
import { SplashScreen } from '../../components/SplashScreen';
import { Heart } from 'lucide-react';

const ClientShell: React.FC<{ splashDone: boolean }> = ({ splashDone }) => {
  const contentRef = useRef<HTMLDivElement>(null);

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
      gsap.fromTo(
        '.client-footer',
        { opacity: 0 },
        { opacity: 1, duration: 0.7, delay: 0.45, clearProps: 'opacity' }
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
        <div>
          <div className="client-header">
            <ClientHeader />
          </div>
          <main className="client-main px-3 pt-4">
            <ClientView />
          </main>
        </div>

        <footer className="client-footer bg-[#1C1917] text-[#E7E5E4] text-xs py-6 px-4 mt-10 border-t border-[#292524]">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#B91C1C] flex items-center justify-center text-white font-extrabold text-lg shadow-md">
                🍲
              </div>
              <div>
                <div className="font-extrabold text-white text-sm tracking-tight">
                  Caldinho Express
                </div>
                <p className="text-[11px] text-[#A8A29E]">
                  O melhor do sabor regional entregue quente em minutos.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] font-bold text-[#D6D3D1]">
              <a href="/cozinha" className="hover:text-[#B91C1C] transition">
                Painel do Restaurante
              </a>
              <span className="text-[#57534E]">•</span>
              <a href="/entregador" className="hover:text-[#B91C1C] transition">
                App do Entregador
              </a>
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-[#A8A29E]">
              <span>Feito com paixão em Recife</span>
              <Heart className="w-3.5 h-3.5 fill-[#B91C1C] text-[#B91C1C]" />
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

const SplashBridge: React.FC<{ splashDone: boolean; setSplashDone: (v: boolean) => void }> = ({
  splashDone,
  setSplashDone,
}) => {
  const { storeLogo, storeName, city } = useClient();
  if (splashDone) return null;
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
