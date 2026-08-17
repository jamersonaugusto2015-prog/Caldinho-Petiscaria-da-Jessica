import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';

interface SplashScreenProps {
  onComplete: () => void;
  storeName?: string;
  storeLogo?: string;
  city?: string;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  onComplete,
  storeName = 'Caldinho Express',
  storeLogo = '',
  city,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const logoWrapRef = useRef<HTMLDivElement>(null);
  const taglineRef = useRef<HTMLParagraphElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onComplete);
  doneRef.current = onComplete;

  // Regra: anima apenas a 1ª parte do nome (antes do "&"); o restante fica estático
  const ampIdx = storeName.indexOf('&');
  const animatedName = (ampIdx >= 0 ? storeName.slice(0, ampIdx) : storeName).trim();
  const staticName = ampIdx >= 0 ? storeName.slice(ampIdx).trim() : '';

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const smoke = gsap.utils.toArray<HTMLElement>('.splash-smoke');
    const letters = gsap.utils.toArray<HTMLElement>('.splash-letter');

    // Nevoa subindo da tigela: puffs que se expandem, derivam e desvanecem
    smoke.forEach((el, i) => {
      gsap.fromTo(
        el,
        { opacity: 0.55, scale: 0.7, filter: 'blur(6px)' },
        {
          y: -70 - (i % 3) * 18,
          x: (i % 2 === 0 ? 1 : -1) * (12 + (i % 4) * 8),
          scale: 2.4,
          opacity: 0,
          rotate: (i % 2 === 0 ? 1 : -1) * 24,
          filter: 'blur(14px)',
          duration: 2.1 + (i % 4) * 0.35,
          repeat: -1,
          repeatDelay: 0.25,
          delay: i * 0.45,
          ease: 'sine.inOut',
        }
      );
    });

    // Flutuação suave do ícone (após a entrada)
    const bob = gsap.to(logoWrapRef.current, {
      y: -5,
      repeat: -1,
      yoyo: true,
      duration: 1.1,
      ease: 'sine.inOut',
      paused: true,
    });

    const tl = gsap.timeline({
      defaults: { ease: 'power3.out' },
      onComplete: () => doneRef.current(),
    });

    tl.set(letters, { opacity: 0, y: 60, rotateX: 90 })
      .set(taglineRef.current, { opacity: 0, y: 14 })
      .set(barRef.current, { scaleX: 0 })
      // Tigela entra girando com elástico (overshoot)
      .fromTo(
        logoWrapRef.current,
        { scale: 0, rotate: -140, opacity: 0 },
        { scale: 1.08, rotate: 0, opacity: 1, duration: 0.95, ease: 'back.out(1.4)' },
        0.1
      )
      // Assenta no tamanho final
      .to(logoWrapRef.current, { scale: 1, duration: 0.3, ease: 'power2.out' }, '-=0.12')
      // Letras entram em stagger 3D
      .to(letters, { opacity: 1, y: 0, rotateX: 0, duration: 0.5, stagger: 0.04 }, '-=0.4')
      .to(taglineRef.current, { opacity: 1, y: 0, duration: 0.45 }, '-=0.2')
      // Barra de progresso
      .to(
        barRef.current,
        { scaleX: 1, duration: 0.9, ease: 'power2.inOut', transformOrigin: 'left center' },
        '-=0.25'
      )
      // Inicia flutuação contínua
      .add(() => {
        bob.play();
      }, '-=0.4')
      // Sai deslizando para cima
      .to(root, { yPercent: -100, duration: 0.75, ease: 'power4.inOut', delay: 0.35 })
      .set(root, { display: 'none' });

    return () => {
      tl.kill();
      bob.kill();
      smoke.forEach((el) => gsap.killTweensOf(el));
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[100] bg-gradient-to-br from-[#7F1D1D] via-[#991B1B] to-[#B91C1C] flex flex-col items-center justify-center overflow-hidden"
    >
      {/* Logo da empresa (ou tigela padrão) com vapor saindo do topo */}
      <div ref={logoWrapRef} className="relative flex items-center justify-center select-none">
        {/* Nevoa: puffs arredondados de gradiente radial com blur (parece fumaça real) */}
        <div className="absolute top-0 inset-x-0 h-24 pointer-events-none">
          {[...Array(7)].map((_, i) => (
            <span
              key={i}
              className="splash-smoke"
              style={{
                position: 'absolute',
                bottom: '68%',
                left: `${-4 + i * 17}%`,
                width: `${26 + (i % 3) * 12}px`,
                height: `${30 + (i % 4) * 16}px`,
                borderRadius: '9999px',
                background:
                  'radial-gradient(ellipse at center, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.15) 55%, rgba(255,255,255,0) 72%)',
              }}
            />
          ))}
        </div>
        {storeLogo ? (
          <img
            key={storeLogo}
            src={storeLogo}
            alt={storeName}
            onError={(e) => {
              // logo quebrada/antiga: esconde e usa o ícone padrão em vez de imagem quebrada
              (e.target as HTMLImageElement).style.display = 'none';
            }}
            className="w-28 h-28 object-contain drop-shadow-[0_8px_24px_rgba(253,230,138,0.45)]"
          />
        ) : (
          <span className="splash-icon text-[#FDE68A] drop-shadow-[0_8px_24px_rgba(253,230,138,0.45)]">
            soup_kitchen
          </span>
        )}
      </div>

      {/* Nome da empresa: 1ª parte animada letra a letra + restante estático */}
      <div className="mt-6 flex flex-wrap items-baseline justify-center gap-x-2 text-white select-none px-8">
        <span className="flex items-center flex-wrap">
          {animatedName.split('').map((ch, i) => (
            <span
              key={`anim-${i}`}
              className={`splash-letter font-black text-2xl sm:text-3xl tracking-tight inline-block ${
                ch === ' ' ? 'w-2' : ''
              }`}
            >
              {ch === ' ' ? '' : ch}
            </span>
          ))}
        </span>
        {staticName && (
          <span className="font-black text-2xl sm:text-3xl tracking-tight italic text-[#FDE68A]">
            {staticName}
          </span>
        )}
      </div>

      <p
        ref={taglineRef}
        className="mt-2.5 text-[11px] font-bold uppercase tracking-[0.35em] text-[#FEE2E2]/80 text-center px-6"
      >
        {city ? `${city} • Sabor Regional` : 'Sabor Regional'}
      </p>

      {/* Barra de progresso */}
      <div className="mt-8 w-48 h-1.5 rounded-full bg-white/20 overflow-hidden">
        <div ref={barRef} className="h-full w-full rounded-full bg-gradient-to-r from-[#D97706] to-[#FDE68A]" />
      </div>
    </div>
  );
};
