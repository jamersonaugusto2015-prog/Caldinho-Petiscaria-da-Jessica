# ADR 0007: Catalog, reports and geocode as modules

- Status: accepted
- Date: 2026-08-18

## Context

ADR 0001 made the money path own its rules and left routes as a thin adapter, but that discipline stopped at orders. Catalog validation and shaping, report aggregation maths including the local-date bucketing, and geocoding with its cache and per-IP throttle all lived as closures inside `createRoutes`, interleaved with `db.prepare(...)` calls. None of it was unit-tested and none of it was reachable without standing up Express, so `routes.ts` was the interface for everything.

## Decision

Three modules take over, and the routes become parse → call → respond:

- `server/reports.ts` is pure: `Order[]` in, report shape out, with `now` injectable. No database and no Express types. This is where the timezone-sensitive day/week/month bucketing lives.
- `server/catalog.ts` owns categories, products and coupons — rules and persistence together, the way `orderStore` owns the order column. Validation failures throw `DomainError`, so the existing `errorHandler` keeps producing the same status codes and messages.
- `server/geocode.ts` owns the Nominatim search, the ViaCEP lookup, the `geo_cache` table and the per-IP throttle. Cache and fetch are injectable, so tests never touch the network.

## Consequences

`routes.ts` dropped from 1294 to 979 lines and the test count went from 27 to 82. The report bucketing that silently breaks on timezone edges now has coverage, including an order placed just before local midnight in `America/Recife`. Driver CRUD, settings, Mercado Pago OAuth, backup, chat and upload are still in `routes.ts`; they are the next candidates if that file becomes friction again.
