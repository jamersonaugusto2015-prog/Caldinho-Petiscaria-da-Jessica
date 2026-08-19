import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '../../lib/socket';

const MOVEMENT_THRESHOLD_DEG = 0.00015;
const WATCH_TIMEOUT_MS = 20000;

export type DriverLocationStatus = 'idle' | 'active' | 'denied' | 'unavailable' | 'searching';

export interface DriverLocationHandle {
  status: DriverLocationStatus;
  start: () => void;
  stop: () => void;
}

/**
 * Owns the geolocation adapter for the driver app: one watch, movement dedup and
 * explicit error classification, so callers only ever start/stop tracking.
 */
export function useDriverLocation(driverId: string | undefined): DriverLocationHandle {
  const [status, setStatus] = useState<DriverLocationStatus>('idle');
  const watchIdRef = useRef<number | null>(null);
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const driverIdRef = useRef(driverId);
  driverIdRef.current = driverId;

  const start = useCallback(() => {
    if (watchIdRef.current != null) return;
    if (!navigator.geolocation) {
      setStatus('unavailable');
      return;
    }
    setStatus('searching');
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setStatus('active');
        const { latitude: lat, longitude: lng } = pos.coords;
        const last = lastPosRef.current;
        if (
          last &&
          Math.abs(last.lat - lat) < MOVEMENT_THRESHOLD_DEG &&
          Math.abs(last.lng - lng) < MOVEMENT_THRESHOLD_DEG
        ) {
          return;
        }
        lastPosRef.current = { lat, lng };
        const driverId = driverIdRef.current;
        if (!driverId) return;
        // Volatile: a burst buffered during a drop would replay a stale route on reconnect.
        socket.volatile.emit('driver:location', { driverId, lat, lng });
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: WATCH_TIMEOUT_MS }
    );
  }, []);

  const stop = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    lastPosRef.current = null;
    setStatus('idle');
  }, []);

  useEffect(() => stop, [stop]);

  return { status, start, stop };
}
