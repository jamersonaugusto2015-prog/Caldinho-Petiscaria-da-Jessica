# Caldinho Express — domain

Delivery app for a Recife soup shop. Client `/`, kitchen `/cozinha`, driver `/entregador`.

## Glossary

**Order** — A cart that passed intake: priced items, freight, payment, status. Stored as one document.

**Order intake** — The module that turns a cart + address + pay method into a persisted Order. Reprices from the catalog. Charges PIX or card. Consumes loyalty tokens. Reserves the Order row before charging, so a charge is never left without a record.

**Order lifecycle** — Status moves, driver assign, cancel, rate, live GPS. One writer for those events.

**Cancellation** — The module that cancels an Order end to end: status, the loyalty token back, and the refund flagged. One writer, one save, one event.

**Cancellation request** — Past `recebido` the customer asks instead of cancelling. The kitchen has five minutes to accept or refuse; refusing needs a reason the customer reads.

**Refund** — Money the shop owes on a cancelled paid Order. `pendente` until the kitchen taps to return it. A failed attempt stays owed.

**Complaint** — A problem reported within 24 hours of delivery, one per Order, answered in the Order's chat.

**Payment settlement** — Marks an Order paid. Card at create, PIX via Mercado Pago, kitchen confirm, or poll. One writer for `isPaid`. The Mercado Pago source verifies against their API; the kitchen source trusts the caller and records `confirmedBy`.

**Loyalty stamps** — One stamp per delivered Order. `LOYALTY_STAMP_COST` stamps = one free caldinho token. Token dies at intake.

**Fulfillment** — How the Order reaches the customer: `delivery` or `pickup`. Set at intake and never changed. A pickup Order has no customer address (it stores the shop's own), no freight, no radius check and no driver: it goes `pronto` → `entregue` in the kitchen's hands. Missing on Orders written before pickup existed, which means delivery.

**Freight** — Haversine km × route factor, then fee settings. Shared `geo.ts` + `pricing.ts`. Skipped entirely on a pickup Order.

**Catalog** — Categories, products and coupons. Owns their rules and their tables.

**Reports** — Pure aggregation over Orders: day, week and month buckets in the shop's timezone, top sellers, hourly spread.

**Geocode** — Address search and CEP lookup, with the shared cache and the per-IP throttle.

**Kitchen** — Store staff. PIN + role token.

**Driver** — Motoboy. Name + password + role token. Each one also joins a room of their own: the customer's name, phone and address go only there, never to the shared driver pool.

**Role session** — A staff credential scoped to one app. Each app names its role; a 401 expires the session and returns to the login gate.

**Driver location** — The module owning the motoboy's GPS watch: status, dedup, timeout. Tracking is derived from being online or having an active delivery, never started by hand.
