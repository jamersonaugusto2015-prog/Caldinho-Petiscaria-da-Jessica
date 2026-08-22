import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeDeliveryFee,
  effectiveDistanceKm,
  formatHourRange,
  formatKm,
  haversineDistanceKm,
  isStoreOpen,
  round2,
} from './geo';
import { DeliveryAddress, StoreSettings } from '../types';

const baseSettings: StoreSettings = {
  storeName: 'Loja',
  city: 'Recife',
  storeLat: -8.0476,
  storeLng: -34.877,
  storeAddress: 'Rua da Aurora, 100',
  pickupEnabled: true,
  pickupReadyMinutes: 20,
  deliveryPricePerKm: 2,
  deliveryBaseFee: 2,
  deliveryMinFee: 4,
  freeDeliveryAbove: 60,
  maxDeliveryKm: 12,
  minOrderValue: 15,
  routeFactor: 1.35,
  driverFeePerDelivery: 0,
  pixProvider: 'mercadopago',
  pixKey: '',
  cardOnDeliveryEnabled: true,
  pixMerchantName: '',
  pixMerchantCity: '',
  storeWhatsApp: '',
  orderSoundUrl: '',
  openingHours: [null, null, null, null, null, null, null],
  sizeOptions: [],
  orderEnabled: true,
  forceOpen: false,
};

const baseAddress: DeliveryAddress = {
  id: 'a',
  label: '',
  street: '',
  number: '',
  neighborhood: '',
  city: '',
  distanceKm: 0,
};

test('haversineDistanceKm is 0 for identical coordinates', () => {
  assert.equal(haversineDistanceKm(-8.05, -34.9, -8.05, -34.9), 0);
});

test('haversineDistanceKm stays finite for antipodal points (no NaN from float rounding)', () => {
  // (-8.05, -34.9) and its exact antipode.
  const d = haversineDistanceKm(-8.05, -34.9, 8.05, 145.1);
  assert.ok(Number.isFinite(d), `expected finite distance, got ${d}`);
  // Should be close to half the Earth's circumference (~20015 km).
  assert.ok(Math.abs(d - 20015) < 1, `expected ~20015km, got ${d}`);
});

test('haversineDistanceKm matches a known short Recife distance', () => {
  const d = haversineDistanceKm(-8.0476, -34.877, -8.06, -34.9);
  assert.ok(Math.abs(d - 2.88) < 0.01, `expected ~2.88km, got ${d}`);
});

test('effectiveDistanceKm applies the route factor and rounds to 2 decimals', () => {
  const addr: DeliveryAddress = { ...baseAddress, lat: -8.06, lng: -34.9 };
  assert.equal(effectiveDistanceKm(addr, baseSettings), 3.89);
});

test('effectiveDistanceKm falls back to a legacy distanceKm when there is no lat/lng', () => {
  const addr: DeliveryAddress = { ...baseAddress, distanceKm: 5.5 };
  assert.equal(effectiveDistanceKm(addr, baseSettings), 5.5);
});

test('effectiveDistanceKm returns 0 when nothing usable is available', () => {
  assert.equal(effectiveDistanceKm(baseAddress, baseSettings), 0);
});

test('effectiveDistanceKm defaults the route factor to 1.35 when unset', () => {
  const addr: DeliveryAddress = { ...baseAddress, lat: -8.06, lng: -34.9 };
  const settings = { ...baseSettings, routeFactor: 0 };
  assert.equal(effectiveDistanceKm(addr, settings), effectiveDistanceKm(addr, baseSettings));
});

test('computeDeliveryFee returns 0 for a 0km / unresolved address', () => {
  assert.equal(computeDeliveryFee(baseAddress, baseSettings), 0);
});

test('computeDeliveryFee applies base fee + per-km price above the minimum', () => {
  const addr: DeliveryAddress = { ...baseAddress, lat: -8.06, lng: -34.9 }; // ~3.89km effective
  assert.equal(computeDeliveryFee(addr, baseSettings), 9.78); // max(4, 2 + 2*3.89) = 9.78
});

test('computeDeliveryFee floors at the minimum fee for very short trips', () => {
  const addr: DeliveryAddress = { ...baseAddress, lat: -8.0476, lng: -34.8775 }; // a few dozen meters
  const fee = computeDeliveryFee(addr, baseSettings);
  assert.ok(fee >= baseSettings.deliveryMinFee);
});

test('computeDeliveryFee returns -1 outside the max delivery radius', () => {
  const addr: DeliveryAddress = { ...baseAddress, lat: -8.3, lng: -35.3 };
  assert.equal(computeDeliveryFee(addr, baseSettings), -1);
});

test('computeDeliveryFee ignores maxDeliveryKm when it is 0 (unlimited)', () => {
  const addr: DeliveryAddress = { ...baseAddress, lat: -8.3, lng: -35.3 };
  const settings = { ...baseSettings, maxDeliveryKm: 0 };
  assert.ok(computeDeliveryFee(addr, settings) > 0);
});

test('round2 rounds to 2 decimal places', () => {
  assert.equal(round2(1.005), 1);
  assert.equal(round2(2.345), 2.35);
  assert.equal(round2(10), 10);
});

test('formatKm keeps one decimal below 10km and none from 10km up', () => {
  assert.equal(formatKm(3.2456), '3.2 km');
  assert.equal(formatKm(9.96), '10.0 km');
  assert.equal(formatKm(12.4), '12 km');
});

test('isStoreOpen respects the general order-enabled switch', () => {
  const settings = {
    ...baseSettings,
    orderEnabled: false,
    openingHours: baseSettings.openingHours.map((_, i) => (i === 1 ? { open: '00:00', close: '00:00' } : null)),
  };
  assert.equal(isStoreOpen(settings, new Date('2026-08-17T12:00:00')), false);
});

test('isStoreOpen lets forceOpen bypass the schedule', () => {
  const settings = { ...baseSettings, forceOpen: true, orderEnabled: true };
  assert.equal(isStoreOpen(settings, new Date('2026-08-17T03:00:00')), true);
});

test('isStoreOpen treats open === close as 24h', () => {
  const settings = {
    ...baseSettings,
    openingHours: baseSettings.openingHours.map((_, i) => (i === 1 ? { open: '10:00', close: '10:00' } : null)),
  };
  assert.equal(isStoreOpen(settings, new Date('2026-08-17T03:00:00')), true);
});

test('isStoreOpen handles a normal same-day window', () => {
  const settings = {
    ...baseSettings,
    openingHours: baseSettings.openingHours.map((_, i) => (i === 1 ? { open: '18:00', close: '23:00' } : null)),
  };
  assert.equal(isStoreOpen(settings, new Date('2026-08-17T19:00:00')), true);
  assert.equal(isStoreOpen(settings, new Date('2026-08-17T17:00:00')), false);
});

test('isStoreOpen handles an overnight window that crosses midnight', () => {
  const settings = {
    ...baseSettings,
    openingHours: baseSettings.openingHours.map((_, i) => (i === 1 ? { open: '22:00', close: '02:00' } : null)),
  };
  assert.equal(isStoreOpen(settings, new Date('2026-08-17T23:30:00')), true);
  assert.equal(isStoreOpen(settings, new Date('2026-08-17T01:00:00')), true);
  assert.equal(isStoreOpen(settings, new Date('2026-08-17T03:00:00')), false);
});

test('isStoreOpen is closed when the day has no hours configured', () => {
  assert.equal(isStoreOpen(baseSettings, new Date('2026-08-17T19:00:00')), false);
});

test('formatHourRange formats an open/close pair and reports closed for null', () => {
  assert.equal(formatHourRange({ open: '18:00', close: '23:00' }), '18:00 às 23:00');
  assert.equal(formatHourRange(null), 'Fechado');
});
