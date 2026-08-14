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
  const resume = () => ensureCtx();
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
