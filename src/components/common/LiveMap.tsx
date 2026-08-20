import React, { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { RECIFE_CENTER } from '../../shared/defaults';
import type { LocationFreshness } from '../../shared/driverFreshness';

export interface GeoPoint {
  lat: number;
  lng: number;
}

interface LiveMapProps {
  store?: (GeoPoint & { name?: string }) | null;
  customer?: (GeoPoint & { label?: string }) | null;
  driver?: (GeoPoint & { name?: string }) | null;
  /**
   * Idade do ponto do motoboy, decidida por quem tem o carimbo (o pedido tem
   * `driverLocationAt`, a cozinha tem `driver.locationAt`). O mapa não adivinha:
   * o padrão é `unknown` porque um ponto sem idade declarada não pode ser
   * desenhado como ao vivo — era assim que uma moto parada há dez minutos
   * pulsava no mapa do cliente como se estivesse andando.
   */
  driverFreshness?: LocationFreshness;
  pickPosition?: GeoPoint | null;
  onPick?: (lat: number, lng: number) => void;
  center?: GeoPoint;
  zoom?: number;
  heightClass?: string;
  className?: string;
}

/** Leaflet throws on a non-finite LatLng: drop half-loaded points instead of rendering them. */
function usablePoint<T extends GeoPoint>(point?: T | null): T | null {
  if (!point) return null;
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) ? point : null;
}

interface PinLook {
  /** A pulsação é o sinal de "isto está acontecendo agora". Só o ponto vivo a ganha. */
  pulse?: boolean;
  /**
   * Ponto velho: mesmo pino, sem brilho. Dessaturado e translúcido lê como
   * "estava aqui", não como erro — de propósito não é vermelho nem alerta, que
   * assustariam o cliente por um GPS que só ficou quieto.
   */
  faded?: boolean;
  /** Aparece ao passar o mouse/segurar; o resto da explicação vai em texto na tela. */
  title?: string;
}

function pinIcon(emoji: string, bg: string, look: PinLook = {}): L.DivIcon {
  const style = look.faded
    ? `background:${bg};opacity:0.5;filter:grayscale(0.75);box-shadow:0 2px 6px rgba(0,0,0,0.2)`
    : `background:${bg}`;
  const title = look.title ? ` title="${look.title}"` : '';
  return L.divIcon({
    className: 'live-map-pin',
    html: `<div class="live-map-pin-dot${look.pulse ? ' live-map-pin-pulse' : ''}" style="${style}"${title}>${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -34],
  });
}

function ClickHandler({ onPick }: { onPick?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick?.(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function FitBounds({ points }: { points: GeoPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 15, { animate: true });
      return;
    }
    map.fitBounds(
      points.map((p) => [p.lat, p.lng] as [number, number]),
      { padding: [36, 36], maxZoom: 17 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points)]);
  return null;
}

export const LiveMap: React.FC<LiveMapProps> = ({
  store: storeProp,
  customer: customerProp,
  driver: driverProp,
  driverFreshness = 'unknown',
  pickPosition: pickPositionProp,
  onPick,
  center: centerProp,
  zoom = 13,
  heightClass = 'h-52',
  className = '',
}) => {
  const store = usablePoint(storeProp);
  const customer = usablePoint(customerProp);
  const driver = usablePoint(driverProp);
  const pickPosition = usablePoint(pickPositionProp);
  const mapCenter = usablePoint(centerProp) ?? store ?? pickPosition ?? RECIFE_CENTER;
  // Só 'live' ganha o pino aceso. 'unknown' anda junto de 'stale' de propósito:
  // um ponto de idade desconhecida (linha antiga, posição semeada no aceite) não
  // é prova de que o motoboy está ali agora.
  const driverIsLive = driverFreshness === 'live';

  const fitPoints = useMemo(() => {
    const pts: GeoPoint[] = [];
    if (pickPosition) pts.push(pickPosition);
    if (store) pts.push(store);
    if (customer) pts.push(customer);
    if (driver) pts.push(driver);
    return pts;
  }, [pickPosition, store, customer, driver]);

  const routeLine = useMemo(() => {
    if (store && driver && !customer) return [store, driver] as [GeoPoint, GeoPoint];
    if (store && driver && customer) return [store, driver, customer] as GeoPoint[];
    if (store && customer) return [store, customer] as GeoPoint[];
    return null;
  }, [store, driver, customer]);

  return (
    <div className={`relative rounded-2xl overflow-hidden border border-[#E7E5E4] ${heightClass} ${className}`}>
      <MapContainer
        center={[mapCenter.lat, mapCenter.lng]}
        zoom={zoom}
        className="w-full h-full z-0"
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {onPick && <ClickHandler onPick={onPick} />}
        <FitBounds points={fitPoints} />

        {store && <Marker position={[store.lat, store.lng]} icon={pinIcon('🏪', '#B91C1C')} />}
        {customer && <Marker position={[customer.lat, customer.lng]} icon={pinIcon('🏠', '#059669')} />}
        {driver && (
          <Marker
            position={[driver.lat, driver.lng]}
            icon={pinIcon('🛵', '#7C3AED', {
              pulse: driverIsLive,
              faded: !driverIsLive,
              title: driverIsLive ? 'Motoboy ao vivo' : 'Última posição conhecida',
            })}
          />
        )}
        {pickPosition && onPick && (
          <Marker
            draggable
            position={[pickPosition.lat, pickPosition.lng]}
            icon={pinIcon('📍', '#D97706')}
            eventHandlers={{
              dragend: (e) => {
                const { lat, lng } = (e.target as L.Marker).getLatLng();
                onPick(lat, lng);
              },
            }}
          />
        )}
        {routeLine && (
          <Polyline
            positions={routeLine.map((p) => [p.lat, p.lng])}
            pathOptions={{ color: '#B91C1C', weight: 3, dashArray: '6 6' }}
          />
        )}
      </MapContainer>
      <div className="pointer-events-none absolute bottom-1.5 left-1.5 z-[500] bg-white/85 backdrop-blur-sm text-[9px] font-bold text-[#57534E] px-2 py-1 rounded-full border border-[#E7E5E4] shadow-sm">
        Mapa: OpenStreetMap
      </div>
    </div>
  );
};
