# ADR 0004: Role-scoped API credential and session expiry

- Status: accepted
- Date: 2026-08-18

## Context

`src/lib/api.ts` read the `ce_role_token` map from localStorage and picked `Object.keys(parsed)[0]` — whichever role logged in first. On a shared device where both `/cozinha` and `/entregador` had been used, every request from one app carried the other app's token, producing 401s with no visible cause.

A 401 also had no handler anywhere: an expired token produced a repeating toast, no route back to the login gate, and a socket `join` that failed silently server-side, so the app looked alive while receiving nothing.

## Decision

The credential is an input to the adapter, never inferred:

- `createApi(role?)` builds a client that sends exactly that role's token. `api` (no role) serves the customer app; `kitchenApi` and `driverApi` serve the staff apps.
- `api.ts` owns the role-token storage helpers, so `auth.ts` can depend on it without a cycle.
- A 401 clears that role's token and fires a `ce:unauthorized` window event. `useRoleSession(role)` turns that event into the login gate, and `refresh()` resumes after re-login.

## Consequences

Adding a screen means choosing a client, and choosing wrong is a compile-time import, not a runtime ordering accident. Session expiry has one path instead of one per call site. `ApiError` now carries `.status`, so call sites can distinguish an expired session from a domain rejection such as an order another driver already took.
