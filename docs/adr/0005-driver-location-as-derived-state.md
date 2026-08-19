# ADR 0005: Driver location tracking as derived state

- Status: accepted
- Date: 2026-08-18

## Context

`DriverStore` called `navigator.geolocation` directly and started the watch imperatively from two places: `toggleOnline` and `acceptAndStart`. Only the first also updated `isOnline` and posted presence, so accepting a delivery streamed GPS while the UI showed OFFLINE and the server kept the motoboy marked offline.

The watch had no `timeout` (defaulting to `Infinity`) and an empty error callback, so a denied permission or a lost fix produced no signal at all — the customer and the kitchen watched the driver sit at the shop for the whole trip.

## Decision

- `src/features/driver/useDriverLocation.ts` owns the geolocation adapter: watch handle, movement dedup, an explicit timeout, and error classification into `idle | searching | active | denied | unavailable`.
- Tracking is derived, not commanded: an effect starts the watch when the driver is online or has an active delivery and stops it otherwise. `toggleOnline` and `acceptAndStart` only update state.
- Positions are emitted volatile, so a reconnect does not replay a burst of stale coordinates as if current.
- `DriverView` renders a banner when the status is `denied` or `unavailable`, with a retry.

## Consequences

The two call sites can no longer drift, because neither starts the watch. The tracking policy is testable through a narrow interface instead of a global `navigator.geolocation` mock. The context stopped exposing raw `orders` alongside its derived slices, so status filtering stays in this module.
