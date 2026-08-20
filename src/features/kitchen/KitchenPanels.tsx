import React from 'react';
import { BarChart3 } from 'lucide-react';

export const Heading: React.FC<{ title: string; subtitle?: string; icon?: React.ReactNode }> = ({ title, subtitle, icon }) => (
  // `shrink-0` no quadrado do ícone e `min-w-0` no texto: sem os dois, o
  // subtítulo longo ("Acessos e disponibilidade dos entregadores.") espremia o
  // ícone até virar uma tira e ainda empurrava o título para fora da tela de 360px.
  <div className="flex items-center gap-3"><div className="w-10 h-10 shrink-0 rounded-2xl bg-[#B91C1C] text-white flex items-center justify-center">{icon || <BarChart3 className="w-5 h-5" />}</div><div className="min-w-0"><h2 className="text-lg font-extrabold">{title}</h2>{subtitle && <p className="text-xs text-[#57534E]">{subtitle}</p>}</div></div>
);

export const Panel: React.FC<{ title?: string; children: React.ReactNode }> = ({ title, children }) => <div className="bg-white rounded-2xl p-4 border border-[#E7E5E4] shadow-xs">{title && <h3 className="text-sm font-extrabold mb-3">{title}</h3>}{children}</div>;

export const Empty: React.FC<{ text: string }> = ({ text }) => <p className="text-xs text-[#A8A29E] italic py-5 text-center">{text}</p>;

/** Interruptor liga/desliga: o estado fica visível sem precisar ler o texto do botão. */
export const SwitchToggle: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}> = ({ checked, onChange, label, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
      checked ? 'bg-emerald-500' : 'bg-[#D6D3D1]'
    }`}
  >
    {/* O trilho tem 36x20px: no tablet da cozinha, pausar um produto com o dedo
        acertava a linha de cima. Esta área invisível de 44x44 amplia só o alvo
        do toque — o interruptor continua exatamente do mesmo tamanho na tela, e
        no mouse ela nem existe. */}
    <span aria-hidden className="absolute left-1/2 top-1/2 hidden h-11 w-11 -translate-x-1/2 -translate-y-1/2 pointer-coarse:block" />
    <span
      className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
      }`}
    />
  </button>
);
