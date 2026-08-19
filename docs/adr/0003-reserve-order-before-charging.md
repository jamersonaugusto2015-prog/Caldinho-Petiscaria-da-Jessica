# ADR 0003: Reserve the Order before charging

- Status: accepted
- Date: 2026-08-18

## Context

Order intake generated a display id from a 9,000-value space (`CX-1000`..`CX-9999`) with no uniqueness check, used it as the Mercado Pago idempotency key, charged the customer, and only then ran the `INSERT`. A collision therefore surfaced as a primary-key error *after* money had moved, with no order row to reconcile the charge against.

The loyalty free-item token had the same shape of problem: `peekFreeRedeem` checked it early and non-atomically, and `consumeFreeItems` ran inside the insert transaction, after the charge. A replayed request could pass the peek, get charged, then roll the insert back.

## Decision

Persistence comes before money on every path that charges:

- Order ids keep the `CX-` prefix for staff to read aloud but carry a crypto-random suffix, checked against `orderStore.orderIdExists` with a bounded retry.
- When a charge will be attempted, intake reserves the Order row unpaid, charges, then applies the result. A failed charge releases the reserved row and restores the loyalty token; a failed post-charge write leaves a recoverable unpaid row rather than an orphan charge.
- Cash orders keep the original single-write path — there is no charge to strand.

## Consequences

Intake gained optional `orderIdExists`, `updateOrder`, `releaseOrder` and `releaseFreeItems` deps, all defaulting to real implementations, so the HTTP wiring is unchanged and tests keep injecting fakes. `orderStore` owns `orderIdExists`/`deleteOrder` and `loyalty` owns `releaseFreeItems`, keeping the boundaries of ADR 0001. Regression tests cover collision retry, replayed-token rejection before the charge, and release-on-failed-charge.
