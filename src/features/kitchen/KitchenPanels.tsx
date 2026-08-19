import React from 'react';
import { BarChart3 } from 'lucide-react';

export const Heading: React.FC<{ title: string; subtitle?: string; icon?: React.ReactNode }> = ({ title, subtitle, icon }) => (
  <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-2xl bg-[#B91C1C] text-white flex items-center justify-center">{icon || <BarChart3 className="w-5 h-5" />}</div><div><h2 className="text-lg font-extrabold">{title}</h2>{subtitle && <p className="text-xs text-[#57534E]">{subtitle}</p>}</div></div>
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
    <span
      className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
      }`}
    />
  </button>
);
