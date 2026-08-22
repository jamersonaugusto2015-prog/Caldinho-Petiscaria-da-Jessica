import React, { Suspense, lazy, useMemo, useState } from 'react';
import { Bike, Clock, MapPin, Radio, Store } from 'lucide-react';
import type { Driver, Order } from '../../types';
import { isPickup } from '../../shared/fulfillment';
import { locationAgeLabel, locationFreshness } from '../../shared/driverFreshness';
import type { DriverPin } from '../../components/common/LiveMap';
import { useKitchenOrders } from './KitchenOrdersStore';
import { useKitchenDrivers } from './KitchenDriversStore';
import { useKitchenSettings } from './KitchenSettingsStore';
import { Heading, Panel, Empty } from './KitchenPanels';
import { money } from './kitchenOrderRules';
import { useNow } from './useNow';

/**
 * Leaflet e o CSS dele passam de 150 kB. A cozinha abre no celular do balcão e
 * na maioria dos turnos nem chega a abrir esta aba — o mesmo `lazy` das outras
 * telas de mapa.
 */
const LiveMap = lazy(() =>
  import('../../components/common/LiveMap').then((module) => ({ default: module.LiveMap }))
);

const MapPlaceholder: React.FC = () => (
  <div className="h-72 sm:h-96 rounded-2xl bg-[#F5F5F4] animate-pulse" />
);

/** Na rua: já saiu da loja e ainda não chegou. Retirada nunca entra no mapa. */
const isOnTheRoad = (order: Order): boolean => order.status === 'saiu_entrega' && !isPickup(order);

/** Pronto, sem motoboy: a comida esfriando no balcão é o que este mapa existe para mostrar. */
const isWaitingDriver = (order: Order): boolean =>
  order.status === 'pronto' && !order.driverId && !isPickup(order);

function driverPoint(order: Order): { lat: number; lng: number } | null {
  if (!Number.isFinite(order.driverLat) || !Number.isFinite(order.driverLng)) return null;
  return { lat: order.driverLat as number, lng: order.driverLng as number };
}

function homePoint(order: Order): { lat: number; lng: number } | null {
  const { lat, lng } = order.address ?? {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat: lat as number, lng: lng as number };
}

/**
 * O mapa da rua.
 *
 * A cozinha já recebia cada ponto de GPS ao vivo — o servidor manda
 * `order:updated` e `drivers:updated` para a sala `kitchen` a cada movimento —
 * mas isso morria em duas palavras num canto do card ("GPS ativo"). Quem
 * despacha não acompanha *um* pedido, acompanha a rua: quem está voltando,
 * quem empacou, e qual comida está pronta sem ninguém para levar.
 *
 * Sem pedido escolhido o mapa mostra a rua inteira. Escolhido um, ele fecha
 * naquela corrida: loja → moto → casa.
 */
export const KitchenDeliveriesMap: React.FC = () => {
  const { orders } = useKitchenOrders();
  const { drivers } = useKitchenDrivers();
  const { settings } = useKitchenSettings();
  // A idade da posição envelhece sozinha, sem evento nenhum chegando: sem o
  // tique, uma moto cujo GPS calou seguiria pulsando como se andasse.
  const now = useNow(15000);
  const [focusId, setFocusId] = useState<string | null>(null);

  const onRoad = useMemo(() => orders.filter(isOnTheRoad), [orders]);
  const waiting = useMemo(() => orders.filter(isWaitingDriver), [orders]);
  const focused = useMemo(
    () => onRoad.find((order) => order.id === focusId) ?? null,
    [onRoad, focusId]
  );

  const store = { lat: settings.storeLat, lng: settings.storeLng, name: settings.storeName };

  /**
   * Um pino por motoboy online, e não um por corrida: o mesmo motoboy com duas
   * entregas na mochila é uma moto só na rua.
   */
  const driverPins = useMemo<DriverPin[]>(
    () =>
      drivers
        .filter((driver) => driver.online && driver.lat != null && driver.lng != null)
        .map((driver) => ({
          id: driver.id,
          name: driver.name,
          lat: driver.lat as number,
          lng: driver.lng as number,
          freshness: locationFreshness(driver.locationAt, now),
        })),
    [drivers, now]
  );

  const destinations = useMemo(
    () =>
      onRoad
        .map((order) => {
          const point = homePoint(order);
          return point ? { ...point, label: `${order.id} · ${order.customerName}` } : null;
        })
        .filter((point): point is { lat: number; lng: number; label: string } => point !== null),
    [onRoad]
  );

  const focusedDriver = focused ? driverPoint(focused) : null;
  const focusedHome = focused ? homePoint(focused) : null;

  return (
    <div className="space-y-4">
      <Heading
        icon={<MapPin />}
        title="Mapa das entregas"
        subtitle={
          onRoad.length
            ? `${onRoad.length} ${onRoad.length === 1 ? 'entrega' : 'entregas'} na rua agora.`
            : 'Nenhuma entrega na rua agora.'
        }
      />

      <Suspense fallback={<MapPlaceholder />}>
        <LiveMap
          store={store}
          // Com um pedido escolhido o mapa vira a tela do cliente: uma corrida,
          // com a linha loja → moto → casa. Sem escolha, é a rua inteira.
          driver={focused ? focusedDriver : null}
          driverFreshness={focused ? locationFreshness(focused.driverLocationAt, now) : 'unknown'}
          customer={focused ? focusedHome : null}
          drivers={focused ? null : driverPins}
          destinations={focused ? null : destinations}
          // Reenquadra ao trocar de pedido ou quando entra/sai gente da rua —
          // nunca a cada ponto de GPS, que tiraria o mapa da mão de quem arrasta.
          fitKey={focused ? `order:${focused.id}` : `street:${driverPins.map((p) => p.id).join(',')}|${destinations.length}`}
          heightClass="h-72 sm:h-96"
        />
      </Suspense>

      <Legend />

      {focused && (
        <button
          type="button"
          onClick={() => setFocusId(null)}
          className="btn-secondary w-full sm:w-auto"
        >
          Ver a rua inteira
        </button>
      )}

      <Panel title={`Na rua (${onRoad.length})`}>
        {onRoad.map((order) => (
          <DeliveryRow
            key={order.id}
            order={order}
            now={now}
            selected={order.id === focusId}
            onSelect={() => setFocusId(order.id === focusId ? null : order.id)}
          />
        ))}
        {onRoad.length === 0 && <Empty text="Nenhuma entrega saiu ainda." />}
      </Panel>

      {waiting.length > 0 && (
        <Panel title={`Pronto, esperando motoboy (${waiting.length})`}>
          <p className="-mt-2 mb-2 text-[11px] text-[#B45309] font-bold">
            Comida pronta no balcão sem ninguém para levar.
          </p>
          {waiting.map((order) => (
            <div
              key={order.id}
              className="flex items-center gap-2 border-b border-[#F5F5F4] py-2.5 text-xs last:border-0"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#FFFBEB] text-[#B45309]">
                <Clock className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <strong>{order.id}</strong>
                <span className="block truncate text-[11px] text-[#57534E]">
                  {order.customerName} · {order.address?.neighborhood || 'Bairro não informado'}
                </span>
              </span>
              <span className="shrink-0 font-extrabold tabular-nums">{money(order.total)}</span>
            </div>
          ))}
        </Panel>
      )}

      <Panel title={`Motoboys online (${driverPins.length})`}>
        {drivers
          .filter((driver) => driver.online)
          .map((driver) => (
            <DriverRow key={driver.id} driver={driver} now={now} />
          ))}
        {drivers.filter((driver) => driver.online).length === 0 && (
          <Empty text="Nenhum motoboy online." />
        )}
      </Panel>
    </div>
  );
};

const Legend: React.FC = () => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] font-bold text-[#57534E]">
    <span className="flex items-center gap-1.5">
      <Store className="h-3.5 w-3.5 text-[#B91C1C]" /> Loja
    </span>
    <span className="flex items-center gap-1.5">
      <Bike className="h-3.5 w-3.5 text-[#7C3AED]" /> Motoboy
    </span>
    <span className="flex items-center gap-1.5">
      <MapPin className="h-3.5 w-3.5 text-[#059669]" /> Casa do cliente
    </span>
    <span className="text-[#A8A29E] font-normal">Pino apagado = última posição, sem sinal agora.</span>
  </div>
);

/**
 * Uma corrida na lista. Diz as três coisas que decidem a próxima ação: quem
 * leva, se o GPS está vivo, e há quanto tempo ele está calado quando não está.
 */
const DeliveryRow: React.FC<{
  order: Order;
  now: number;
  selected: boolean;
  onSelect: () => void;
}> = ({ order, now, selected, onSelect }) => {
  const freshness = locationFreshness(order.driverLocationAt, now);
  const age = locationAgeLabel(order.driverLocationAt, now);
  const live = freshness === 'live';
  const hasPoint = driverPoint(order) !== null;

  return (
    <button
      type="button"
      onClick={onSelect}
      title={`Ver o pedido ${order.id} no mapa`}
      className={`flex w-full items-center gap-2.5 rounded-xl border-b border-[#F5F5F4] py-2.5 text-left transition last:border-0 hover:bg-[#FAFAF9] active:scale-[0.99] ${
        selected ? 'bg-[#F5F3FF]' : ''
      }`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F5F3FF] text-[#7C3AED]">
        <Bike className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <strong className="text-xs">{order.id}</strong>
          <span className="text-[11px] text-[#57534E]">{order.driverName || 'Sem motoboy'}</span>
        </span>
        <span className="block truncate text-[11px] text-[#57534E]">
          {order.customerName} · {order.address?.neighborhood || 'Bairro não informado'}
        </span>
        {live ? (
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-bold text-[#059669]">
            <Radio className="h-3 w-3 shrink-0" /> GPS ao vivo
          </span>
        ) : (
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-bold text-[#B45309]">
            <Clock className="h-3 w-3 shrink-0" />
            {hasPoint && age ? `Sem sinal · ${age}` : 'Sem posição registrada'}
          </span>
        )}
      </span>
      <span className="shrink-0 text-xs font-extrabold tabular-nums">{money(order.total)}</span>
    </button>
  );
};

const DriverRow: React.FC<{ driver: Driver; now: number }> = ({ driver, now }) => {
  const live = locationFreshness(driver.locationAt, now) === 'live';
  const age = locationAgeLabel(driver.locationAt, now);
  return (
    <div className="flex items-center gap-2.5 border-b border-[#F5F5F4] py-2.5 text-xs last:border-0">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
          live ? 'bg-[#ECFDF5] text-[#059669]' : 'bg-[#FFFBEB] text-[#B45309]'
        }`}
      >
        <Bike className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <strong className="truncate">{driver.name}</strong>
        <span className="block text-[11px] text-[#57534E]">
          {driver.plate || 'Sem placa'}
        </span>
      </span>
      <span
        className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black ${
          live ? 'bg-[#ECFDF5] text-[#059669]' : 'bg-[#FEF3C7] text-[#B45309]'
        }`}
      >
        {live ? 'AO VIVO' : age ? `SEM SINAL · ${age.toUpperCase()}` : 'SEM SINAL'}
      </span>
    </div>
  );
};
