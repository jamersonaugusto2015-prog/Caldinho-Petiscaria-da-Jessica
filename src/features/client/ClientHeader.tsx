import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useCart } from './CartStore';
import { useCheckout } from './CheckoutStore';
import { useClientShell } from './ClientStore';
import { api } from '../../lib/api';
import { AlertBanner, AlertPermissionPrompt } from '../../ui/alertBanner';
import { useInstallAffordance, useUpdateReady } from '../../lib/appShell';
import { computeDeliveryFee, effectiveDistanceKm, formatKm } from '../../../contract/pricing/geo';
import {
  MapPin,
  Search,
  Award,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  Check,
  Download,
  Flame,
  Loader2,
  LocateFixed,
  RefreshCw,
  Share,
  Store,
  Trash2,
} from 'lucide-react';
import { formatAddressLine, isUsableAddress } from '../../../contract/order/address';
import { storeAddressLine } from '../../../contract/order/fulfillment';
import { formatMoney } from '../../../contract/pricing/money';
/**
 * O mapa entra por `lazy`: o Leaflet e o CSS dele somam ~170 kB e só aparecem
 * quando o cliente abre o formulário de endereço para marcar o pino. Importado
 * direto, todo mundo que abre o cardápio pagava esse download antes de ver a
 * primeira sopa — inclusive quem já tem o endereço salvo e nunca abre o mapa.
 */
const LiveMap = lazy(() =>
  import('../../components/common/LiveMap').then((module) => ({ default: module.LiveMap }))
);

/** Mesma faixa fina do convite de notificação: um vocabulário só no topo vermelho. */
const CLIENT_STRIP =
  'flex items-center gap-2 bg-[#991B1B] px-3 py-1.5 text-[11px] font-semibold text-white/90';
/**
 * Alvo de toque de ~44 px sem mexer no desenho: a área clicável cresce por um
 * `::before` invisível. Subir o padding esticaria a faixa vermelha de 26 px
 * para 44 px e empurraria o cardápio inteiro tela abaixo. A folga horizontal é
 * curta de propósito — a faixa tem dois botões colados e alvos sobrepostos
 * fariam o cliente descartar o convite querendo instalar o app.
 */
const STRIP_TAP_TARGET = "relative before:absolute before:-inset-y-3 before:-inset-x-1 before:content-['']";

const CLIENT_STRIP_ACTION =
  `shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white active:bg-white/25 ${STRIP_TAP_TARGET}`;

/** Do tamanho exato do mapa, para a ficha do endereço não pular ao carregar. */
const MapPlaceholder: React.FC<{ heightClass: string }> = ({ heightClass }) => (
  <div className={`${heightClass} bg-[#F5F5F4]`} aria-hidden />
);

interface CepResult {
  cep: string;
  street: string;
  neighborhood: string;
  city: string;
}

export const ClientHeader: React.FC = () => {
  const {
    addresses,
    selectedAddress,
    setSelectedAddress,
    addAddress,
    removeAddress,
    isAddressModalOpen,
    isAddressFormOpen,
    setAddressModalOpen,
    setAddressFormOpen,
    fulfillment,
  } = useCart();
  const { loyaltyPoints, orders, setTrackingOrderId, alertChannel } = useCheckout();
  const { searchQuery, setSearchQuery, storeLogo, storeName, city, settings } = useClientShell();
  const install = useInstallAffordance('ce_install_hint_client');
  const updateReady = useUpdateReady();

  const isPickupMode = fulfillment === 'pickup';

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  // busca com texto continua aberta mesmo depois de perder o foco
  const searchOpen = isSearchOpen || searchQuery.length > 0;

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

  const activeOrder = useMemo(
    () =>
      orders.find((o) => ['recebido', 'em_preparo', 'pronto', 'saiu_entrega'].includes(o.status)) || null,
    [orders]
  );

  const activeOrderLabel = useMemo(() => {
    if (!activeOrder) return '';
    const isPickupOrder = activeOrder.fulfillment === 'pickup';
    switch (activeOrder.status) {
      case 'recebido':
        return 'Pedido recebido';
      case 'em_preparo':
        return 'Em preparo';
      case 'pronto':
        if (isPickupOrder) return 'Pronto para retirada';
        // Corrida já aceita, motoboy ainda indo buscar: o status só vira
        // `saiu_entrega` quando ele retira o pedido no balcão.
        return activeOrder.driverId ? 'Motoboy a caminho da loja' : 'Pronto';
      case 'saiu_entrega':
        return 'Saiu para entrega';
      default:
        return 'Pedido em andamento';
    }
  }, [activeOrder]);

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
    // `pt-safe`: instalado, o app desenha sob o notch e o nome da loja ficava
    // atrás do relógio do sistema.
    <header className="pt-safe sticky top-0 z-40 bg-[#B91C1C] text-white shadow-[0_2px_12px_rgba(0,0,0,0.14)]">
      <AlertBanner variant="client" />

      {/* Sem recarga automática: o cliente pode estar no meio do checkout. */}
      {updateReady && (
        <div className={CLIENT_STRIP}>
          <RefreshCw className="w-3.5 h-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Versão nova disponível.</span>
          <button type="button" onClick={() => window.location.reload()} className={CLIENT_STRIP_ACTION}>
            Atualizar
          </button>
        </div>
      )}

      {install.kind !== 'none' && (
        <div className={CLIENT_STRIP}>
          {install.kind === 'prompt' ? (
            <>
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">Instale o app e acompanhe o pedido.</span>
              {/* Dentro do clique: fora de um gesto o Chrome descarta o diálogo. */}
              <button type="button" onClick={install.install} className={CLIENT_STRIP_ACTION}>
                Instalar app
              </button>
            </>
          ) : (
            <>
              <Share className="w-3.5 h-3.5 shrink-0" />
              {/* No iPhone este é o ÚNICO caminho para o push existir: fora do
                  app instalado o Safari nem expõe o `PushManager`. */}
              <span className="min-w-0 flex-1 truncate">
                Para receber avisos: Compartilhar → Adicionar à Tela de Início.
              </span>
            </>
          )}
          <button
            type="button"
            onClick={install.dismiss}
            aria-label="Agora não"
            className={`shrink-0 rounded-lg p-1 text-white/60 active:bg-white/15 ${STRIP_TAP_TARGET}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* LINHA 1: marca + ações. Tudo em uma linha só, sem quebra de texto. */}
      <div className="h-14 px-3 flex items-center gap-2.5">
        <Link to="/" className="group flex items-center gap-2.5 flex-1 min-w-0 select-none">
          <span className="w-9 h-9 shrink-0 rounded-xl bg-white/15 flex items-center justify-center overflow-hidden transition-transform group-active:scale-95">
            {storeLogo ? (
              <img src={storeLogo} alt={storeName} className="w-full h-full object-contain p-0.5" />
            ) : (
              <Flame className="w-[18px] h-[18px] text-[#FDE68A]" strokeWidth={2.5} />
            )}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-extrabold leading-tight tracking-tight truncate">
              {storeName}
            </span>
            <span className="flex items-center gap-1.5 mt-1 min-w-0">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  settings.isOpen ? 'bg-[#4ADE80]' : 'bg-[#FCA5A5]'
                }`}
              />
              <span className="text-[10px] font-semibold leading-none text-white/70 truncate">
                {settings.isOpen ? 'Aberto agora' : 'Fechado'} &bull; {city}
              </span>
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-1.5 shrink-0">
          {loyaltyPoints > 0 && (
            <span
              className="h-9 px-2.5 rounded-xl bg-white/15 flex items-center gap-1 text-[11px] font-bold tabular-nums"
              title="Cartão fidelidade"
            >
              <Award className="w-3.5 h-3.5 text-[#FDE68A]" strokeWidth={2.5} />
              {loyaltyPoints}/{settings.loyaltyStampCost || 10}
            </span>
          )}
        </div>
      </div>

      {/* LINHA 2: pedido em andamento. Fica fora da linha da marca para não
          disputar espaço com o nome da loja em telas estreitas. */}
      {activeOrder && (
        <button
          onClick={() => setTrackingOrderId(activeOrder.id)}
          className="w-full h-9 px-3 flex items-center gap-2 bg-[#991B1B] text-left transition-colors active:bg-[#7F1D1D]"
        >
          <span className="relative flex w-2 h-2 shrink-0">
            <span className="absolute inset-0 rounded-full bg-[#4ADE80] opacity-75 animate-ping" />
            <span className="relative w-2 h-2 rounded-full bg-[#4ADE80]" />
          </span>
          <span className="flex-1 min-w-0 text-[11px] font-bold truncate">
            {activeOrderLabel} &bull; {activeOrder.id}
          </span>
          <span className="text-[10px] font-bold text-white/70 shrink-0">Acompanhar</span>
          <ChevronRight className="w-3.5 h-3.5 text-white/70 shrink-0" />
        </button>
      )}

      {/* O aviso do sistema é a única forma de o cliente saber que o pedido saiu
          com o app fechado. Pedido por botão, uma linha só, e some para sempre
          quando ele diz "agora não". */}
      <AlertPermissionPrompt
        channel={alertChannel}
        storageKey="ce_client_notify_prompt"
        label="Receber aviso quando seu pedido andar"
        tone="client"
      />

      {/* LINHA 3: endereço + busca. A busca abre no lugar do endereço para
          caber inteira em 430px, no lugar de dois campos espremidos. */}
      <div className="bg-white border-b border-[#E7E5E4] px-3 py-2">
        {searchOpen ? (
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#A8A29E]" />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar no cardápio"
              className="w-full h-10 rounded-xl bg-[#F5F5F4] border border-[#E7E5E4] pl-9 pr-10 text-[13px] font-medium text-[#1C1917] placeholder-[#A8A29E] focus-visible:outline-none focus-visible:bg-white focus-visible:border-[#B91C1C] focus-visible:ring-2 focus-visible:ring-[#B91C1C]/15 transition-colors"
            />
            {/* 32 px é menos que o dedo: quem quer limpar a busca acerta o
                campo e o teclado sobe de novo. O ícone fica no mesmo lugar
                (right-0 + 40 px = right-1 + 32 px), só a área cresce. */}
            <button
              onClick={() => {
                setSearchQuery('');
                setIsSearchOpen(false);
              }}
              className="absolute right-0 top-1/2 -translate-y-1/2 w-10 h-10 rounded-lg flex items-center justify-center text-[#78716C] active:bg-[#E7E5E4]"
              aria-label="Fechar busca"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {/* Na retirada não existe endereço do cliente: a barra mostra a loja e
                não abre nada, senão o cliente acha que ainda precisa cadastrar. */}
            {isPickupMode ? (
              <div className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-[#ECFDF5] flex items-center gap-2">
                <Store className="w-4 h-4 text-[#059669] shrink-0" strokeWidth={2.5} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[9px] font-bold uppercase tracking-wider leading-none text-[#059669]">
                    Retirar na loja
                  </span>
                  <span className="block text-[12px] font-bold leading-tight text-[#065F46] truncate mt-1">
                    {storeAddressLine(settings)}
                  </span>
                </span>
              </div>
            ) : (
              <button
                onClick={() => {
                  setAddressFormOpen(false);
                  setAddressModalOpen(true);
                }}
                className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-[#F5F5F4] flex items-center gap-2 transition-colors active:bg-[#E7E5E4]"
              >
                <MapPin className="w-4 h-4 text-[#B91C1C] shrink-0" strokeWidth={2.5} />
                <span className="flex-1 min-w-0 text-left">
                  <span className="block text-[9px] font-bold uppercase tracking-wider leading-none text-[#A8A29E]">
                    Entregar em
                  </span>
                  <span className="block text-[12px] font-bold leading-tight text-[#1C1917] truncate mt-1">
                    {isUsableAddress(selectedAddress)
                      ? formatAddressLine(selectedAddress)
                      : 'Selecione seu endereço'}
                  </span>
                </span>
                <ChevronDown className="w-4 h-4 text-[#78716C] shrink-0" />
              </button>
            )}

            <button
              onClick={() => setIsSearchOpen(true)}
              className="w-10 h-10 shrink-0 rounded-xl bg-[#F5F5F4] text-[#57534E] flex items-center justify-center transition-colors active:bg-[#E7E5E4]"
              aria-label="Buscar no cardápio"
            >
              <Search className="w-4 h-4" strokeWidth={2.5} />
            </button>
          </div>
        )}
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
            {/* `dvh` e não `vh`: com `vh` a folha nascia mais alta que a tela do
                iPhone (o `vh` ignora a barra do Safari) e o botão "Salvar
                Endereço" ficava abaixo do fim da tela, sem rolagem que o
                alcançasse. O `pb` extra tira o rodapé de cima da barra de
                gestos. */}
            <div className="bg-white text-[#1C1917] rounded-t-3xl sm:rounded-2xl p-6 pb-[calc(env(safe-area-inset-bottom)+24px)] w-full max-w-[430px] max-h-[90dvh] sm:max-h-[85dvh] shadow-2xl relative flex flex-col overflow-hidden z-10">
              {/* 36 px → 44 px sem mexer no ícone: top-3/right-3 + 44 px deixa o
                  X exatamente onde top-4/right-4 + 36 px deixava. */}
              <button
                onClick={() => {
                  setAddressModalOpen(false);
                  setAddressFormOpen(false);
                }}
                className="absolute top-3 right-3 min-h-11 min-w-11 flex items-center justify-center rounded-full hover:bg-[#F5F5F4] text-[#57534E] z-20"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-lg font-extrabold mb-1 flex items-center gap-2">
                <MapPin className="w-5 h-5 text-[#B91C1C]" />
                <span>Endereço de Entrega</span>
              </h3>
              <p className="text-xs text-[#57534E] mb-4">
                Escolha o endereço de entrega.
              </p>

              {!isAddressFormOpen ? (
                <div className="space-y-3 overflow-y-auto overscroll-contain pr-1 flex-1 min-h-0 pb-2">
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
                            if (window.confirm(`Remover o endereço “${addr.label}” (${addr.street}, ${addr.number})?`)) {
                              removeAddress(addr.id);
                            }
                          }}
                          className="min-h-11 min-w-11 flex items-center justify-center rounded-full text-[#A8A29E] hover:text-[#B91C1C] hover:bg-[#FEF2F2] transition"
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
                // `overscroll-contain`: chegando ao fim da lista, continuar
                // puxando arrastava a página do cardápio atrás da folha.
                <form onSubmit={handleCreateAddress} className="space-y-3 text-xs overflow-y-auto overscroll-contain flex-1 min-h-0 pb-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[#1C1917] font-bold mb-1">Apelido</label>
                      <input
                        type="text"
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        placeholder="Ex: Casa"
                        className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 text-[#1C1917] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B91C1C]"
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
                          className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl px-2.5 py-2.5 text-[#1C1917] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B91C1C]"
                        />
                        <button
                          type="button"
                          onClick={handleCepLookup}
                          disabled={isLocating}
                          className="bg-[#FEF2F2] text-[#B91C1C] px-2.5 min-h-11 min-w-11 flex items-center justify-center rounded-xl border border-[#FCA5A5] font-bold hover:bg-[#FEE2E2] disabled:opacity-50 shrink-0"
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
                        className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 text-[#1C1917] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B91C1C]"
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
                        className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 text-[#1C1917] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B91C1C]"
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
                      className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 text-[#1C1917] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B91C1C]"
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
                      className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 text-[#1C1917] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B91C1C]"
                    />
                  </div>

                  <div className="rounded-2xl overflow-hidden border border-[#E7E5E4]">
                    <Suspense fallback={<MapPlaceholder heightClass="h-44" />}>
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
                    </Suspense>
                    <div className="p-2 bg-[#F5F5F4]/60 text-[10px] text-[#57534E] flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-[#B91C1C]" />
                        Clique no mapa (ou arraste o pino) para definir a localização exata
                      </span>
                    </div>
                  </div>

                  {newLat != null && newLng != null && (
                    <div className="flex items-center justify-between bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl p-2.5 text-[11px] font-bold text-[#065F46]">
                      <span className="min-w-0">
                        Distância da loja: {formatKm(distancePreview)}
                        {feePreview != null && feePreview < 0 && (
                          <span className="block text-[#B91C1C]">
                            Fora da área de entrega (máx. {settings.maxDeliveryKm} km)
                          </span>
                        )}
                      </span>
                      {feePreview != null && feePreview >= 0 && (
                        <span className="shrink-0">Entrega: {formatMoney(feePreview)}</span>
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
