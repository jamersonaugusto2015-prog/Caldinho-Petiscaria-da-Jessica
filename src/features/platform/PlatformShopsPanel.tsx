import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Store, WifiOff } from 'lucide-react';
import { platformApi } from './platformApi';
import { PlatformShopRow } from './PlatformShopRow';
import { PlatformCreateShopModal } from './PlatformCreateShopModal';
import { PlatformResetPinModal } from './PlatformResetPinModal';
import type { ShopStatus } from '../../../contract/shop/platform';

const LoadErrorScreen: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#FEF2F2] text-[#B91C1C]">
      <WifiOff className="h-8 w-8" />
    </div>
    <div>
      <h2 className="text-lg font-extrabold text-[#1C1917]">Não foi possível carregar as lojas</h2>
      <p className="mt-1.5 max-w-xs text-xs text-[#57534E]">Verifique sua conexão com a internet e tente de novo.</p>
    </div>
    <button onClick={onRetry} className="btn-primary px-6 py-3">
      Tentar de novo
    </button>
  </div>
);

export const PlatformShopsPanel: React.FC = () => {
  const [shops, setShops] = useState<ShopStatus[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetPinShop, setResetPinShop] = useState<ShopStatus | null>(null);

  const fetchShops = useCallback(() => {
    setLoadError(false);
    return platformApi
      .get<ShopStatus[]>('/shops')
      .then(setShops)
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    void fetchShops();
  }, [fetchShops]);

  const handleToggleActive = async (shop: ShopStatus) => {
    const updated = await platformApi.patch<ShopStatus>(`/shops/${shop.id}`, { active: !shop.active });
    setShops((current) => current?.map((s) => (s.id === shop.id ? { ...s, ...updated } : s)) ?? current);
  };

  const handleResetPin = async (pin: string) => {
    if (!resetPinShop) return;
    await platformApi.post<{ ok: true }>(`/shops/${resetPinShop.id}/reset-pin`, { pin });
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#1C1917] text-white">
            <Store className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-[#1C1917]">Lojas</h1>
            <p className="text-xs text-[#57534E]">{shops ? `${shops.length} ${shops.length === 1 ? 'loja cadastrada' : 'lojas cadastradas'}` : 'Carregando…'}</p>
          </div>
        </div>
        <button type="button" onClick={() => setCreateOpen(true)} className="btn-primary shrink-0">
          <Plus className="h-3.5 w-3.5" />
          Nova loja
        </button>
      </div>

      {loadError && <LoadErrorScreen onRetry={fetchShops} />}

      {!loadError && shops === null && (
        <div className="flex justify-center py-16">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#E7E5E4] border-t-[#1C1917]" />
        </div>
      )}

      {!loadError && shops !== null && shops.length === 0 && (
        <p className="rounded-2xl border border-dashed border-[#E7E5E4] py-10 text-center text-xs italic text-[#A8A29E]">
          Nenhuma loja cadastrada ainda.
        </p>
      )}

      {!loadError && shops !== null && shops.length > 0 && (
        <div className="space-y-3">
          {shops.map((shop) => (
            <PlatformShopRow key={shop.id} shop={shop} onToggleActive={handleToggleActive} onResetPin={setResetPinShop} />
          ))}
        </div>
      )}

      {createOpen && <PlatformCreateShopModal onClose={() => setCreateOpen(false)} onCreated={() => void fetchShops()} />}
      {resetPinShop && (
        <PlatformResetPinModal shop={resetPinShop} onClose={() => setResetPinShop(null)} onConfirm={handleResetPin} />
      )}
    </div>
  );
};
