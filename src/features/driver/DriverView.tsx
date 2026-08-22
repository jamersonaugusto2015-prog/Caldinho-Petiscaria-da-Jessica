import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useDriver } from './DriverStore';
import { AlertBanner, AlertPermissionPrompt } from '../../ui/alertBanner';
import { locationFreshness } from '../../../contract/driver/freshness';
import { hapticTap } from '../../lib/haptic';
import { formatKm } from '../../../contract/pricing/geo';
import { needsCardMachine, paymentLabel } from '../../../contract/payment/payment';
import type { Order } from '../../../contract/order/types';
import {
  Bike,
  Power,
  DollarSign,
  MapPin,
  Phone,
  CheckCircle2,
  Navigation,
  ShieldAlert,
  ExternalLink,
  ShoppingBag,
  CreditCard,
  Store,
  Radio,
  Clock,
  Lock,
} from 'lucide-react';
import { formatMoney } from '../../../contract/pricing/money';

/**
 * O Leaflet (~154 kB com o CSS) entra por `lazy` como já entrava no cliente e na
 * cozinha. Estático, ele vinha no primeiro carregamento do app do motoboy — que
 * abre na rua, no 4G, para ver a lista de corridas — mesmo nas telas em que mapa
 * nenhum aparece: o mapa só existe depois de aceitar uma corrida com coordenada.
 */
const LiveMap = lazy(() =>
  import('../../components/common/LiveMap').then((module) => ({ default: module.LiveMap }))
);

/** Da altura exata do mapa, para o cartão da corrida não pular quando ele chega. */
const MapPlaceholder: React.FC = () => (
  <div className="h-40 rounded-2xl border border-[#E7E5E4] bg-[#F5F5F4]" aria-hidden />
);

type BusyAction = { orderId: string; kind: 'accept' | 'pickup' | 'deliver' } | null;
type RideStage = 'offer' | 'pickup' | 'deliver';

function rideStage(ord: Order, isMine: boolean): RideStage {
  if (!isMine) return 'offer';
  if (ord.status === 'saiu_entrega') return 'deliver';
  return 'pickup';
}

function ageLabel(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `há ${h}h${String(m).padStart(2, '0')}` : `há ${h}h`;
}

export const DriverView: React.FC = () => {
  const {
    profile,
    settings,
    isOnline,
    toggleOnline,
    myDeliveries,
    availableOrders,
    completedToday,
    cancelledDeliveries,
    dismissCancellation,
    earningsToday,
    feeForOrder,
    acceptAndStart,
    startRoute,
    confirmDelivery,
    alertChannel,
    locationStatus,
    lastFixAt,
    retryLocation,
  } = useDriver();

  const reduceMotion = useReducedMotion();
  const [busy, setBusy] = useState<BusyAction>(null);
  const [toggling, setToggling] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  // Offline some as ofertas. Corrida já aceita continua visível (pegar / entregar).
  const visibleRides = useMemo(
    () => (isOnline ? [...myDeliveries, ...availableOrders] : [...myDeliveries]),
    [isOnline, myDeliveries, availableOrders]
  );
  const hasRides = visibleRides.length > 0;
  const gpsDown = locationStatus === 'denied' || locationStatus === 'unavailable';
  // O silêncio era o pior dos casos: o watch suspenso pela tela bloqueada não
  // dá erro nenhum, então nenhuma faixa aparecia e o cliente ficava vendo o
  // último ponto com cara de ao vivo. Agora ele tem faixa própria.
  const gpsQuiet = locationStatus === 'stale';
  const quietFor = gpsQuiet && lastFixAt ? ageLabel(new Date(lastFixAt).toISOString(), now) : null;

  const focusRide = myDeliveries[0] || (isOnline ? availableOrders[0] : null) || null;
  const focusFee = focusRide ? feeForOrder(focusRide) : null;
  const focusStage = focusRide ? rideStage(focusRide, focusRide.driverId === profile?.id) : null;

  const handleToggle = async () => {
    if (toggling) return;
    hapticTap();
    setToggling(true);
    try {
      await toggleOnline();
    } finally {
      setToggling(false);
    }
  };

  const runAction = async (orderId: string, kind: 'accept' | 'pickup' | 'deliver') => {
    if (busy) return;
    if (kind === 'accept' && !isOnline) return;
    hapticTap();
    setBusy({ orderId, kind });
    try {
      if (kind === 'accept') await acceptAndStart(orderId);
      else if (kind === 'pickup') await startRoute(orderId);
      else await confirmDelivery(orderId);
    } finally {
      setBusy(null);
    }
  };

  const stickyStage = focusRide
    ? rideStage(focusRide, focusRide.driverId === profile?.id)
    : null;
  const sticky =
    focusRide && stickyStage && (stickyStage !== 'offer' || isOnline)
      ? {
          order: focusRide,
          fee: feeForOrder(focusRide),
          stage: stickyStage,
        }
      : null;

  return (
    <div className={sticky ? 'pb-28' : 'pb-10'}>
      {/* Fora do `space-y`: a região viva fica na tela mesmo sem aviso e abriria
          um vão permanente no topo se contasse como um item da pilha. */}
      <AlertBanner variant="driver" />

      {/* Sem a notificação do sistema a corrida nova só existe com o app aberto
          na frente. O pedido de permissão sai de um toque e some quando recusado. */}
      <div className="mb-3 empty:hidden">
        <AlertPermissionPrompt
          channel={alertChannel}
          storageKey="ce_driver_notify_prompt"
          label="Receber aviso de corrida nova"
          tone="driver"
        />
      </div>

      <div className="space-y-3">
        <AnimatePresence>
          {gpsDown && (isOnline || myDeliveries.length > 0) && (
            <motion.div
              key="gps-down"
              initial={reduceMotion ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#B91C1C] px-4 py-3 text-white shadow-md">
                {/* `min-w-0`: sem ele o texto não encolhe e empurra o botão para
                    fora da faixa numa tela de 360 px. */}
                <div className="flex min-w-0 items-center gap-2 text-xs font-bold">
                  <ShieldAlert className="h-5 w-5 shrink-0" />
                  <span className="min-w-0">GPS desligado. O cliente não vê você.</span>
                </div>
                <button
                  type="button"
                  onClick={retryLocation}
                  className="tap-44 shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-black text-[#B91C1C] active:scale-95"
                >
                  Ligar GPS
                </button>
              </div>
            </motion.div>
          )}

          {gpsQuiet && !gpsDown && (isOnline || myDeliveries.length > 0) && (
            <motion.div
              key="gps-quiet"
              initial={reduceMotion ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#B45309] px-4 py-3 text-white shadow-md">
                <div className="flex min-w-0 items-center gap-2 text-xs font-bold">
                  <ShieldAlert className="h-5 w-5 shrink-0" />
                  <span className="min-w-0">
                    GPS sem sinal{quietFor ? ` ${quietFor}` : ''}. O cliente está vendo você no último
                    ponto. Deixe a tela ligada.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={retryLocation}
                  className="tap-44 shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-black text-[#B45309] active:scale-95"
                >
                  Reativar
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {cancelledDeliveries.map((ord) => (
          <motion.div
            key={ord.id}
            initial={reduceMotion ? false : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-start justify-between gap-3 rounded-2xl border border-[#FECACA] bg-[#FEF2F2] p-4 shadow-sm"
          >
            <div className="flex min-w-0 items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#B91C1C]" />
              {/* `min-w-0` + `break-words`: o motivo do cancelamento é texto
                  livre digitado pela cozinha, e uma palavra comprida estourava
                  o cartão para fora da tela. */}
              <div className="min-w-0">
                <div className="text-sm font-extrabold text-[#B91C1C]">Corrida cancelada. Pare.</div>
                <p className="mt-0.5 break-words text-xs text-[#7C2D12]">
                  {ord.id} · {ord.cancellationReason || 'Motivo não informado'}
                </p>
                <p className="mt-1 text-[11px] text-[#57534E]">Não vá ao endereço. Volte para a loja se já saiu.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => dismissCancellation(ord.id)}
              className="tap-44 shrink-0 rounded-full border border-[#FECACA] bg-white px-3 py-1.5 text-[11px] font-black text-[#B91C1C]"
            >
              Entendi
            </button>
          </motion.div>
        ))}

        {/* Compact when working; full when idle */}
        <motion.section
          layout={!reduceMotion}
          className="overflow-hidden rounded-[22px] border border-[#27272A] bg-[#121214] text-white shadow-lg"
        >
          <div className={`flex items-center justify-between gap-3 px-4 ${hasRides ? 'py-3' : 'py-4'}`}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  {isOnline && !reduceMotion && (
                    <span className="absolute inset-0 animate-ping rounded-full bg-[#4ADE80] opacity-75" />
                  )}
                  <span
                    className={`relative h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-[#4ADE80]' : 'bg-[#71717A]'}`}
                  />
                </span>
                <AnimatePresence mode="wait">
                  <motion.p
                    key={`${isOnline}-${hasRides}-${focusStage}`}
                    initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-sm font-extrabold"
                  >
                    {!isOnline
                      ? 'Offline'
                      : focusStage === 'pickup'
                        ? 'Vá à loja pegar o pedido'
                        : focusStage === 'deliver'
                          ? 'A caminho do cliente'
                          : hasRides
                            ? 'Nova corrida na fila'
                            : 'Disponível'}
                  </motion.p>
                </AnimatePresence>
              </div>
              {!hasRides && (
                <p className="mt-1 text-[11px] text-[#A1A1AA]">
                  {isOnline ? 'Aguardando a cozinha liberar pedidos' : 'Fique online para receber corridas'}
                </p>
              )}
              {hasRides && focusFee != null && (
                <p className="mt-0.5 text-[11px] font-bold text-[#A7F3D0]">Taxa desta: {formatMoney(focusFee)}</p>
              )}
            </div>

            <motion.button
              type="button"
              onClick={handleToggle}
              disabled={toggling}
              aria-pressed={isOnline}
              whileTap={reduceMotion || toggling ? undefined : { scale: 0.94 }}
              className={`tap-44 flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2.5 text-[11px] font-extrabold disabled:opacity-70 ${
                isOnline ? 'bg-[#3F3F46] text-white' : 'bg-[#B91C1C] text-white'
              }`}
            >
              <Power className={`h-3.5 w-3.5 ${toggling ? 'animate-spin' : ''}`} />
              <span>{toggling ? '…' : isOnline ? 'Pausar' : 'Entrar'}</span>
            </motion.button>
          </div>
          <motion.div
            className="h-1 origin-left"
            initial={false}
            animate={{
              scaleX: isOnline ? 1 : 0.08,
              backgroundColor: isOnline ? '#059669' : '#3F3F46',
            }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            aria-hidden
          />
        </motion.section>

        {!hasRides && (
          <div className="grid grid-cols-3 gap-2">
            <Metric
              icon={<DollarSign className="h-4 w-4" />}
              tone="red"
              label="Ganhos hoje"
              value={`R$ ${earningsToday.toFixed(0)}`}
              highlight
            />
            <Metric
              icon={<CheckCircle2 className="h-4 w-4" />}
              tone="green"
              label="Entregas"
              value={String(completedToday.length)}
            />
            <Metric
              icon={<Bike className="h-4 w-4" />}
              tone="amber"
              label="Taxa"
              value={
                settings && settings.driverFeePerDelivery > 0
                  ? `R$ ${settings.driverFeePerDelivery.toFixed(0)}`
                  : 'Variável'
              }
            />
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-end justify-between gap-2 px-0.5">
            <h3 className="flex items-center gap-2 text-base font-extrabold text-[#1C1917]">
              <Navigation className="h-4 w-4 text-[#B91C1C]" />
              <span>{hasRides ? 'Agora' : 'Corridas'}</span>
            </h3>
            {isOnline && (
              <span className="text-[11px] font-bold text-[#78716C]">
                {hasRides ? `${visibleRides.length} na fila` : 'Nenhuma agora'}
              </span>
            )}
          </div>

          <AnimatePresence mode="wait">
            {!isOnline && myDeliveries.length === 0 ? (
              <motion.div
                key="offline"
                initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <EmptyState
                  icon={<Power className="h-8 w-8 text-[#B91C1C]" />}
                  title="Fique online para trabalhar"
                  body="Um toque e você começa a receber chamados da cozinha."
                  actionLabel="Ficar online agora"
                  onAction={handleToggle}
                  actionBusy={toggling}
                />
              </motion.div>
            ) : isOnline && !hasRides ? (
              <motion.div
                key="waiting"
                initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <WaitingState />
              </motion.div>
            ) : (
              <motion.div key="rides" className="space-y-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {visibleRides.map((ord, index) => (
                  <RideCard
                    key={ord.id}
                    order={ord}
                    index={index}
                    isMine={ord.driverId === profile?.id}
                    fee={feeForOrder(ord)}
                    now={now}
                    settings={settings}
                    busy={busy}
                    hideInlineAction={sticky?.order.id === ord.id}
                    canAccept={isOnline}
                    onAction={runAction}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {!hasRides && completedToday.length > 0 && (
          <section className="space-y-2.5 rounded-[22px] border border-[#E7E5E4] bg-white p-4 shadow-sm">
            <h3 className="text-sm font-extrabold text-[#1C1917]">
              Hoje · {completedToday.length} entregas · {formatMoney(earningsToday)}
            </h3>
            <div className="space-y-2">
              {completedToday.map((cd) => (
                <div
                  key={cd.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-[#E7E5E4] bg-[#FAFAF9] px-3 py-2.5 text-xs text-[#57534E]"
                >
                  <div className="min-w-0 truncate">
                    <span className="font-extrabold text-[#1C1917]">{cd.id}</span>
                    <span className="text-[#A8A29E]">
                      {' '}
                      · {cd.customerName || 'Cliente'} · {cd.address.neighborhood || 'bairro'}
                    </span>
                  </div>
                  <span className="shrink-0 font-extrabold text-[#059669]">
                    + {formatMoney(feeForOrder(cd))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Sticky thumb-zone primary action for the focus ride */}
        <AnimatePresence>
          {sticky && (
            <motion.div
              initial={reduceMotion ? false : { y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 64, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              // O botão mais tocado do app: ele sobe o inset da barra de gestos
              // mais 12 px. Sem o `env()` ele encostaria na barra do iPhone, que
              // rouba o toque e joga o motoboy para a tela de início; sem os
              // 12 px, em aparelho sem barra de gestos (inset 0) ele encostaria
              // na borda do vidro. O `0px` dentro do `env()` é para o navegador
              // que conhece a função mas não a variável — sem ele o `calc()`
              // inteiro cai e o botão perde a posição.
              className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+12px)] left-1/2 z-40 w-[calc(100%-28px)] max-w-[402px] -translate-x-1/2"
            >
              <StickyAction
                stage={sticky.stage}
                fee={sticky.fee}
                busy={busy?.orderId === sticky.order.id}
                busyKind={busy?.kind}
                disabled={Boolean(busy)}
                onAccept={() => runAction(sticky.order.id, 'accept')}
                onPickup={() => runAction(sticky.order.id, 'pickup')}
                onDeliver={() => runAction(sticky.order.id, 'deliver')}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const RideCard: React.FC<{
  order: Order;
  index: number;
  isMine: boolean;
  fee: number;
  now: number;
  settings: ReturnType<typeof useDriver>['settings'];
  busy: BusyAction;
  hideInlineAction: boolean;
  canAccept: boolean;
  onAction: (orderId: string, kind: 'accept' | 'pickup' | 'deliver') => void;
}> = ({ order: ord, index, isMine, fee, now, settings, busy, hideInlineAction, canAccept, onAction }) => {
  const reduceMotion = useReducedMotion();
  const stage = rideStage(ord, isMine);
  const customerPhone = (ord.customerPhone || '').replace(/\D/g, '');
  const hasFullAddress = Boolean(ord.address.street && ord.address.number);
  const hasCustomerLocation = ord.address.lat != null && ord.address.lng != null;
  const distanceLabel = ord.distanceKm > 0 ? formatKm(ord.distanceKm) : null;
  const age = ageLabel(ord.createdAt, now);
  const isBusy = busy?.orderId === ord.id;

  return (
    <motion.article
      layout={!reduceMotion}
      initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.32,
        delay: reduceMotion ? 0 : Math.min(index, 3) * 0.05,
        ease: [0.16, 1, 0.3, 1],
      }}
      className={`overflow-hidden rounded-[22px] border bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04),0_12px_28px_rgba(28,25,23,0.07)] ${
        isMine ? 'border-[#C4B5FD] ring-1 ring-[#7C3AED]/20' : 'border-[#E7E5E4]'
      }`}
    >
      {/* Hero: fee + age + id */}
      <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-2xl font-black tabular-nums leading-none text-[#059669]">
              + {formatMoney(fee)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#F5F5F4] px-2 py-0.5 text-[10px] font-bold text-[#57534E]">
              <Clock className="h-3 w-3" />
              {age}
            </span>
          </div>
          <p className="mt-1.5 truncate text-xs font-bold text-[#78716C]">
            Pedido {ord.id}
            {isMine ? ' · sua corrida' : ' · oferta'}
          </p>
        </div>
        {customerPhone && (
          <a
            href={`tel:${customerPhone}`}
            className="tap-44 flex shrink-0 items-center gap-1.5 rounded-full border border-[#E7E5E4] bg-[#F5F5F4] px-3 py-2 text-[11px] font-bold text-[#1C1917] active:scale-95"
          >
            <Phone className="h-3.5 w-3.5 text-[#B91C1C]" />
            Ligar
          </a>
        )}
      </div>

      {/* Decision scan line */}
      <div className="mx-4 mb-3 flex items-start gap-2.5 rounded-2xl border border-[#E7E5E4] bg-[#FAFAF9] px-3 py-2.5">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#B91C1C]" />
        {/* `min-w-0` no filho + `break-words`: bairro, cidade e distância vêm
            numa linha só e o endereço é texto livre do cliente. Sem isto uma
            palavra comprida ("Loteamento...") empurrava a pílula "Maps" para
            fora do cartão numa tela de 360 px. */}
        <div className="min-w-0 flex-1">
          <p className="break-words text-[11px] font-extrabold text-[#1C1917]">
            {ord.address.neighborhood || 'Bairro'}
            {ord.address.city ? ` · ${ord.address.city}` : ''}
            {distanceLabel ? ` · ${distanceLabel}` : ''}
          </p>
          {hasFullAddress ? (
            <p className="mt-0.5 break-words text-xs text-[#57534E]">
              {ord.address.street}, {ord.address.number}
              {ord.address.complement ? ` · ${ord.address.complement}` : ''}
            </p>
          ) : (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[#A8A29E]">
              <Lock className="h-3 w-3" />
              Aceite para ver rua, número e cliente
            </p>
          )}
        </div>
        {hasFullAddress && (
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(
              `${ord.address.street}, ${ord.address.number}, ${ord.address.neighborhood}, ${ord.address.city}`
            )}`}
            target="_blank"
            rel="noreferrer"
            className="tap-44 flex shrink-0 items-center gap-1 rounded-full bg-[#1C1917] px-2.5 py-1.5 text-[10px] font-bold text-white"
          >
            <ExternalLink className="h-3 w-3" />
            Maps
          </a>
        )}
      </div>

      {/* Steps: only after accept */}
      {isMine ? <RideSteps current={stage === 'deliver' ? 3 : 2} /> : <OfferHint />}

      {/* Map only after accept + coords */}
      {isMine && hasCustomerLocation && (
        <Suspense fallback={<MapPlaceholder />}>
          <LiveMap
            store={
              settings
                ? { lat: settings.storeLat, lng: settings.storeLng, name: settings.storeName }
                : null
            }
            customer={{ lat: ord.address.lat as number, lng: ord.address.lng as number }}
            driver={
              ord.driverLat != null && ord.driverLng != null
                ? { lat: ord.driverLat, lng: ord.driverLng, name: ord.driverName }
                : null
            }
            // A idade vem do carimbo do pedido, o mesmo que o cliente lê, e não do
            // status do watch daqui: assim o motoboy vê o próprio pino exatamente
            // como o cliente o vê. A faixa lá em cima continua sendo o aviso — ela
            // fala do watch (45 s de silêncio) e dispara antes desta regra (60 s
            // sobre o ponto gravado), de propósito: o motoboy sabe que calou antes
            // de o cliente ver o pino apagar.
            driverFreshness={locationFreshness(ord.driverLocationAt, now)}
            heightClass="h-40"
          />
        </Suspense>
      )}

      <div className="space-y-3 p-4 pt-3">
        {ord.customerName && (
          <p className="text-xs text-[#57534E]">
            Cliente: <strong className="text-[#1C1917]">{ord.customerName}</strong>
            {ord.customerPhone ? ` · ${ord.customerPhone}` : ''}
          </p>
        )}

        <div className="space-y-1 rounded-2xl border border-[#E7E5E4] p-3 text-xs text-[#57534E]">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[#1C1917]">
            <ShoppingBag className="h-3.5 w-3.5 text-[#B91C1C]" />
            Bolsa térmica
          </div>
          {ord.items.map((it) => (
            <div key={it.id} className="flex justify-between gap-2">
              <span className="min-w-0 truncate">
                <strong>{it.quantity}x</strong> {it.product.name}
              </span>
              <span className="shrink-0 font-bold text-[#1C1917]">
                {it.isFree ? 'GRÁTIS' : formatMoney(it.itemTotalPrice)}
              </span>
            </div>
          ))}
        </div>

        {/* Payment loud */}
        <div
          className={`rounded-2xl border px-3 py-2.5 text-xs font-extrabold ${
            ord.payment.isPaid
              ? 'border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]'
              : 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]'
          }`}
        >
          {paymentLabel(ord.payment, ord.fulfillment).toUpperCase()}{' '}
          {ord.payment.isPaid ? '· JÁ PAGO' : `· COBRAR ${formatMoney(ord.total)}`}
          {ord.payment.changeForAmount
            ? ` · troco p/ ${formatMoney(ord.payment.changeForAmount)}`
            : ''}
        </div>
        {needsCardMachine(ord.payment) && (
          <div className="flex items-center gap-1.5 rounded-xl border border-[#DDD6FE] bg-[#F5F3FF] px-2.5 py-1.5 text-[11px] font-black text-[#7C3AED]">
            <CreditCard className="h-3.5 w-3.5" />
            Leve a maquininha
          </div>
        )}

        {stage === 'pickup' && (
          <p className="flex items-center justify-center gap-1.5 text-center text-[11px] font-semibold text-[#57534E]">
            <Store className="h-3.5 w-3.5 text-[#7C3AED]" />
            Pegue o pedido no balcão da loja
          </p>
        )}
        {stage === 'deliver' && (
          <p className="text-center text-[11px] font-semibold text-[#57534E]">
            Entregue na porta e confirme
          </p>
        )}

        {/* Inline fallback when not the sticky focus ride (2nd+ in queue) */}
        {!hideInlineAction && (
          <div>
            {stage === 'offer' && canAccept && (
              <PrimaryAction
                busy={isBusy && busy?.kind === 'accept'}
                disabled={Boolean(busy)}
                onClick={() => onAction(ord.id, 'accept')}
                tone="purple"
                pulse={!reduceMotion}
                icon={<Bike className="h-5 w-5" />}
                label="Aceitar corrida"
                detail={`Ganhe ${formatMoney(fee)}`}
              />
            )}
            {stage === 'pickup' && (
              <PrimaryAction
                busy={isBusy && busy?.kind === 'pickup'}
                disabled={Boolean(busy)}
                onClick={() => onAction(ord.id, 'pickup')}
                tone="purple"
                icon={<ShoppingBag className="h-5 w-5" />}
                label="Sair para entrega"
                detail="O cliente vê você a caminho"
              />
            )}
            {stage === 'deliver' && (
              <PrimaryAction
                busy={isBusy && busy?.kind === 'deliver'}
                disabled={Boolean(busy)}
                onClick={() => onAction(ord.id, 'deliver')}
                tone="green"
                icon={<CheckCircle2 className="h-5 w-5" />}
                label="Confirmar entrega"
                detail={`+ ${formatMoney(fee)} nos ganhos`}
              />
            )}
          </div>
        )}
      </div>
    </motion.article>
  );
};

const OfferHint: React.FC = () => (
  <div className="flex items-center gap-2 border-y border-[#F5F5F4] bg-[#FAFAF9] px-4 py-2 text-[11px] font-bold text-[#78716C]">
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#7C3AED] text-[10px] font-black text-white">
      1
    </span>
    <span className="text-[#7C3AED]">Aceitar</span>
    <span className="text-[#D6D3D1]">→</span>
    <span className="flex items-center gap-1 text-[#A8A29E]">
      <Lock className="h-3 w-3" /> Pegar
    </span>
    <span className="text-[#D6D3D1]">→</span>
    <span className="flex items-center gap-1 text-[#A8A29E]">
      <Lock className="h-3 w-3" /> Entregar
    </span>
  </div>
);

const RideSteps: React.FC<{ current: 2 | 3 }> = ({ current }) => {
  const steps = [
    { n: 1, label: 'Aceito', done: true },
    { n: 2, label: 'Pegar', done: current > 2, active: current === 2 },
    { n: 3, label: 'Entregar', done: false, active: current === 3 },
  ];
  return (
    <div className="flex items-center gap-1 border-y border-[#F5F5F4] bg-[#FAFAF9] px-4 py-2.5">
      {steps.map((s, i) => (
        <React.Fragment key={s.n}>
          <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <motion.span
              animate={{
                backgroundColor: s.done || s.active ? (s.active ? '#7C3AED' : '#059669') : '#E7E5E4',
                color: s.done || s.active ? '#FFFFFF' : '#78716C',
                scale: s.active ? 1.06 : 1,
              }}
              transition={{ type: 'spring', stiffness: 420, damping: 28 }}
              className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black"
            >
              {s.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : s.n}
            </motion.span>
            <span
              className={`text-[9px] font-bold ${
                s.active ? 'text-[#7C3AED]' : s.done ? 'text-[#059669]' : 'text-[#A8A29E]'
              }`}
            >
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`mb-4 h-0.5 w-6 shrink-0 rounded-full ${s.done ? 'bg-[#059669]' : 'bg-[#E7E5E4]'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

const StickyAction: React.FC<{
  stage: RideStage;
  fee: number;
  busy?: boolean;
  busyKind?: 'accept' | 'pickup' | 'deliver';
  disabled?: boolean;
  onAccept: () => void;
  onPickup: () => void;
  onDeliver: () => void;
}> = ({ stage, fee, busy, busyKind, disabled, onAccept, onPickup, onDeliver }) => {
  if (stage === 'offer') {
    return (
      <PrimaryAction
        busy={busy && busyKind === 'accept'}
        disabled={disabled}
        onClick={onAccept}
        tone="purple"
        pulse
        elevated
        icon={<Bike className="h-5 w-5" />}
        label="Aceitar corrida"
        detail={`Ganhe ${formatMoney(fee)}`}
      />
    );
  }
  if (stage === 'pickup') {
    return (
      <PrimaryAction
        busy={busy && busyKind === 'pickup'}
        disabled={disabled}
        onClick={onPickup}
        tone="purple"
        elevated
        icon={<ShoppingBag className="h-5 w-5" />}
        label="Sair para entrega"
        detail="O cliente vê você a caminho"
      />
    );
  }
  return (
    <PrimaryAction
      busy={busy && busyKind === 'deliver'}
      disabled={disabled}
      onClick={onDeliver}
      tone="green"
      elevated
      icon={<CheckCircle2 className="h-5 w-5" />}
      label="Confirmar entrega"
      detail={`+ ${formatMoney(fee)} nos ganhos`}
    />
  );
};

const PrimaryAction: React.FC<{
  label: string;
  detail: string;
  icon: React.ReactNode;
  tone: 'purple' | 'green';
  busy?: boolean;
  disabled?: boolean;
  pulse?: boolean;
  elevated?: boolean;
  onClick: () => void;
}> = ({ label, detail, icon, tone, busy, disabled, pulse, elevated, onClick }) => {
  const reduceMotion = useReducedMotion();
  const tones =
    tone === 'green'
      ? 'bg-[#059669] hover:bg-[#047857] shadow-[#059669]/35'
      : 'bg-[#7C3AED] hover:bg-[#6D28D9] shadow-[#7C3AED]/35';

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      whileTap={reduceMotion || disabled || busy ? undefined : { scale: 0.98 }}
      animate={
        pulse && !busy && !reduceMotion
          ? { boxShadow: ['0 12px 28px rgba(124,58,237,0.28)', '0 12px 36px rgba(124,58,237,0.5)', '0 12px 28px rgba(124,58,237,0.28)'] }
          : undefined
      }
      transition={pulse ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' } : undefined}
      className={`relative flex w-full flex-col items-center justify-center gap-0.5 rounded-full py-3.5 text-white shadow-lg disabled:opacity-60 ${tones} ${
        elevated ? 'ring-[3px] ring-white' : ''
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-extrabold">
        {busy ? (
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
            className="inline-flex"
          >
            <Radio className="h-5 w-5" />
          </motion.span>
        ) : (
          icon
        )}
        {busy ? 'Enviando…' : label}
      </span>
      {!busy && <span className="text-[10px] font-bold text-white/90">{detail}</span>}
    </motion.button>
  );
};

const WaitingState: React.FC = () => {
  const reduceMotion = useReducedMotion();
  return (
    <div className="relative overflow-hidden rounded-[22px] border border-[#E7E5E4] bg-white px-6 py-10 text-center shadow-sm">
      <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center">
        {!reduceMotion && (
          <>
            <span className="absolute inset-0 animate-ping rounded-full bg-[#FEF3C7] opacity-60" />
          </>
        )}
        <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-[#FFFBEB] text-[#D97706] ring-2 ring-[#FCD34D]/60">
          <Radio className="h-6 w-6" />
        </span>
      </div>
      <p className="text-base font-extrabold text-[#1C1917]">Ouvindo a cozinha…</p>
      <p className="mt-1.5 text-xs leading-relaxed text-[#78716C]">
        Quando um pedido ficar pronto, ele aparece aqui. Fique por perto.
      </p>
    </div>
  );
};

const EmptyState: React.FC<{
  icon: React.ReactNode;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  actionBusy?: boolean;
}> = ({ icon, title, body, actionLabel, onAction, actionBusy }) => (
  <div className="rounded-[22px] border border-[#E7E5E4] bg-white px-6 py-8 text-center shadow-sm">
    <div className="mx-auto mb-3 flex justify-center">{icon}</div>
    <p className="text-base font-extrabold text-[#1C1917]">{title}</p>
    <p className="mt-1 text-xs leading-relaxed text-[#78716C]">{body}</p>
    {actionLabel && onAction && (
      <motion.button
        type="button"
        onClick={onAction}
        disabled={actionBusy}
        whileTap={{ scale: 0.97 }}
        className="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-[#B91C1C] px-5 py-3 text-xs font-extrabold text-white shadow-md disabled:opacity-70"
      >
        <Power className="h-4 w-4" />
        {actionBusy ? 'Aguarde…' : actionLabel}
      </motion.button>
    )}
  </div>
);

const Metric: React.FC<{
  icon: React.ReactNode;
  tone: 'red' | 'green' | 'amber';
  label: string;
  value: string;
  highlight?: boolean;
}> = ({ icon, tone, label, value, highlight }) => {
  const tones = {
    red: 'bg-[#FEF2F2] text-[#B91C1C]',
    green: 'bg-[#ECFDF5] text-[#059669]',
    amber: 'bg-[#FFFBEB] text-[#D97706]',
  };
  return (
    <div
      className={`rounded-2xl border bg-white p-3 shadow-sm ${
        highlight ? 'border-[#FECACA]' : 'border-[#E7E5E4]'
      }`}
    >
      <div className={`mb-2 flex h-8 w-8 items-center justify-center rounded-xl ${tones[tone]}`}>{icon}</div>
      <p className="text-[9px] font-bold uppercase tracking-wide text-[#78716C]">{label}</p>
      <motion.p
        key={value}
        initial={{ opacity: 0.4, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-0.5 text-base font-extrabold tabular-nums text-[#1C1917]"
      >
        {value}
      </motion.p>
    </div>
  );
};
