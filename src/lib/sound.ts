// Alerta sonoro gerado via Web Audio API (sem arquivos externos).

let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Navegadores bloqueiam áudio antes da 1ª interação; desbloqueia no 1º clique/tecla.
export function unlockAudio(): void {
  const resume = () => {
    ensureCtx();
    if ('speechSynthesis' in window) {
      // pré-carrega as vozes e desbloqueia a fala silenciosamente
      window.speechSynthesis.getVoices();
      try {
        const silent = new SpeechSynthesisUtterance(' ');
        silent.volume = 0;
        window.speechSynthesis.speak(silent);
        window.speechSynthesis.cancel();
      } catch {
        /* ignora */
      }
    }
  };
  window.addEventListener('pointerdown', resume, { once: true });
  window.addEventListener('keydown', resume, { once: true });
}

function beep(freq: number, start: number, duration: number, volume = 0.3): void {
  const c = ensureCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, c.currentTime + start);
  gain.gain.linearRampToValueAtTime(volume, c.currentTime + start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + duration + 0.05);
}

/** Alerta de NOVO PEDIDO: dois "dings" ascendentes (tipo campainha de loja). */
export function playNewOrderSound(): void {
  beep(880, 0, 0.2); // Lá5
  beep(1174.66, 0.18, 0.28); // Ré6
  beep(1760, 0.42, 0.35, 0.22); // Lá6
}

// Prefere uma voz feminina em português do Brasil (Maria/Luciana etc.)
function pickFemalePtVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const pt = voices.filter((v) => v.lang.toLowerCase().startsWith('pt'));
  if (!pt.length) return undefined;
  const female = pt.find((v) =>
    /maria|luciana|francisca|juliana|helena|vitoria|beatriz|paula|camila|ana|felipe|thales|leticia|gabriela/i.test(
      v.name
    )
  );
  return female || pt[0];
}

/** Toca um MP3/áudio personalizado 2 vezes (alerta de novo pedido). */
export function playOrderMp3(url: string): void {
  try {
    const audio = new Audio(url);
    audio.volume = 1;
    let plays = 0;
    audio.addEventListener('ended', () => {
      plays++;
      if (plays < 2) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
    });
    audio.play().catch(() => {
      /* áudio bloqueado ou inválido — silencioso */
    });
  } catch {
    /* ignora */
  }
}

/** Anúncio por voz: "Novo pedido chegou!" repetido 2 vezes (voz feminina pt-BR). */
export function announceNewOrder(orderId?: string): void {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    const phrase = orderId ? `Novo pedido ${orderId} chegou!` : 'Um novo pedido chegou!';

    const speak = (voices: SpeechSynthesisVoice[]) => {
      synth.cancel();
      for (let i = 0; i < 2; i++) {
        const u = new SpeechSynthesisUtterance(phrase);
        u.lang = 'pt-BR';
        u.rate = 1.05;
        u.pitch = 1.15;
        const voice = pickFemalePtVoice(voices);
        if (voice) u.voice = voice;
        synth.speak(u);
      }
    };

    const initialVoices = synth.getVoices();
    if (initialVoices.length) {
      speak(initialVoices);
      return;
    }

    // 1ª chamada da sessão: as vozes ainda não carregaram, então espera o
    // evento (com um fallback por tempo, caso o navegador nunca o dispare).
    let spoken = false;
    const speakOnce = () => {
      if (spoken) return;
      spoken = true;
      speak(synth.getVoices());
    };
    synth.onvoiceschanged = () => {
      synth.onvoiceschanged = null;
      speakOnce();
    };
    setTimeout(speakOnce, 300);
  } catch {
    /* fala indisponível — silencioso */
  }
}
