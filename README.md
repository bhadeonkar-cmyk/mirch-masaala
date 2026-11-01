# Mirch Masaala — Clean Simple Rebuild

Branch: `rebuild/clean-simple` (never merge into `main` until the real-phone checklist below passes).

A small, framework-free front end for the **existing** Supabase backend. No new RPCs, no schema changes.

## Structure

```
index.html              shell + all screens + crash guard (fatal screen, boot watchdog)
css/app.css             design system (calm, system font, no animation loops)
js/config.js            public config, safe localStorage wrapper, state
js/i18n.js              English / Marathi (missing Marathi falls back to English, never blank)
js/supabase.js          thin client over the existing RPCs / tables
js/app.js               UI controller (customer, waiter, kitchen, owner)
js/vendor/              supabase-js 2.58.0, pinned and served from this site (no CDN)
service-worker.js       legacy push-only worker from the old app; NOT registered by this app, caches nothing
scripts/check-rebuild-smoke.cjs   browser smoke test (see Testing)
supabase/               production SQL, unchanged and authoritative
```

## What it does

- **Customer** — QR `?table=NN` is the only table identity (no picker). Menu, search, categories, cart (persisted),
  place order, "Your current order" strip, order detail, pay by UPI or Cash/Counter, party booking.
- **Waiter** — login → tables → continue an OPEN visit or start one (re-checks the server first, so no duplicate
  visits) → menu search → qty / spice / notes → send to kitchen → mark READY orders as served.
- **Kitchen** — New → Preparing → Ready from real orders; every change is written to Supabase and re-read.
- **Owner** — Orders, Tables (incl. releasing an abandoned visit; history is kept), Payments (cash/UPI are only ever
  marked PAID by an explicit owner confirmation), Menu (price + availability), Bookings, Settings (WhatsApp, Google
  review URL, UPI).
- **Roles** always come from `get_my_staff_role` on the server — never from storage.

## Backend contract notes

- `mm_place_order` is called exactly as the last known-good production client did (`p_guest_order_code: null`,
  customer session id for guests). If the live database still has the 6-digit guest-code version of this function
  (`menu-item-options-and-table-capacity.sql` / `visit-service-controls.sql`) instead of the direct-kitchen version
  (`direct-kitchen-qr-orders.sql`), guest orders will be rejected — confirm which is live.
- Kitchen/waiter status changes use the direct `orders.status` update (RLS + `mm_guard_order_update`), as production
  did. There is no `mm_staff_set_order_status` function in `/supabase`.

## Testing

```bash
npm i --no-save playwright          # Chromium must be installed
node scripts/check-rebuild-smoke.cjs
```

Runs the real app in headless mobile Chromium against an in-process **fake** Supabase that mirrors the production
contracts. It proves the wiring; it does **not** prove the live database or a real phone.

## Local run

```bash
python3 -m http.server 8080       # then open http://localhost:8080/?table=01
```

Staff: tap **Staff** at the bottom of the customer home → choose Waiter / Kitchen / Owner.

## Before production (not done by automation)

Real Android phone pass: open normally · via QR · `?table=01` · refresh · back · menu · search · cart · place order ·
current order · kitchen login/start/ready · waiter login/table/order · owner login · payment request · Marathi ·
logout/login · close and reopen the browser. Any white screen = stop and find the root cause.
