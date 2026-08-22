import React, { useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import type { ShopStatus } from '../../../contract/shop/platform';

export const PlatformResetPinModal: React.FC<{
  shop: ShopStatus;
  onClose: () => void;
  onConfirm: (pin: string) => Promise<void>;
}> = ({ shop, onClose, onConfirm }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onConfirm(pin);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível redefinir o PIN.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0C0A09]/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-3xl border border-[#E7E5E4] bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold text-[#1C1917]">Redefinir PIN da cozinha</h2>
            <p className="mt-1 text-xs text-[#57534E]">{shop.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#A8A29E] transition hover:bg-[#F5F5F4] hover:text-[#1C1917]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <label htmlFor="reset-pin-input" className="sr-only">
              Novo PIN
            </label>
            <KeyRound className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#57534E]" />
            <input
              id="reset-pin-input"
              type="text"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Novo PIN (mín. 4 números)"
              className="w-full rounded-2xl border border-[#E7E5E4] bg-[#F5F5F4] py-3 pl-10 pr-4 text-center text-sm font-bold tracking-[0.3em] text-[#1C1917] placeholder-[#A8A29E] placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-[#1C1917]"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-2 py-2 text-[11px] font-bold text-[#B91C1C]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving || pin.trim().length < 4}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-[#1C1917] py-3 font-extrabold text-white shadow-md transition hover:bg-[#292524] disabled:opacity-50"
          >
            {saving && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
            <span>{saving ? 'Salvando…' : 'Redefinir PIN'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
