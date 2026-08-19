# ADR 0001: Order boundaries

- Status: accepted
- Date: 2026-08-18

## Context

Order creation, payment confirmation, status transitions, GPS updates and loyalty stamps were previously implemented across HTTP handlers, sockets and JSON-column SQL calls. That made the money-moving path difficult to test and gave each adapter a second way to mutate an order.

## Decision

Keep the adapters thin and make the domain modules the owners of mutation:

- `server/orderIntake.ts` owns cart resolution, pricing, freight, charge selection, loyalty-token consumption and initial persistence.
- `server/payment.ts` exposes `settlePayment`; kitchen confirmation, PIX polling and Mercado Pago webhooks share it.
- `server/orderLifecycle.ts` exposes `applyOrderEvent`; status, assignment, cancellation, rating and GPS use it.
- `server/orderStore.ts` is the only order JSON-column persistence boundary.
- `server/loyalty.ts` owns stamps and free-item tokens.

Mercado Pago remains a live adapter and tests use the in-memory fake payment adapter.

## Consequences

The HTTP and socket layers translate requests, authenticate them and emit events, but do not own order rules or JSON serialization. Unit tests can target intake and lifecycle without creating Express routes.
