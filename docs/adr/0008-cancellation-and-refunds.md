# ADR 0008: Cancellation, refunds and complaints

- Status: accepted
- Date: 2026-08-18

## Context

Cancelling wrote two fields — `status` and `cancellationReason` — and nothing else. Everything money and loyalty touched was left inconsistent: a paid order kept the money with no record that the shop owed it, a cancelled PIX order could still be paid afterwards because `markOrderPaid` never checked status, and a customer who had spent ten stamps on a free caldinho lost both the stamps and the item permanently.

The people were left inconsistent too. The customer lost the cancel button the moment the kitchen advanced the order, with no path left inside the app even when the order was an hour late. The driver's card vanished mid-route with no notice. The kitchen cancelled a paid order with one keystroke in a `window.prompt`, and could not answer a customer at all — the chat had a complete backend and no kitchen screen.

## Decision

Cancellation becomes a composed operation with an owner, and money gets an explicit "we owe this" state.

- `server/cancellation.ts` owns cancelling end to end: it applies the lifecycle event, stamps `cancelledAt`/`cancelledBy`, returns the loyalty token through `releaseFreeItems`, flags the refund through `payment.markRefundDue`, then saves once and emits once. Each module still writes only its own fields, so ADR 0001 holds: lifecycle owns status, payment owns money.
- Refunds are a state on the payment (`refundStatus`), not an event that fires and is forgotten. A paid order that is cancelled becomes `pendente` — a debt the kitchen can see. `refundPayment` mirrors `markOrderPaid`'s idempotent shape; `falhou` is retryable because a failed attempt moved no money; only a confirmed reversal writes `devolvido`.
- The customer asks, the kitchen answers. Immediate self-service cancellation stays only in `recebido`. After that a `cancellationRequest` is raised and the kitchen accepts or refuses; refusing requires a justification shown to the customer. There is no automatic approval on timeout — an unanswered request escalates in both UIs instead, and the customer is handed the shop's WhatsApp so they are never trapped.
- Lateness is derived, never scheduled: `createdAt + estimatedDeliveryMinutes`, and the 5-minute response deadline is `requestedAt + 5min`. Both are computed at render time, so the server needs no timer, no cron and no per-status timestamps.
- Post-delivery complaints are deliberately thin: 24 hours, one per order, text only, routed into the per-order chat that already existed so the conversation lives in one place. No photos, no evidence, no arbitration.

## Consequences

Money cannot move onto a dead order, and money owed is visible in a queue instead of silently vanishing from revenue. The loyalty token survives a cancellation. `payment.confirmedBy` is a real typed field rather than a cast.

The kitchen gained the screens it never had: a chat, a requests panel and a refund queue. That is new surface to maintain, and the refund call is the first in the project that takes money out — it is guarded by an idempotent write and a human tap, never automatic.

Customer identity is still an unauthenticated `customerId` from the request body, so cancellation authorisation is as weak as it was before. Recorded as known debt: closing it means giving customers real accounts, which is a separate project.
