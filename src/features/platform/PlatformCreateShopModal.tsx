import React, { useState } from 'react';
import { Check, Copy, PartyPopper, Store, X } from 'lucide-react';
import { platformApi } from './platformApi';
import { slugSugerido } from '../../../contract/shop/platform';

interface NovaLojaCriada {
  id: number;
  slug: string;
  name: string;
  url: string | null;
}

const FIELD =
  'w-full rounded-2xl border border-[#E7E5E4] bg-[#F5F5F4] py-2.5 px-3.5 text-sm font-bold text-[#1C1917] placeholder-[#A8A29E] placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-[#1C1917]';
const LABEL = 'mb-1 block text-[11px] font-bold uppercase tracking-wide text-[#78716C]';

export const PlatformCreateShopModal: React.FC<{
  onClose: () => void;
  onCreated: () => void;
}> = ({ onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  /**
   * O endereço para de seguir o nome assim que alguém o edita à mão.
   *
   * Sem esta trava, terminar de digitar o nome apagaria o endereço que o
   * usuário acabou de escolher — e o endereço não pode ser trocado depois sem
   * quebrar o link que os clientes já salvaram.
   */
  const [slugEditado, setSlugEditado] = useState(false);
  const [city, setCity] = useState('');
  const [brandPrimaryColor, setBrandPrimaryColor] = useState('#B91C1C');
  const [kitchenPin, setKitchenPin] = useState('');
  const [pixKey, setPixKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<NovaLojaCriada | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const shop = await platformApi.post<NovaLojaCriada>('/shops', {
        name,
        slug,
        city: city || undefined,
        brandPrimaryColor: brandPrimaryColor || undefined,
        kitchenPin: kitchenPin || undefined,
        pixKey: pixKey || undefined,
      });
      setCreated(shop);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar a loja.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!created) return;
    try {
      if (created.url) await navigator.clipboard.writeText(created.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Não deu para copiar automaticamente. Selecione o link e copie manualmente.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0C0A09]/60 p-4" onClick={created ? undefined : onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-[#E7E5E4] bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {created ? (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ECFDF5] text-[#059669]">
              <PartyPopper className="h-7 w-7" />
            </div>
            <h2 className="text-base font-extrabold text-[#1C1917]">Loja criada: {created.name}</h2>
            <p className="mt-1 mb-4 text-xs text-[#57534E]">Envie este link para o dono da loja.</p>
            <div className="flex items-center gap-2 rounded-2xl border border-[#E7E5E4] bg-[#F5F5F4] py-2.5 pl-3.5 pr-2">
              <span className="flex-1 truncate text-left text-xs font-bold text-[#1C1917]">
                {created.url ?? 'Sem endereço: configure SHOP_BASE_DOMAIN no servidor.'}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="flex shrink-0 items-center gap-1 rounded-xl bg-[#1C1917] px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-[#292524]"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            {error && <p className="mt-3 text-[11px] font-bold text-[#B91C1C]">{error}</p>}
            <button
              type="button"
              onClick={onClose}
              className="mt-5 w-full rounded-full bg-[#1C1917] py-3 font-extrabold text-white shadow-md transition hover:bg-[#292524]"
            >
              Concluir
            </button>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1C1917] text-white">
                  <Store className="h-5 w-5" />
                </div>
                <h2 className="text-base font-extrabold text-[#1C1917]">Nova loja</h2>
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
              <div>
                <label htmlFor="shop-name" className={LABEL}>
                  Nome da loja
                </label>
                <input
                  id="shop-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    // O endereço acompanha o nome até alguém mexer nele.
                    if (!slugEditado) setSlug(slugSugerido(e.target.value));
                  }}
                  placeholder="Caldinho da Vila"
                  className={FIELD}
                />
              </div>

              <div>
                <label htmlFor="shop-slug" className={LABEL}>
                  Endereço (slug)
                </label>
                <input
                  id="shop-slug"
                  value={slug}
                  onChange={(e) => {
                    setSlugEditado(true);
                    setSlug(slugSugerido(e.target.value));
                  }}
                  placeholder="caldinho-da-vila"
                  className={FIELD}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="shop-city" className={LABEL}>
                    Cidade
                  </label>
                  <input id="shop-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Opcional" className={FIELD} />
                </div>
                <div>
                  <label htmlFor="shop-color" className={LABEL}>
                    Cor da marca
                  </label>
                  <input
                    id="shop-color"
                    type="color"
                    value={brandPrimaryColor}
                    onChange={(e) => setBrandPrimaryColor(e.target.value)}
                    className="h-[42px] w-full cursor-pointer rounded-2xl border border-[#E7E5E4] bg-[#F5F5F4] p-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="shop-pin" className={LABEL}>
                    PIN inicial
                  </label>
                  <input
                    id="shop-pin"
                    inputMode="numeric"
                    value={kitchenPin}
                    onChange={(e) => setKitchenPin(e.target.value)}
                    placeholder="Padrão: 1234"
                    className={FIELD}
                  />
                </div>
                <div>
                  <label htmlFor="shop-pix" className={LABEL}>
                    Chave PIX
                  </label>
                  <input id="shop-pix" value={pixKey} onChange={(e) => setPixKey(e.target.value)} placeholder="Opcional" className={FIELD} />
                </div>
              </div>

              {error && (
                <p role="alert" className="rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-2 py-2 text-[11px] font-bold text-[#B91C1C]">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={saving || !name.trim() || !slug.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-[#1C1917] py-3 font-extrabold text-white shadow-md transition hover:bg-[#292524] disabled:opacity-50"
              >
                {saving && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                <span>{saving ? 'Criando…' : 'Criar loja'}</span>
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
