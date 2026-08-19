import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';

/**
 * Tela 404 animada: um chef corre pela cena segurando uma lupa apontada para o
 * "404" gigante do fundo. A lente não é decorativa — ela realmente amplia o
 * texto que está atrás dela (uma cópia do "404" desenhada dentro de um círculo
 * com overflow escondido), por isso toda a matemática de posição abaixo.
 */

// Sistema de coordenadas do desenho do personagem (viewBox do SVG).
const VB_W = 220;
const VB_H = 340;
// Centro/raio da lente dentro do viewBox — usados para posicionar a ampliação.
const LENS_CX = 168;
const LENS_CY = 66;
const LENS_R = 50;
// Quanto a lente amplia o "404".
const ZOOM = 1.45;

interface Geo {
  k: number;
  size: number;
  lensY: number;
  lensR: number;
  startX: number;
  endX: number;
  textLeft: number;
  textTop: number;
}

export const NotFoundScreen: React.FC = () => {
  const navigate = useNavigate();

  const sceneRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLDivElement>(null);
  const zoomInnerRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const runnerRef = useRef<SVGSVGElement>(null);
  const groundRef = useRef<HTMLDivElement>(null);

  const backLegRef = useRef<SVGGElement>(null);
  const frontLegRef = useRef<SVGGElement>(null);
  const backArmRef = useRef<SVGGElement>(null);
  const hatRef = useRef<SVGGElement>(null);
  const scarfRef = useRef<SVGPathElement>(null);

  const geoRef = useRef<Geo>({
    k: 1,
    size: 200,
    lensY: 0,
    lensR: 50,
    startX: 0,
    endX: 0,
    textLeft: 0,
    textTop: 0,
  });

  useEffect(() => {
    const scene = sceneRef.current;
    const text = textRef.current;
    const lens = lensRef.current;
    const zoomInner = zoomInnerRef.current;
    const copy = copyRef.current;
    const runner = runnerRef.current;
    const ground = groundRef.current;
    if (!scene || !text || !lens || !zoomInner || !copy || !runner || !ground) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pos = { x: 0.5, bob: 0 };

    /** Recalcula tamanhos/posições. Roda na montagem, no resize e após as fontes. */
    const layout = () => {
      const g = geoRef.current;
      const W = scene.clientWidth;
      const H = scene.clientHeight;

      g.size = Math.max(132, Math.min(W * 0.34, 268));
      g.k = g.size / VB_W;
      g.lensR = LENS_R * g.k;

      const runnerH = VB_H * g.k;
      const groundY = H - Math.max(38, H * 0.09);
      g.lensY = groundY - runnerH + LENS_CY * g.k;

      // O personagem entra e sai da tela: a lupa varre o "404" no meio do caminho.
      g.startX = -g.size * 0.35;
      g.endX = W + g.size * 0.35;

      ground.style.top = `${groundY}px`;
      runner.style.width = `${g.size}px`;
      lens.style.width = `${g.lensR * 2}px`;
      lens.style.height = `${g.lensR * 2}px`;
      zoomRef.current!.style.transform = `translate(${g.lensR}px, ${g.lensR}px) scale(${ZOOM})`;

      // O "404" fica centrado na altura da lente para a lupa passar por cima dele.
      text.style.top = `${g.lensY - text.offsetHeight / 2}px`;
      g.textLeft = (W - text.offsetWidth) / 2;
      g.textTop = g.lensY - text.offsetHeight / 2;
      text.style.left = `${g.textLeft}px`;
      copy.style.width = `${text.offsetWidth}px`;
    };

    /** Escreve as posições no DOM (1x por frame). */
    const apply = () => {
      const g = geoRef.current;
      const cx = g.startX + pos.x * (g.endX - g.startX);
      const cy = g.lensY + pos.bob;
      runner.style.transform = `translate(${cx - LENS_CX * g.k}px, ${cy - LENS_CY * g.k}px)`;
      lens.style.transform = `translate(${cx - g.lensR}px, ${cy - g.lensR}px)`;
      zoomInner.style.transform = `translate(${g.textLeft - cx}px, ${g.textTop - cy}px)`;
    };

    layout();
    apply();

    const ro = new ResizeObserver(() => {
      layout();
      apply();
    });
    ro.observe(scene);
    document.fonts?.ready.then(() => {
      layout();
      apply();
    });

    if (reduced) {
      return () => ro.disconnect();
    }

    gsap.ticker.add(apply);

    const tweens = [
      // Travessia da cena (a lupa varre o 404 no meio).
      gsap.fromTo(pos, { x: 0 }, { x: 1, duration: 6.6, ease: 'none', repeat: -1, repeatDelay: 0.45 }),
      // Sobe-e-desce da corrida.
      gsap.to(pos, { bob: -8, duration: 0.26, ease: 'sine.inOut', yoyo: true, repeat: -1 }),
      // Pernas e braço alternados.
      gsap.fromTo(
        backLegRef.current,
        { rotate: 26 },
        { rotate: -26, duration: 0.26, ease: 'sine.inOut', yoyo: true, repeat: -1, svgOrigin: '100 246' }
      ),
      gsap.fromTo(
        frontLegRef.current,
        { rotate: -26 },
        { rotate: 26, duration: 0.26, ease: 'sine.inOut', yoyo: true, repeat: -1, svgOrigin: '100 246' }
      ),
      gsap.fromTo(
        backArmRef.current,
        { rotate: -24 },
        { rotate: 24, duration: 0.26, ease: 'sine.inOut', yoyo: true, repeat: -1, svgOrigin: '98 198' }
      ),
      gsap.to(hatRef.current, {
        rotate: -7,
        duration: 0.52,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
        svgOrigin: '101 132',
      }),
      gsap.to(scarfRef.current, {
        attr: { d: 'M98 186 q-30 0 -44 18 q22 4 28 10 q10 -12 18 -22 Z' },
        duration: 0.44,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
      }),
    ];

    // Entrada da cena.
    const intro = gsap.timeline();
    intro
      .fromTo(text, { scale: 0.82, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.8, ease: 'back.out(1.6)' })
      .fromTo('.nf-reveal', { y: 22, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.08 }, '-=0.35');

    return () => {
      ro.disconnect();
      gsap.ticker.remove(apply);
      tweens.forEach((t) => t.kill());
      intro.progress(1).kill();
    };
  }, []);

  const bigDigits = (
    <div
      className="whitespace-nowrap font-black leading-none tracking-tighter select-none"
      style={{ fontSize: 'clamp(120px, min(42vw, 56vh), 480px)' }}
    >
      404
    </div>
  );

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#5B1212] text-white">
      {/* ---------- Fundo ---------- */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#7F1D1D] via-[#991B1B] to-[#4C0F0F]" />
      <div
        className="absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.9) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
        }}
      />
      <div className="absolute left-1/2 top-1/2 h-[110vmin] w-[110vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(253,230,138,0.20)_0%,rgba(253,230,138,0)_62%)]" />
      {/* Bolhas desfocadas flutuando */}
      {[
        { l: '8%', t: '14%', s: 150, c: 'rgba(217,119,6,0.30)', d: '0s' },
        { l: '78%', t: '10%', s: 190, c: 'rgba(253,230,138,0.16)', d: '1.4s' },
        { l: '62%', t: '68%', s: 130, c: 'rgba(217,119,6,0.24)', d: '2.6s' },
        { l: '16%', t: '62%', s: 110, c: 'rgba(253,230,138,0.14)', d: '3.4s' },
      ].map((b, i) => (
        <span
          key={i}
          className="nf-float pointer-events-none absolute rounded-full blur-2xl"
          style={{
            left: b.l,
            top: b.t,
            width: b.s,
            height: b.s,
            background: b.c,
            animationDelay: b.d,
          }}
        />
      ))}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(28,25,23,0.55)_100%)]" />

      {/* ---------- Cena animada ---------- */}
      <div ref={sceneRef} className="relative flex-1 overflow-hidden">
        {/* 404 gigante (contorno) */}
        <div
          ref={textRef}
          className="nf-404-ghost absolute"
        >
          {bigDigits}
        </div>

        {/* Trecho ampliado pela lente (fica exatamente sob o vidro da lupa) */}
        <div
          ref={lensRef}
          className="absolute left-0 top-0 overflow-hidden rounded-full"
          style={{ boxShadow: 'inset 0 0 30px rgba(0,0,0,0.35)' }}
        >
          <div ref={zoomRef} className="absolute left-0 top-0 origin-top-left">
            <div
              ref={zoomInnerRef}
              className="absolute left-0 top-0"
              style={{ willChange: 'transform' }}
            >
              <div ref={copyRef} className="nf-404-found">
                {bigDigits}
              </div>
            </div>
          </div>
        </div>

        {/* Chão */}
        <div ref={groundRef} className="absolute inset-x-0">
          <div className="nf-ground h-[3px] w-full opacity-70" />
          <div className="h-24 w-full bg-gradient-to-b from-[rgba(28,25,23,0.35)] to-transparent" />
        </div>

        {/* Personagem correndo com a lupa */}
        <svg
          ref={runnerRef}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          className="pointer-events-none absolute left-0 top-0"
          style={{ overflow: 'visible', willChange: 'transform' }}
          aria-hidden="true"
        >
          {/* rastro de velocidade */}
          <g stroke="#FDE68A" strokeWidth="6" strokeLinecap="round" opacity="0.4">
            <line x1="30" y1="198" x2="-46" y2="198" />
            <line x1="12" y1="242" x2="-68" y2="242" />
            <line x1="34" y1="284" x2="-32" y2="284" />
          </g>

          {/* sombra no chao */}
          <ellipse cx="100" cy="330" rx="54" ry="9" fill="rgba(0,0,0,0.30)" />

          {/* perna de tras */}
          <g ref={backLegRef}>
            <path
              d="M100 246 L78 284 L86 314"
              fill="none"
              stroke="#1E293B"
              strokeWidth="20"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M86 316 L62 320" fill="none" stroke="#0F172A" strokeWidth="14" strokeLinecap="round" />
          </g>

          {/* braco de tras (balanca para tras) */}
          <g ref={backArmRef}>
            <path
              d="M96 200 L68 214 L58 240"
              fill="none"
              stroke="#E7E5E4"
              strokeWidth="15"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="58" cy="243" r="9.5" fill="#EFC69B" />
          </g>

          {/* lenco de chef esvoacando atras do ombro */}
          <path ref={scarfRef} d="M98 186 q-28 -12 -48 2 q20 8 26 16 q12 -8 22 -18 Z" fill="#FDE68A" />

          {/* pescoco */}
          <rect x="92" y="168" width="18" height="28" rx="8" fill="#EFC69B" />

          {/* tronco: jaleco + avental */}
          <path d="M78 196 Q102 178 126 196 L122 252 Q100 263 82 252 Z" fill="#FFFBEB" />
          <path d="M89 216 L117 216 L114 250 Q100 258 90 250 Z" fill="#D97706" />
          <path d="M96 197 L104 216" fill="none" stroke="#B45309" strokeWidth="4" strokeLinecap="round" />
          <circle cx="112" cy="210" r="3" fill="#E7E5E4" />
          <circle cx="113" cy="228" r="3" fill="#E7E5E4" />

          {/* perna da frente */}
          <g ref={frontLegRef}>
            <path
              d="M100 246 L126 280 L118 312"
              fill="none"
              stroke="#334155"
              strokeWidth="21"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M118 314 L144 318" fill="none" stroke="#0F172A" strokeWidth="15" strokeLinecap="round" />
          </g>

          {/* cabeca */}
          <circle cx="100" cy="150" r="28" fill="#F8D6B3" />
          <path d="M76 142 q4 -18 24 -20" fill="none" stroke="#78350F" strokeWidth="9" strokeLinecap="round" />
          <circle cx="82" cy="156" r="6" fill="#EFC69B" />
          <circle cx="115" cy="147" r="3.6" fill="#1C1917" />
          <path d="M108 162 q9 7 17 -1" fill="none" stroke="#1C1917" strokeWidth="3.2" strokeLinecap="round" />
          <circle cx="120" cy="160" r="5" fill="#F0A0A0" opacity="0.45" />

          {/* toque (chapeu de chef) */}
          <g ref={hatRef}>
            <circle cx="82" cy="116" r="15" fill="#FFFFFF" />
            <circle cx="103" cy="106" r="19" fill="#FFFFFF" />
            <circle cx="122" cy="118" r="14" fill="#FFFFFF" />
            <rect x="75" y="120" width="52" height="17" rx="8" fill="#F1F5F9" />
          </g>

          {/* braco erguido + lupa */}
          <path
            d="M114 198 L136 180 L142 156"
            fill="none"
            stroke="#FFFBEB"
            strokeWidth="16"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line x1="154" y1="114" x2="142" y2="153" stroke="#B45309" strokeWidth="12" strokeLinecap="round" />
          <circle cx="142" cy="156" r="10" fill="#EFC69B" />
          <circle cx={LENS_CX} cy={LENS_CY} r={LENS_R} fill="rgba(253,230,138,0.10)" />
          <circle cx={LENS_CX} cy={LENS_CY} r={LENS_R} fill="none" stroke="#FDE68A" strokeWidth="9" />
          <circle cx={LENS_CX} cy={LENS_CY} r={LENS_R - 6} fill="none" stroke="rgba(255,255,255,0.30)" strokeWidth="2" />
          <path
            d="M142 52 q10 -20 32 -23"
            fill="none"
            stroke="rgba(255,255,255,0.55)"
            strokeWidth="7"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* ---------- Texto e ações ---------- */}
      <div className="relative z-10 flex flex-col items-center gap-3 px-6 pb-[max(28px,env(safe-area-inset-bottom))] pt-2 text-center">
        <h1 className="nf-reveal text-xl font-black tracking-tight sm:text-2xl">
          Ops! Esta página não existe.
        </h1>
        <p className="nf-reveal max-w-xs text-xs font-medium text-[#FEE2E2]/80 sm:max-w-sm sm:text-sm">
          Procuramos com lupa e não achamos nada aqui. Volte para o cardápio — o caldinho está quente.
        </p>
        <div className="nf-reveal mt-1 flex flex-wrap items-center justify-center gap-2.5">
          <button
            onClick={() => navigate('/', { replace: true })}
            className="rounded-full bg-[#FDE68A] px-6 py-3 text-xs font-extrabold text-[#7F1D1D] shadow-lg shadow-black/25 transition hover:bg-white active:scale-95"
          >
            Voltar ao cardápio
          </button>
          <button
            onClick={() => navigate(-1)}
            className="rounded-full border border-white/25 bg-white/10 px-6 py-3 text-xs font-extrabold text-white transition hover:bg-white/20 active:scale-95"
          >
            Página anterior
          </button>
        </div>
      </div>
    </div>
  );
};
