import React, { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { RECIFE_CENTER } from '../../shared/defaults';

export interface GeoPoint {
  lat: number;
  lng: number;
}

interface LiveMapProps {
  store?: (GeoPoint & { name?: string }) | null;
  customer?: (GeoPoint & { label?: string }) | null;
  driver?: (GeoPoint & { name?: string }) | null;
  pickPosition?: GeoPoint | null;
  onPick?: (lat: number, lng: number) => void;
  center?: GeoPoint;
  zoom?: number;
  heightClass?: string;
  className?: string;
}

function pinIcon(emoji: string, bg: string, pulse?: boolean): L.DivIcon {
  return L.divIcon({
    className: 'live-map-pin',
    html: `<div class="live-map-pin-dot${pulse ? ' live-map-pin-pulse' : ''}" style="background:${bg}">${emoji}</div>`,
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
  store,
  customer,
  driver,
  pickPosition,
  onPick,
  center,
  zoom = 13,
  heightClass = 'h-52',
  className = '',
}) => {
  const mapCenter = center ?? store ?? pickPosition ?? RECIFE_CENTER;

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
        {driver && driver.lat != null && driver.lng != null && (
          <Marker position={[driver.lat, driver.lng]} icon={pinIcon('🛵', '#7C3AED', true)} />
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
