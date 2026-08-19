import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useCart } from './CartStore';
import { useCheckout } from './CheckoutStore';
import { useClientShell } from './ClientStore';
import { api } from '../../lib/api';
import { LiveMap } from '../../components/common/LiveMap';
import { computeDeliveryFee, effectiveDistanceKm, formatKm } from '../../shared/geo';
import {
  ShoppingBag,
  MapPin,
  Search,
  Award,
  ChevronDown,
  Plus,
  X,
  Soup,
  Check,
  Flame,
  Loader2,
  LocateFixed,
  Trash2,
} from 'lucide-react';
import { formatAddressLine, isUsableAddress } from '../../shared/address';
import { LOYALTY_STAMP_COST } from '../../shared/constants';

interface CepResult {
  cep: string;
  street: string;
  neighborhood: string;
  city: string;
}

export const ClientHeader: React.FC = () => {
  const {
    cart,
    setIsCartOpen,
    addresses,
    selectedAddress,
    setSelectedAddress,
    addAddress,
    removeAddress,
    isAddressModalOpen,
    isAddressFormOpen,
    setAddressModalOpen,
    setAddressFormOpen,
  } = useCart();
  const { loyaltyPoints, orders, setTrackingOrderId } = useCheckout();
  const { searchQuery, setSearchQuery, storeLogo, storeName, city, settings, notificationToast } = useClientShell();

  const [isSearchFocused, setIsSearchFocused] = useState(false);

  const [newLabel, setNewLabel] = useState('');
  const [newStreet, setNewStreet] = useState('');
  const [newNumber, setNewNumber] = useState('');
  const [newNeighborhood, setNewNeighborhood] = useState('');
  const [newComplement, setNewComplement] = useState('');
  const [newCep, setNewCep] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [newLat, setNewLat] = useState<number | null>(null);
  const [newLng, setNewLng] = useState<number | null>(null);

  const cartTotalCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const activeOrder = useMemo(
    () =>
      orders.find((o) => ['recebido', 'em_preparo', 'pronto', 'saiu_entrega'].includes(o.status)) || null,
    [orders]
  );

  const previewAddress =
    newLat != null && newLng != null
      ? {
          id: '',
          label: '',
          street: '',
          number: '',
          neighborhood: '',
          city: '',
          lat: newLat,
          lng: newLng,
          distanceKm: 0,
        }
      : null;

  const distancePreview = previewAddress ? effectiveDistanceKm(previewAddress, settings) : 0;
  const feePreview = previewAddress ? computeDeliveryFee(previewAddress, settings) : null;

  const handleCepLookup = async () => {
    const cep = newCep.replace(/\D/g, '');
    if (cep.length !== 8) {
      setGeoError('Informe um CEP válido com 8 dígitos.');
      return;
    }
    setGeoError('');
    setIsLocating(true);
    try {
      const r = await api.get<CepResult>(`/cep/${cep}`);
      setNewStreet(r.street || newStreet);
      setNewNeighborhood(r.neighborhood || newNeighborhood);
      await geocodeAddress(r.street, r.neighborhood, r.city, newNumber);
    } catch (err) {
      setGeoError(err instanceof Error ? err.message : 'CEP não encontrado.');
    } finally {
      setIsLocating(false);
    }
  };

  // CEP completo (8 dígitos): preenche os campos automaticamente, sem apertar botão
  useEffect(() => {
    if (newCep.replace(/\D/g, '').length !== 8 || isLocating) return;
    void handleCepLookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newCep]);

  const geocodeAddress = async (street?: string, neighborhood?: string, cityName?: string, number?: string) => {
    setIsLocating(true);
    setGeoError('');
    const query = [street, number, neighborhood, cityName || city].filter(Boolean).join(', ');
    try {
      const r = await api.post<{ lat: number; lng: number; label: string }>('/geocode', { query });
      setNewLat(r.lat);
      setNewLng(r.lng);
    } catch (err) {
      setGeoError(
        err instanceof Error
          ? err.message
          : 'Não foi possível localizar. Ajuste o pino no mapa manualmente.'
      );
    } finally {
      setIsLocating(false);
    }
  };

  const handleCreateAddress = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStreet || !newNumber || !newNeighborhood) return;
    const wasEmpty = addresses.length === 0;
    addAddress({
      label: newLabel || 'Outro',
      street: newStreet,
      number: newNumber,
      neighborhood: newNeighborhood,
      city: city,
      complement: newComplement,
      cep: newCep.replace(/\D/g, '') || undefined,
      lat: newLat ?? undefined,
      lng: newLng ?? undefined,
      distanceKm: distancePreview,
    });
    setNewLabel('');
    setNewStreet('');
    setNewNumber('');
    setNewNeighborhood('');
    setNewComplement('');
    setNewCep('');
    setNewLat(null);
    setNewLng(null);
    setGeoError('');
    if (wasEmpty) {
      // veio do checkout sem endereço: fecha o modal e volta para o pedido
      setAddressModalOpen(false);
      setAddressFormOpen(false);
    } else {
      setAddressFormOpen(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-[#B91C1C] text-white shadow-lg">
      {notificationToast && (
        <div className="fixed top-0 left-0 right-0 z-[80] bg-[#991B1B] text-white px-4 py-2 text-center text-[11px] font-bold flex items-center justify-center gap-2 shadow-lg">
          <Soup className="w-3.5 h-3.5 text-[#FDE68A] animate-bounce" />
          <span>{notificationToast}</span>
        </div>
      )}

      {/* MAIN ROW */}
      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          {/* LEFT: Brand */}
          <Link to="/" className="flex items-center gap-2.5 cursor-pointer group select-none">
            {storeLogo ? (
              <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center overflow-hidden shadow-inner group-hover:bg-white/25 transition-colors">
                <img src={storeLogo} alt="Logo Caldinho Express" className="w-full h-full object-contain p-1" />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center shadow-inner group-hover:bg-white/25 transition-colors">
                <Flame className="w-5 h-5 text-[#FDE68A]" strokeWidth={2.5} />
              </div>
            )}
            <div>
              <div className="flex items-baseline gap-1 leading-none">
                <span className="font-black text-[17px] tracking-tight">{storeName}</span>
              </div>
              <span className="text-[9px] uppercase tracking-widest text-white/60 font-bold">
                {settings.isOpen ? 'Aberto agora' : 'Fechado no momento'} &bull; {city}
              </span>
            </div>
          </Link>

          {/* RIGHT: Loyalty + Cart */}
          <div className="flex items-center gap-2">
            {loyaltyPoints > 0 && (
              <div
                className="flex items-center gap-1 bg-white/15 backdrop-blur-sm px-2.5 py-1.5 rounded-xl text-[10px] font-bold"
                title="Fidelidade"
              >
                <Award className="w-3.5 h-3.5 text-[#FDE68A]" />
                <span>{loyaltyPoints}/{LOYALTY_STAMP_COST}</span>
              </div>
            )}

            {activeOrder && (
              <button
                onClick={() => setTrackingOrderId(activeOrder.id)}
                className="flex items-center gap-1.5 bg-white/15 backdrop-blur-sm hover:bg-white/25 text-white px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80] animate-pulse" />
                <span>Pedido {activeOrder.id}</span>
              </button>
            )}

            <button
              onClick={() => setIsCartOpen(true)}
              className="relative bg-white text-[#B91C1C] w-10 h-10 rounded-xl flex items-center justify-center shadow-md hover:bg-[#FEF2F2] transition-colors active:scale-95"
              aria-label="Abrir Sacola"
            >
              <ShoppingBag className="w-5 h-5" strokeWidth={2.5} />
              {cartTotalCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-[#D97706] text-white text-[9px] font-black min-w-[18px] h-[18px] rounded-full flex items-center justify-center border-2 border-[#B91C1C] shadow-sm">
                  {cartTotalCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ADDRESS + SEARCH ROW */}
      <div className="bg-white shadow-sm">
        <div className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setAddressFormOpen(false);
                setAddressModalOpen(true);
              }}
              className="flex items-center gap-2 flex-1 min-w-0 bg-[#F5F5F4] hover:bg-[#E7E5E4] rounded-xl px-3 py-2 transition-colors group"
            >
              <MapPin className="w-4 h-4 text-[#B91C1C] shrink-0 group-hover:scale-110 transition-transform" />
              <div className="flex-1 min-w-0 text-left">
                <span className="text-[9px] text-[#A8A29E] font-bold uppercase tracking-wider block">
                  Entregar em
                </span>
                <span className="text-[12px] font-bold text-[#1C1917] truncate block">
                  {isUsableAddress(selectedAddress)
                    ? formatAddressLine(selectedAddress)
                    : 'Selecione seu endereço'}
                </span>
              </div>
              <ChevronDown className="w-4 h-4 text-[#78716C] shrink-0" />
            </button>

            <div className="relative flex-1 max-w-xs">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#A8A29E]" />
              <input
                type="text"
                value={searchQuery}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar..."
                className={`w-full bg-[#F5F5F4] text-[#1C1917] placeholder-[#A8A29E] text-[12px] font-medium rounded-xl pl-9 pr-8 py-2 border transition-all ${
                  isSearchFocused
                    ? 'border-[#B91C1C] bg-white ring-2 ring-[#B91C1C]/15'
                    : 'border-transparent'
                }`}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#A8A29E] hover:text-[#1C1917]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Address Modal */}
      {isAddressModalOpen &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-xs"
              onClick={() => {
                setAddressModalOpen(false);
                setAddressFormOpen(false);
              }}
            />
            <div className="bg-white text-[#1C1917] rounded-t-3xl sm:rounded-2xl p-6 w-full max-w-[430px] max-h-[90vh] sm:max-h-[85vh] shadow-2xl relative flex flex-col overflow-hidden z-10">
              <button
                onClick={() => {
                  setAddressModalOpen(false);
                  setAddressFormOpen(false);
                }}
                className="absolute top-4 right-4 p-2 rounded-full hover:bg-[#F5F5F4] text-[#57534E] z-20"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-lg font-extrabold mb-1 flex items-center gap-2">
                <MapPin className="w-5 h-5 text-[#B91C1C]" />
                <span>Endereço de Entrega</span>
              </h3>
              <p className="text-xs text-[#57534E] mb-4">
                Escolha para onde entregaremos seu caldinho fumegante.
              </p>

              {!isAddressFormOpen ? (
                <div className="space-y-3 overflow-y-auto pr-1 flex-1 min-h-0 pb-2">
                  {addresses.length === 0 && (
                    <div className="text-center text-xs text-[#A8A29E] py-6">
                      Nenhum endereço cadastrado ainda.
                    </div>
                  )}
                  {addresses.map((addr) => (
                    <div
                      key={addr.id}
                      onClick={() => {
                        setSelectedAddress(addr);
                        setAddressModalOpen(false);
                      }}
                      className={`p-3.5 rounded-2xl border cursor-pointer transition flex items-center justify-between gap-2 ${
                        selectedAddress?.id === addr.id
                          ? 'bg-[#FEF2F2] border-[#B91C1C] ring-2 ring-[#B91C1C]/20 shadow-xs'
                          : 'bg-[#F5F5F4]/70 border-[#E7E5E4] hover:bg-[#F5F5F4]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-[#1C1917]">{addr.label}</span>
                          <span className="text-[10px] bg-[#E7E5E4] text-[#57534E] px-2 py-0.5 rounded-full font-bold">
                            {addr.distanceKm > 0 ? `${formatKm(addr.distanceKm)}` : 'sem localização'}
                          </span>
                        </div>
                        <p className="text-xs text-[#57534E] mt-0.5 truncate">
                          {formatAddressLine(addr)}
                        </p>
                        {addr.complement && (
                          <p className="text-[11px] text-[#A8A29E] italic truncate">{addr.complement}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {selectedAddress?.id === addr.id && (
                          <div className="w-6 h-6 rounded-full bg-[#B91C1C] text-white flex items-center justify-center">
                            <Check className="w-4 h-4" />
                          </div>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`Remover o endereço "${addr.label}" (${addr.street}, ${addr.number})?`)) {
                              removeAddress(addr.id);
                            }
                          }}
                          className="p-2 rounded-full text-[#A8A29E] hover:text-[#B91C1C] hover:bg-[#FEF2F2] transition"
                          title="Remover endereço"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={() => setAddressFormOpen(true)}
                    className="w-full mt-2 py-2.5 rounded-xl border border-dashed border-[#B91C1C] hover:bg-[#FEF2F2] text-[#B91C1C] text-xs font-bold flex items-center justify-center gap-2 transition"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Cadastrar Novo Endereço</span>
                  </button>
                </div>
              ) : (
                <form onSubmit={handleCreateAddress} className="space-y-3 text-xs overflow-y-auto flex-1 min-h-0 pb-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[#1C1917] font-bold mb-1">Apelido</label>
                      <input
                        type="text"
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        placeholder="Ex: Casa"
                        className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-2 focus:ring-[#B91C1C]"
                      />
                    </div>
                    <div>
                      <label className="block text-[#1C1917] font-bold mb-1">CEP (preenche sozinho)</label>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={newCep}
                          onChange={(e) => setNewCep(e.target.value.replace(/\D/g, '').slice(0, 8))}
                          placeholder="50000000"
                          className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl px-2.5 py-2.5 text-[#1C1917] focus:outline-none focus:ring-2 focus:ring-[#B91C1C]"
                        />
                        <button
                          type="button"
                          onClick={handleCepLookup}
                          disabled={isLocating}
                          className="bg-[#FEF2F2] text-[#B91C1C] px-2.5 rounded-xl border border-[#FCA5A5] font-bold hover:bg-[#FEE2E2] disabled:opacity-50 shrink-0"
                          title="Buscar CEP novamente"
                        >
                          {isLocating ? <Loader2 className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4" />}
                        </button>
                      </div>
                      <p className="text-[9px] text-[#A8A29E] mt-1">
                        Ao completar 8 dígitos, rua, bairro e cidade preenchem automaticamente.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label className="block text-[#1C1917] font-bold mb-1">Rua / Av.</label>
                      <input
                        type="text"
                        value={newStreet}
                        onChange={(e) => setNewStreet(e.target.value)}
                        placeholder="Ex: Av. Conselheiro Aguiar"
                        className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-2 focus:ring-[#B91C1C]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[#1C1917] font-bold mb-1">Número</label>
                      <input
                        type="text"
                        value={newNumber}
                        onChange={(e) => setNewNumber(e.target.value)}
                        placeholder="100"
                        className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-2 focus:ring-[#B91C1C]"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[#1C1917] font-bold mb-1">Bairro</label>
                    <input
                      type="text"
                      value={newNeighborhood}
                      onChange={(e) => setNewNeighborhood(e.target.value)}
                      placeholder="Ex: Pina, Boa Viagem, Derby"
                      className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-2 focus:ring-[#B91C1C]"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[#1C1917] font-bold mb-1">Complemento / Ref.</label>
                    <input
                      type="text"
                      value={newComplement}
                      onChange={(e) => setNewComplement(e.target.value)}
                      placeholder="Apt 201 / Próximo ao mercado"
                      className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-2 focus:ring-[#B91C1C]"
                    />
                  </div>

                  <div className="rounded-2xl overflow-hidden border border-[#E7E5E4]">
                    <LiveMap
                      center={{ lat: settings.storeLat, lng: settings.storeLng }}
                      store={{ lat: settings.storeLat, lng: settings.storeLng, name: settings.storeName }}
                      pickPosition={newLat != null && newLng != null ? { lat: newLat, lng: newLng } : null}
                      onPick={(lat, lng) => {
                        setNewLat(lat);
                        setNewLng(lng);
                        setGeoError('');
                      }}
                      heightClass="h-44"
                    />
                    <div className="p-2 bg-[#F5F5F4]/60 text-[10px] text-[#57534E] flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-[#B91C1C]" />
                        Clique no mapa (ou arraste o pino) para definir a localização exata
                      </span>
                    </div>
                  </div>

                  {newLat != null && newLng != null && (
                    <div className="flex items-center justify-between bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl p-2.5 text-[11px] font-bold text-[#065F46]">
                      <span>
                        Distância da loja: {formatKm(distancePreview)}
                        {feePreview != null && feePreview < 0 && (
                          <span className="block text-[#B91C1C]">
                            Fora da área de entrega (máx. {settings.maxDeliveryKm} km)
                          </span>
                        )}
                      </span>
                      {feePreview != null && feePreview >= 0 && (
                        <span>Entrega: R$ {feePreview.toFixed(2)}</span>
                      )}
                    </div>
                  )}

                  {geoError && (
                    <div className="bg-[#FEF2F2] border border-[#FCA5A5] text-[#B91C1C] rounded-xl p-2.5 text-[11px] font-bold">
                      {geoError}
                    </div>
                  )}

                  <div className="flex gap-2 pt-2 sticky bottom-0 bg-white pb-1">
                    <button
                      type="button"
                      onClick={() => setAddressFormOpen(false)}
                      className="flex-1 py-2.5 rounded-xl bg-[#E7E5E4] text-[#1C1917] hover:bg-[#D6D3D1] font-bold"
                    >
                      Voltar
                    </button>
                    <button
                      type="submit"
                      disabled={newLat == null || newLng == null}
                      className="flex-1 py-2.5 rounded-xl bg-[#B91C1C] hover:bg-[#991B1B] text-white font-bold shadow-sm disabled:opacity-40"
                    >
                      Salvar Endereço
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>,
          document.body
        )}
    </header>
  );
};
