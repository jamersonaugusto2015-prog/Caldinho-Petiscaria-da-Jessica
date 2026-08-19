import React, { useEffect, useId, useState } from 'react';

/**
 * Peças visuais das Configurações.
 *
 * A tela antiga usava rótulos de 10px e inputs de 12px: dono de loja mexe nisso
 * no celular, no meio do serviço. Aqui o texto sobe para 12/14px, todo campo tem
 * alvo de toque de 44px e o estado (ligado, salvo, com erro) aparece sem leitura.
 */

export const INPUT_CLASS =
  'block w-full rounded-xl border border-[#E7E5E4] bg-white px-3 py-2.5 text-sm font-semibold text-[#1C1917] outline-none transition-colors placeholder:font-medium placeholder:text-[#A8A29E] focus:border-[#B91C1C] focus:ring-2 focus:ring-[#B91C1C]/25 disabled:cursor-not-allowed disabled:bg-[#FAFAF9] disabled:text-[#A8A29E]';

const INPUT_ERROR_CLASS = 'border-[#FCA5A5] bg-[#FEF2F2] focus:border-[#B91C1C]';

/** Cartão de um assunto: título, explicação curta e, à direita, o estado atual. */
export const SettingsCard: React.FC<{
  title: string;
  description?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, description, aside, children }) => (
  <section className="rounded-2xl border border-[#E7E5E4] bg-white p-4 shadow-xs sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        <h3 className="text-sm font-extrabold tracking-tight text-[#1C1917]">{title}</h3>
        {description && <p className="mt-1 text-xs leading-relaxed text-[#78716C]">{description}</p>}
      </div>
      {aside && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{aside}</div>}
    </div>
    <div className="mt-4 space-y-4">{children}</div>
  </section>
);

/** Duas colunas a partir do tablet, uma coluna no celular. */
export const FieldGrid: React.FC<{ children: React.ReactNode; cols?: 2 | 3 }> = ({ children, cols = 2 }) => (
  <div className={`grid gap-3 ${cols === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'}`}>{children}</div>
);

export const FieldNote: React.FC<{ children: React.ReactNode; tone?: 'muted' | 'ok' | 'danger' }> = ({
  children,
  tone = 'muted',
}) => (
  <p
    className={`text-xs leading-relaxed ${
      tone === 'ok' ? 'text-[#047857]' : tone === 'danger' ? 'font-bold text-[#B91C1C]' : 'text-[#78716C]'
    }`}
    role={tone === 'danger' ? 'alert' : undefined}
  >
    {children}
  </p>
);

export type PillTone = 'ok' | 'warn' | 'danger' | 'muted';

const PILL_SKIN: Record<PillTone, string> = {
  ok: 'border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]',
  warn: 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]',
  danger: 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]',
  muted: 'border-[#E7E5E4] bg-[#F5F5F4] text-[#57534E]',
};

export const StatusPill: React.FC<{ tone?: PillTone; children: React.ReactNode }> = ({ tone = 'muted', children }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${PILL_SKIN[tone]}`}
  >
    <span
      className={`h-1.5 w-1.5 rounded-full ${
        tone === 'ok' ? 'bg-[#059669]' : tone === 'warn' ? 'bg-[#D97706]' : tone === 'danger' ? 'bg-[#B91C1C]' : 'bg-[#A8A29E]'
      }`}
    />
    {children}
  </span>
);

/** Campo de texto com rótulo legível, dica opcional, prefixo/sufixo e erro. */
export const Field: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  type?: string;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  disabled?: boolean;
  inputMode?: 'text' | 'decimal' | 'numeric' | 'tel';
  action?: React.ReactNode;
}> = ({ label, value, onChange, hint, error, type = 'text', placeholder, prefix, suffix, disabled, inputMode, action }) => {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-xs font-bold text-[#44403C]">
        {label}
      </label>
      <div className="mt-1.5 flex items-stretch gap-2">
        <div className="relative min-w-0 flex-1">
          {prefix && (
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-xs font-bold text-[#A8A29E]">
              {prefix}
            </span>
          )}
          <input
            id={id}
            className={`${INPUT_CLASS} ${error ? INPUT_ERROR_CLASS : ''} ${prefix ? 'pl-9' : ''} ${suffix ? 'pr-12' : ''}`}
            type={type}
            inputMode={inputMode}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            onChange={(event) => onChange(event.target.value)}
          />
          {suffix && (
            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-bold text-[#A8A29E]">
              {suffix}
            </span>
          )}
        </div>
        {action}
      </div>
      {error ? <FieldNote tone="danger">{error}</FieldNote> : hint ? <p className="mt-1.5 text-[11px] leading-relaxed text-[#78716C]">{hint}</p> : null}
    </div>
  );
};

const formatNumber = (value: number) => (Number.isFinite(value) ? String(value) : '0');

/**
 * Número que não briga com quem digita. O input antigo convertia a cada tecla:
 * apagar o campo virava 0 na hora e "0,5" era impossível. Aqui o texto é livre
 * enquanto o campo está em foco e só o valor válido sobe para o rascunho.
 */
export const NumberField: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
  prefix?: string;
  suffix?: string;
  min?: number;
  disabled?: boolean;
}> = ({ label, value, onChange, hint, prefix, suffix, min = 0, disabled }) => {
  const [text, setText] = useState(() => formatNumber(value));
  const [editing, setEditing] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!editing) setText(formatNumber(value));
  }, [value, editing]);

  const commit = (raw: string) => {
    const parsed = Number(raw.replace(',', '.'));
    if (raw.trim() === '') return onChange(min);
    if (Number.isFinite(parsed)) onChange(Math.max(min, parsed));
  };

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-xs font-bold text-[#44403C]">
        {label}
      </label>
      <div className="relative mt-1.5">
        {prefix && (
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-xs font-bold text-[#A8A29E]">
            {prefix}
          </span>
        )}
        <input
          id={id}
          className={`${INPUT_CLASS} ${prefix ? 'pl-9' : ''} ${suffix ? 'pr-12' : ''}`}
          type="text"
          inputMode="decimal"
          value={text}
          disabled={disabled}
          onFocus={() => setEditing(true)}
          onChange={(event) => {
            setText(event.target.value);
            commit(event.target.value);
          }}
          onBlur={() => {
            setEditing(false);
            commit(text);
            setText(formatNumber(Number(text.replace(',', '.')) || min));
          }}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-bold text-[#A8A29E]">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="mt-1.5 text-[11px] leading-relaxed text-[#78716C]">{hint}</p>}
    </div>
  );
};

/** Lista de interruptores com divisórias: um assunto por linha, estado à direita. */
export const SwitchGroup: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="divide-y divide-[#F5F5F4] overflow-hidden rounded-xl border border-[#E7E5E4]">{children}</div>
);

export const SwitchRow: React.FC<{
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}> = ({ label, description, checked, onChange, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-[#FAFAF9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#B91C1C]/40 disabled:cursor-not-allowed disabled:opacity-50"
  >
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-bold text-[#1C1917]">{label}</span>
      {description && <span className="mt-0.5 block text-xs leading-relaxed text-[#78716C]">{description}</span>}
    </span>
    <SwitchDot checked={checked} />
  </button>
);

/** Só o desenho do interruptor — quem recebe o clique é a linha inteira. */
export const SwitchDot: React.FC<{ checked: boolean }> = ({ checked }) => (
  <span
    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
      checked ? 'bg-[#059669]' : 'bg-[#D6D3D1]'
    }`}
  >
    <span
      className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-[22px]' : 'translate-x-[2px]'
      }`}
    />
  </span>
);

/** Bloco recolhido para o que quase ninguém mexe (coordenadas, tokens). */
export const Advanced: React.FC<{ summary: string; children: React.ReactNode }> = ({ summary, children }) => (
  <details className="group rounded-xl border border-[#E7E5E4] bg-[#FAFAF9] px-3 py-2.5">
    <summary className="cursor-pointer list-none text-xs font-bold text-[#57534E] transition-colors hover:text-[#1C1917] [&::-webkit-details-marker]:hidden">
      <span className="inline-flex items-center gap-1.5">
        <span className="transition-transform group-open:rotate-90">›</span>
        {summary}
      </span>
    </summary>
    <div className="mt-3 space-y-3 pb-1">{children}</div>
  </details>
);
