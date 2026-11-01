# Mirch Masaala — Clean Simple Rebuild

**Branch intent:** `rebuild/clean-simple`

This is a **complete frontend rewrite** focused on:

1. Functionality (existing Supabase backend)
2. Stability (no white screens)
3. Simple UX
4. Mobile reliability

## What stayed the same

- Supabase project URL and anon key
- Restaurant ID `a3702d10-6673-4c06-9783-1d61c945ecd5`
- All existing tables, RPCs, RLS, and business rules
- Roles: Customer · Waiter · Kitchen · Owner
- QR table identification (`?table=01`)
- Direct-to-kitchen ordering model

## What changed

- Monolithic 8000-line `index.html` replaced by small, readable modules
- No continuous particle / steam / ember animations
- Global fatal-error screen instead of blank white page
- Clear loading and empty states
- Compact “Your current order” strip
- Calm visual design (limited colors, system font, large touch targets)

## Structure

```
index.html          shell + screens
css/app.css         design system
js/config.js        public config + state
js/i18n.js          English / Marathi
js/supabase.js      thin client over existing RPCs
js/app.js           UI controller
```

## Local test

Serve the folder over HTTP (required for modules / camera later):

```bash
npx serve .
# or python -m http.server 8080
```

Open with a table QR simulation:

```
http://localhost:8080/?table=01
```

## Staff login

Tap the brand logo 5 times quickly to open the staff login screen.  
Uses the same Supabase Auth + `staff_profiles` role as before.

## Not yet ported (intentionally minimal first cut)

- Full owner menu editor / price management
- Waiter full order-entry pad (table select works; expand next)
- Push notifications
- Full payment ledger UI
- Party booking owner management list
- Image assets from previous menu-images folder

These can be added screen-by-screen on top of this stable base without risking the white-screen problem again.

## Deploy

Point GitHub Pages (or any static host) at this branch / folder.  
Do **not** merge to `main` until real-phone verification passes.
