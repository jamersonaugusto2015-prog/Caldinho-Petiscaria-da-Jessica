# ADR 0002: UI module boundaries

- Status: accepted
- Date: 2026-08-18

## Context

`KitchenView.tsx` had grown to thousands of lines and `ClientStore` exposed catalog, cart, checkout, tracking and notifications to every screen. Socket join and order merge behavior was duplicated in three role stores.

## Decision

- `KitchenView` remains a tab shell; orders, catalog and settings live in `KitchenOrderBoard`, `KitchenCatalogEditor` and `KitchenStoreSettings`.
- Client state is split into `CartStore` and `CheckoutStore`; `ClientStore` only composes the catalog/settings shell and totals helper.
- Screens import the smallest hook they need (`useCart`, `useCheckout` or `useClientShell`).
- `src/lib/liveSession.ts` owns socket joining, shared order event forwarding and the common `mergeById` operation. Role-specific side effects such as sound and toasts remain in their stores.

## Consequences

Changing payment or catalog settings no longer requires opening the order board, and client screens do not receive unrelated cart or checkout state. The role stores still own role-specific presentation behavior, while the shared socket seam is small enough to test and replace.
