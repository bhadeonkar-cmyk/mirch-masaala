# Mirch Masaala — Complete Rebuild (v2)

Clean modular vanilla JS SPA for **Mirch Masaala Garden Restaurant**.

- Same Supabase project & restaurant ID `a3702d10-6673-4c06-9783-1d61c945ecd5`
- **No database data deleted or reset**
- Completely new frontend architecture (modular vanilla JS)

## Architecture

```
index.html              # shell + crash guard
css/app.css             # premium restaurant styles
js/
  config.js             # public constants + safe storage
  supabase.js           # data layer over existing RPCs
  i18n.js               # English / मराठी
  state.js              # customer + staff state
  router.js             # simple routing
  app.js                # boot + wiring
  views/                # home, menu, cart, order, party, staff/*
```

## Customer flow

- `/` → beautiful Home (Scan QR primary, View Menu, Party Booking)
- `?table=05` → auto table identification → menu directly
- Real menu from Supabase categories + items
- Simple cart → Place Order → persistent Current Order
- UPI + Cash/Counter using existing backend
- Party booking form

## Staff

Waiter · Kitchen · Owner via Supabase Auth + server `get_my_staff_role`

## Local run

```bash
python3 -m http.server 8080
# open http://localhost:8080/
# or http://localhost:8080/?table=01
```

## Production

Vercel deployment from this branch. Main remains untouched until approved PR and squash merge.

## Backend compatibility

Reuses existing production RPCs and tables. No new restaurant, no data wipe.
