// Primitivas de áudio do navegador: campainha via Web Audio, MP3 da loja e voz.
//
// Este arquivo não decide *quando* nem *o quê* tocar — quem decide é a tabela
// (`src/shared/orderAlerts.ts`) e quem entrega é `src/lib/alertChannel.ts`.
// Feature nenhuma deveria importar daqui direto: o alerta que toca sem passar
// pelo canal é o alerta que toca duas vezes e ninguém deduplica.

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

/** Cria (ou retoma) o AudioContext. O iOS suspende o contexto quando a aba sai
 *  de frente, e sem retomar o primeiro pedido depois disso chegaria mudo. */
export function resumeAudio(): void {
  ensureCtx();
}

/** Pré-carrega as vozes e destrava a fala com uma frase inaudível. Sem isso a
 *  primeira locução da sessão sai muda no Chrome. */
export function primeSpeech(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.getVoices();
    const silent = new SpeechSynthesisUtterance(' ');
    silent.volume = 0;
    window.speechSynthesis.speak(silent);
    window.speechSynthesis.cancel();
  } catch {
    /* ignora */
  }
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

const CHIME_SECONDS = 0.8;

/**
 * O Safari do iPhone não tem `navigator.vibrate`. Um burst grave no alto-falante
 * é o que o aparelho consegue fazer de "haptic" na web: o motoboy sente no bolso
 * mesmo sem a API. `start` em segundos, igual ao `beep`.
 */
export function playPhoneBuzz(start = 0, duration = 0.18): void {
  const c = ensureCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'square';
  osc.frequency.value = 72;
  const t0 = c.currentTime + start;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.28, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.04);
}

/** Três pancadas curtas, no ritmo de um toque de celular. */
export function playPhoneBuzzPattern(repeat = 1): void {
  const rounds = Math.max(1, repeat);
  for (let round = 0; round < rounds; round++) {
    const offset = round * 1.05;
    playPhoneBuzz(offset, 0.16);
    playPhoneBuzz(offset + 0.22, 0.16);
    playPhoneBuzz(offset + 0.44, 0.28);
  }
}

/** Alerta de NOVO PEDIDO: dois "dings" ascendentes (tipo campainha de loja). */
export function playNewOrderSound(repeat = 1): void {
  for (let round = 0; round < Math.max(1, repeat); round++) {
    const offset = round * CHIME_SECONDS;
    beep(880, offset, 0.2); // Lá5
    beep(1174.66, offset + 0.18, 0.28); // Ré6
    beep(1760, offset + 0.42, 0.35, 0.22); // Lá6
  }
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

/** Toca o áudio personalizado da loja `repeat` vezes. */
export function playOrderMp3(url: string, repeat = 2): void {
  try {
    const rounds = Math.max(1, repeat);
    const audio = new Audio(url);
    audio.volume = 1;
    let plays = 0;
    audio.addEventListener('ended', () => {
      plays++;
      if (plays < rounds) {
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

/** Locução pt-BR (voz feminina quando existe uma instalada). */
export function speakPtBr(phrase: string, repeat = 1): void {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const text = phrase.trim();
    if (!text) return;
    const synth = window.speechSynthesis;
    const rounds = Math.max(1, repeat);

    const speak = (voices: SpeechSynthesisVoice[]) => {
      synth.cancel();
      for (let i = 0; i < rounds; i++) {
        const u = new SpeechSynthesisUtterance(text);
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
