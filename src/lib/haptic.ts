import { isIos } from './appShell';

/**
 * Taptic no iPhone, motor no Android.
 *
 * Safari nunca implementou `navigator.vibrate`. A partir do iOS 18, um
 * `<input type="checkbox" switch>` escondido dispara o Taptic Engine quando
 * o clique passa pelo <label> — e só com gesto do usuário. Sem toque, o
 * WebKit ignora. Por isso o alerta de corrida nova continua no alto-falante
 * (`playPhoneBuzzPattern`); isto aqui é o tick nos botões.
 */

let switchLabel: HTMLLabelElement | null = null;
let switchInput: HTMLInputElement | null = null;

function ensureIosSwitch(): HTMLLabelElement | null {
  if (typeof document === 'undefined') return null;
  if (switchLabel && switchInput && document.body.contains(switchLabel)) return switchLabel;

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;

  const label = document.createElement('label');
  label.appendChild(input);
  label.setAttribute('aria-hidden', 'true');
  Object.assign(label.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '1px',
    height: '1px',
    margin: '0',
    opacity: '0',
    pointerEvents: 'none',
    overflow: 'hidden',
  });
  document.body.appendChild(label);
  switchLabel = label;
  switchInput = input;
  return label;
}

function iosSwitchTick(): void {
  if (!isIos()) return;
  try {
    const label = ensureIosSwitch();
    label?.click();
  } catch {
    /* sem Taptic — o resto do clique segue */
  }
}

function androidTick(): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (isIos()) return;
  try {
    // Motor barato no Android some abaixo de ~50 ms. Dois pulsos curtos
    // passam melhor que um 40 ms único. Tem que ser no mesmo tick do clique.
    navigator.vibrate([55, 40, 70]);
  } catch {
    /* recusa silenciosa */
  }
}

/** Chamar no mesmo tick do `click` — senão o iOS perde a ativação do usuário. */
export function hapticTap(): void {
  androidTick();
  iosSwitchTick();
}
