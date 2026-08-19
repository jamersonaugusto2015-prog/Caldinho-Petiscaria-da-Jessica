# ADR 0006: Kitchen state split into domain stores

- Status: accepted
- Date: 2026-08-18

## Context

ADR 0002 split the kitchen *screens* but left the kitchen *state* as one context exposing about 20 fields and 25 actions across orders, catalog, categories, coupons, drivers, settings, reports and sound. Memoizing the provider value stabilised function identities but not the fan-out: the memoized value's identity still changed whenever any slice changed, so an order arriving over the socket re-rendered the settings screen and the catalog editor, which read none of it.

## Decision

- Kitchen state lives in domain stores — notifications, settings, sound, reports, catalog, drivers, orders — each with its own context and its own memoized value. `KitchenProvider` composes them so `KitchenApp` still mounts one thing.
- Each store exposes two contexts: `use<Domain>()` for screens that read state, and `use<Domain>Sync()` for stable refetch/apply handles whose identity never changes.
- A dedicated `KitchenLiveSession` component owns the socket seam. It consumes only Sync hooks, so it renders once, and its `onReconnect` fans out to every store's refetch — reconnect reconciles all slices, not just orders.
- Screens import the smallest hook they need, extending the ADR 0002 rule to state.
- Actions keep functional `setState` updaters, and the two that must read the current category list use a latest-ref rather than a dependency, so no store can capture a stale list.

## Consequences

An order arriving re-renders the order board and the sidebar only. Removing "motoboys" is now deleting one store and one panel. `KitchenOrderBoard` still reads five stores because one component renders six tabs; splitting it per tab is the next move if that becomes friction.
