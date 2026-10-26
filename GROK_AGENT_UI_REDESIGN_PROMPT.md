# Grok Agent Brief — Mirch Masaala Premium UI & Food-Illustration Upgrade

**Role:** Act as a senior product designer, front-end engineer, motion designer, accessibility reviewer, and QA engineer. You are updating an existing, live restaurant-ordering product—not creating a concept mockup.

## Project and deployment context
- Repository: `bhadeonkar-cmyk/mirch-masaala`
- Main branch: `main`
- Live app: https://bhadeonkar-cmyk.github.io/mirch-masaala/
- Main interface: `index.html`; premium visual overrides: `ui-premium.css`; translations: `app-language.js`; ordering/Supabase integration: `supabase-live.js`; QR matrix asset: `qr-matrices.js`.
- The app is a lightweight vanilla HTML/CSS/JavaScript web app. Respect that architecture. Do not migrate it to React, Vue, a UI framework, a bundler, or a new backend.

## Primary objective
Raise the app to a polished, production-quality restaurant experience comparable to a premium Indian dining brand: warm, appetising, clear, tactile, and beautifully animated without looking flashy, toy-like, overcrowded, or slow. The visual identity is **Midnight Ember**: near-black cocoa, charcoal, muted brass, toasted saffron, restrained terracotta, ivory text, and small hints of herb green. Preserve the existing Mirch Masaala identity and existing dark restaurant theme.

This is a real implementation task. Inspect the current code and user flows first, make focused changes in the actual repository, run checks, commit the changes, and verify the live deployment. Do not return a design description or disconnected sample only.

## 1. Food artwork and named dishes — top priority
Create a coherent family of custom, scalable, vector food illustrations for menu cards and special-item cards. The art should look like deliberately designed miniature food scenes—not a generic emoji in a box.

- Draw each fallback illustration with inline SVG or local CSS/vector assets so it is crisp at every device scale and does not rely on a third-party image API.
- Choose the illustration from the actual item name and, where available, its category. Provide visually distinct scenes for at least: biryani/pulao/rice, curry/paneer/dal, roti/naan/paratha, dosa/idli/uttapam, thali/meal combo, samosa/chaat/pav bhaji/tikka/snacks, hot tea/coffee, cold drinks/lassi/juice, desserts/sweets, and a tasteful generic signature dish.
- Include distinctive food shapes, a plate or serving bowl, subtle ingredients/garnishes, warm dimensional shading, and a restrained highlight. For suitable hot dishes, include fine trails of rising steam. Steam must be slow, light, and elegant—not thick smoke or a distracting loop.
- Make the actual dish name clearly readable beside the artwork in the card, special picker, and detail/modal views. Do not bake long text into a tiny image. Ensure the illustration has a useful accessible name such as “Illustration of Paneer Butter Masala”.
- If a valid restaurant-provided HTTPS image exists, keep it as the primary image. If it is missing or fails to load, automatically show the matching vector illustration. Keep image loading lazy and preserve existing photo-credit/link behavior.
- Keep vegetarian/non-vegetarian markers and spice controls intact. Do not invent or mislabel a dish's dietary status.
- Reuse the same visual language and art sizing across menu, featured specials, and detail views. Never show a broken-image glyph.

## 2. Customer menu and discovery
- Prioritise scanability on a phone: the item name, veg/non-veg mark, concise description, price, spice control, and Add/quantity control should have a clear hierarchy.
- Keep the food illustration recognisable but compact; it must not force excessive scrolling or push the price/Add button below the fold.
- Use restrained category accent colours and consistent corner radii. No random gradients, excessive glassmorphism, huge cards, or competing gold glows.
- Search and veg filters must remain fast and obvious. Preserve current search behaviour for both English and Marathi text.
- Use clear, consistent line-icon style where icons are needed. Icons should visually communicate the action. Avoid decorative emoji for every UI control.
- Special recommendations should feel appetising and useful, not obstructive or auto-popup-heavy. Do not interrupt ordering with surprise dialogs.

## 3. Home screen and QR-first entry
- Keep table QR scanning as the primary entry action and retain the existing muted, cinematic treatment of the scanner button. It should be visible without being the brightest object on the page.
- Establish a clear brand focal point, strong typographic hierarchy, and one understated atmospheric light layer. A chef/brand emblem may breathe very subtly, but never jitter or distract.
- Keep quick actions secondary and compact. Use clear visual cues and directional guidance instead of lengthy instruction boxes.
- Add short, helpful guidance only at the relevant step; never introduce a large tutorial wall.
- QR links must continue to open the exact table. Do not introduce manual table selection for customer QR ordering.

## 4. Motion and micro-interactions
Use motion to provide feedback and a sense of craft—not decoration for its own sake.
- Screen entry: short, gentle fade/vertical rise.
- Dish fallback art: very subtle settling/fade.
- Steam: low-opacity, organic upward drift with staggered timing.
- Add-to-cart and quantity actions: immediate pressed state and small confirmation feedback. Do not delay checkout.
- Card hover motion only on hover-capable devices; touch feedback must remain immediate.
- Loading: use a small, purposeful skeleton or spinner only where a real wait occurs.
- Success: confident, restrained confirmation that the order was received and sent directly to the kitchen.
- Avoid constant pulsing, shimmer sweeps, flashing, parallax that moves content, excessive confetti, or animations that compete with the food.
- Honour `prefers-reduced-motion: reduce` by removing all non-essential animation and transitions.

## 5. Visual system and typography
- Define/reuse design tokens for background, surface, text, muted text, brass accent, terracotta, success, error, border, radius, spacing, shadow, and easing.
- Reserve bright accent colour for a small number of important actions and feedback states. The scanner and ordinary cards must not glow intensely.
- Maintain strong contrast, crisp text, meaningful spacing, consistent icon strokes, and predictable alignment.
- Use tabular numerals for rupee prices and totals. Keep currency formatting consistent.
- Avoid tiny labels, overly thin text, cramped controls, or visual hierarchy depending only on colour.

## 6. Responsive layout and accessibility
- Design mobile-first for common 320–430 px screens and then scale cleanly to tablets and desktop.
- Respect iOS safe areas and the fixed customer action bar. Do not hide buttons behind the safe-area inset or browser UI.
- Ensure no horizontal overflow, clipped titles, overlapped controls, or image stretching.
- Maintain accessible names on icon-only controls, keyboard focus indicators, semantic buttons, and usable touch targets (aim for at least 44 px for primary actions).
- Do not convey a state only by colour. Keep clear success/error text.
- Avoid excessive animation and expensive filters that can hurt mobile performance.

## 7. Preserve all existing product behaviour — non-negotiable
The current app already supports customer QR ordering, shared table visits and multi-ticket bills, kitchen queue, waiter flows, owner/admin controls, notifications, cash-payment requests, order tracking, Marathi/English translation, and Supabase-backed operations. Do not rewrite these workflows while doing a visual upgrade.

- A QR customer order goes directly to the kitchen; it does not need waiter approval.
- Separate tickets from diners at the same active table/visit share the combined visit bill.
- A cash-payment request notifies the owner/counter but must not close the visit or free the table.
- Only the authorised owner/admin/counter flow records payment; partial payment keeps the table active, and the visit closes only when fully settled and no kitchen ticket is in progress.
- Preserve exact table QR links and printable QR generation.
- Preserve role/permission checks and every existing Supabase contract/RPC name.
- Keep all customer-facing text compatible with the existing English/Marathi translation layer. Add translation entries where new visible text needs them; do not bypass the language layer.
- Do not add mock menu items, fake live data, placeholder buttons, new analytics trackers, external image services, or new permissions.
- Never commit keys, secrets, credentials, or production customer data.

## 8. Code quality and implementation discipline
1. Inspect the current branch and read the affected HTML/CSS/JS before editing.
2. Prefer small, isolated changes and reuse existing styles/functions. Avoid duplicating CSS rules or creating parallel design systems.
3. Use safe DOM/HTML escaping for item names. Keep any item-derived classes limited to a known allowlist.
4. Use inline SVG/vector art without duplicate SVG IDs, so multiple menu cards can render safely.
5. Make failure states graceful: if a photo fails, show the category illustration; if data is loading, preserve a useful loading state.
6. Update the CSS/asset cache-busting query whenever a deployed stylesheet changes.
7. Do not claim that production SQL was applied or that a feature is live unless that action and result were actually verified.

## 9. Required QA before reporting completion
- Parse every inline JavaScript block in `index.html` and the external JavaScript files.
- Run the repository's existing quality/inline-JS checks and relevant automated tests.
- Check the new SVG markup and ensure it handles long names, missing images, and image-load errors.
- Review mobile widths around 320, 375, 390, 430 px and desktop width; check for layout overflow, fixed-bar overlap, legibility, and target sizes.
- Check reduced-motion mode and verify steam does not animate when reduced motion is enabled.
- Walk through: open QR customer menu → search/filter → add an item → change quantity → checkout → confirmed ticket → order status. Also sanity-check login/role, waiter, kitchen, owner/counter views for visual regressions.
- Confirm English and Marathi display without broken or untranslated new labels.
- Commit to the existing repository and verify GitHub Actions/Pages deployment. Open the live URL with the correct asset cache tag and report the exact commit and deploy status.
- If any check cannot be performed in the available environment, disclose it clearly rather than claiming it passed.

## Definition of done
The live app has a cohesive premium restaurant UI; dish-specific artwork with subtle steam appears when photos are unavailable; names/prices/actions remain readable; mobile performance and accessibility are respected; current ordering, payment, QR, language and staff flows remain intact; automated checks pass; and the live Pages deployment is confirmed.
