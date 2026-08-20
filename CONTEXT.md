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

**Driver** — Motoboy. Name + password. Each one joins a room of their own: the customer's name, phone and address go only there, never to the shared driver pool.

**Role session** — A staff credential scoped to one app. Each app names its role; a 401 expires the session and returns to the login gate.

**Driver session** — The motoboy's own credential. Issued per driver at login, so the token says *which* motoboy, not just that it is one. `driverId` is never an input: every route and socket event reads the identity from the credential. Deactivating, deleting or repassword-ing a Driver revokes their tokens.

**Order view** — The only way an Order leaves the server towards a motoboy. The owner of the ride sees the customer's contact; everyone else sees it redacted down to neighbourhood, distance and fee — enough to decide whether to accept. The transport does not choose.

**Counter handover** — The bag leaving the shop's hands. One gesture, two recipients: **despacho** hands it to the Driver and the Order goes `saiu_entrega`; **retirada** hands it to the customer and the Order ends at `entregue`. The two verbs stay apart on purpose — while "retirar" covered both, the same word on the kitchen screen meant two different things.

**Ride handover** — Accepting a ride is not leaving with it. `assign` records the Driver and the Order stays `pronto` while the motoboy rides to the shop; the despacho starts `saiu_entrega`.

**Order flow** — The one table saying who may move an Order, from where to where. Server and kitchen board read it; the server still decides. The counter handover is a gate in it, not a step: nothing past it is reachable without crossing it, so a delivery can never be closed without having left the shop. Skipping ahead inside preparation stays allowed — nothing there pays anyone.

**Driver location** — The module owning the motoboy's GPS watch: status, dedup, timeout. Tracking is derived from being online or having an active delivery, never started by hand. Its server twin owns the recorded point: one writer, one emission, and the last known position is what seeds a new ride — not the shop's coordinates.

**Driver presence** — Online is intent plus a live socket, read through the page lifecycle. The button sets the intent and the app asserts it on rejoin — a returning socket alone must not, or the motoboy who tapped OFFLINE comes back on the board by himself. Losing the connection starts the grace window, not the offline flag.

**Page lifecycle** — Where the page is: `foreground`, `background` or `offline`. A locked screen is background, not offline. One owner; the transport, Driver presence and the GPS watch all read it instead of each guessing from a dropped socket.

**Presence grace window** — The 75 seconds between the socket dropping and `online` turning false. Long enough for a pocket, a tunnel and a Wi-Fi handover; short enough to drop the motoboy who went home before the next order is ready. Coming back cancels it.

**Location freshness** — The age of the recorded point, and the only thing separating "he is there" from "he was there". One rule in `src/shared/driverFreshness.ts`, read by the customer's map, the kitchen's driver list and the server: `live` inside 60 seconds, `stale` past it, `unknown` with no stamp. A point of unknown age is never drawn as live — that covers the rows written before the stamp existed and the position seeded at assign, which is a guess, not a fix.

**Order alert** — The one table saying who needs to know about an Order event and how loudly. It decides content and intensity, nothing else: it never plays, vibrates or draws. The browser channel and the server's push both read it, so the notification arriving with the app closed says exactly what the banner would say with the app open. Pure, like the Order flow — `null` is its most common answer, because most socket traffic is state sync, not news.

**Alert urgency** — Three steps, and they only go up. `silent` shows on screen. `notice` earns a short buzz and a system notification. `demand` means someone must drop what they are doing: sound, long vibration, repetition. Only two events are `demand` by default — the new Order on the kitchen screen and the ride offered to a Driver — because those are the two where money is standing still.

**Alert channel** — The module that delivers an alert to a human: audio unlock, sound, voice, vibration, the system notification, and the permission state behind them. One entry point, one place where a browser's quirks live. Its dedup is module-wide, not per instance — a page mounts more than one channel, and they have to agree that a key already fired, or a reconnect replay and a second open tab double the noise.

**Alert banner** — The strip inside the app that carries every alert. One timer, one live region, three looks: red on the kitchen column, fixed at the top for the customer, purple for the Driver. Dwell time follows urgency — what someone must act on stays on screen longer.

**Alert memory** — What the app knew about an Order before this event: last status, whether the cancellation request was already pending, whether the complaint was already open. The alert table needs it to tell news from an echo. A refetched list seeds it silently, so reconnecting never re-announces what was already true.

**Order audience** — Who should learn about an Order change: the kitchen, the ride's owner, the open pool, the customer. The audience names the recipient and the Order view each one is owed; it never decides what a view contains. Two adapters read it — socket.io for the open app, web push for the closed one — over one set of room names.

**Push subscription** — A device's standing address for alerts, filed under the same room name the Order audience produces. Issued from a proven identity, never from an input: a Driver's subscription dies with their credential. A push service rejecting an endpoint means the browser dropped it, so the row goes too.

**App shell** — What the phone installs. One build, three installable apps: the customer's, the kitchen's and the motoboy's, each with its own name, icon, colour and starting route. Its service worker is the only place an alert can arrive while the app is closed, and the only reason the app opens at all with no signal.
