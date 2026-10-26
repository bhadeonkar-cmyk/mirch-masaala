# Mirch Masaala — Premium UI Redesign & Motion Brief

Use this as the implementation prompt for a senior product designer and frontend engineer working on the existing live Mirch Masaala restaurant-ordering app.

## Mission

Upgrade the current app into a polished, distinctive, premium restaurant experience with high-quality graphics, subtle cinematic atmosphere, purposeful animation, and exceptional mobile usability. The result should feel handcrafted for a premium Indian restaurant: warm, welcoming, modern, and operationally clear—not like a generic admin dashboard, a neon gaming UI, or a template full of floating cards.

**Implement the redesign in the existing codebase. Do not return only a mockup, design description, or isolated prototype.** Preserve the current application architecture and all working customer, QR, kitchen, waiter, owner, table-visit, billing, payment, notification, menu, and language behavior.

## Product context and critical invariants

The app is a mobile-first restaurant PWA. The primary customer journey begins by scanning a table QR, choosing dishes, adding notes, placing an order, tracking its status, reviewing the combined visit bill, and paying. The owner/counter and staff have separate operational screens.

The interface must continue to support:
- Table QR scan as the clearest primary action on the home screen. Keep it visually strong but low-glare and consistent with the dark restaurant atmosphere.
- A customer order going directly to the kitchen without waiter approval.
- Multiple customers placing separate tickets against the same open table visit, with tickets grouped into one shared visit bill.
- Cash payment requests notifying the counter/owner without automatically closing the table.
- Owner/counter confirmation of payment; the visit/table closes only when the full amount is settled and service rules permit it.
- Staff-specific identity, assigned waiter visibility, kitchen status actions, alerts, owner tools, settings, payment records, table QR generation, party bookings, and menu availability.
- English and Marathi switching and translated labels. New visible copy must be added to the existing translation approach where appropriate.
- Existing Supabase calls, authentication/role checks, QR URLs, business rules, realtime updates, notification endpoints, and data contracts.

Never hard-code live orders, customer data, staff, prices, availability, payment status, or tables for decorative purposes. The live app must always render the data returned by its existing services.

## Visual direction: “Midnight Ember”

Build a cohesive visual language around dark cocoa, warm charcoal, muted brass, ember copper, and warm ivory.

Suggested design tokens:
- Base background: nearly-black cocoa (#100b09 range), with restrained radial ambient gradients.
- Primary surface: deep chocolate/charcoal (#211713 range).
- Raised surface: subtly lighter brown (#2a1d17 range).
- Accent: soft antique brass (#c4a36a range), not electric yellow.
- Secondary accent: ember copper (#b86d43 range) used sparingly for highlights or special states.
- Text: warm ivory for primary information; soft stone/tan for secondary copy.
- Dividers: low-opacity brass or warm white, never thick high-contrast borders everywhere.

Use gradients as surface lighting, not as decoration on every component. Add subtle texture through CSS or lightweight vector graphics. Keep glow controlled, localized, and low-opacity. Avoid pure-white panels, strong neon, excessive glass blur, heavy shadow stacking, or repeated golden outlines. Clear information hierarchy matters more than decorative effects.

## Graphics and illustration direction

Use layered CSS gradients, refined inline/vector graphics, simple geometric QR framing, and small purposeful food/restaurant motifs. Existing chef/food illustrations can remain but should feel integrated with the design rather than competing for attention. Add depth through soft ambient light, steam-like curves, warm particles, shallow inset highlights, and carefully drawn borders.

Do not add large stock-photo dependencies, external image APIs, heavy animation packages, or large assets just for decoration. If food images already exist in the menu, present them consistently with a stable aspect ratio, intentional cropping, subtle inner borders, and accessible fallback behavior. If a picture fails to load, the dish remains usable and readable.

## Motion quality bar

Every animation must communicate hierarchy, progress, or interaction. Animation should feel polished at 60 fps on ordinary mobile devices and must not delay ordering.

Use:
- Short, composed screen transitions (approximately 220–360 ms).
- Small entrance motion with slight vertical translation and opacity, with a restrained stagger on the home screen.
- Button press feedback with a subtle scale/translation rather than a large bounce.
- Hover lift only for devices that actually support hover.
- A slow, muted scanner line inside the QR illustration; do not animate the whole CTA with intense pulsing, shimmer, or flashing.
- Soft modal/drawer entry and a stable layout during open/close.
- Clear disabled, loading, success, warning, and error states; animated feedback must never be the only indication of status.

Prefer transform and opacity over layout-changing properties. Avoid continuous animation on many cards simultaneously. Do not use large parallax, rapid particles, scroll-jacking, autoplay video, loud sound, or movement that makes text difficult to read. Respect the user's reduced-motion setting by removing or substantially simplifying motion.

## Screen-by-screen requirements

### 1. Home and QR entry
- Make restaurant identity the visual anchor, with clear hierarchy between brand, status, language selector, one-line welcome, QR ordering guide, and secondary shortcuts.
- Keep the QR scanner action the main call-to-action. It should be a low-glare, tactile, dark inset panel with muted brass QR corners, readable title and support copy, a gentle scan line, and a small directional arrow. It must not be a bright gold slab or a large animated glow.
- Show the table-QR journey as a compact, understandable visual hint. Use small numbers/icons and directional structure rather than long suggestion cards.
- Make language selection easy to find and preserve the Marathi experience.
- Keep party booking, how-to guidance, QR help, directions/places, reviews, and staff access secondary.
- Use safe-area padding, concise copy, and excellent layout on compact iPhones.

### 2. Customer menu and order building
- Keep table context, cart count, search, dietary filters, category chips, menu items, quantity controls, and sticky cart/payment actions obvious.
- Menu cards should prioritize dish name, price, description, availability, and add/quantity interaction.
- Use consistent image treatment and compact composition. Avoid a wall of oversized cards.
- Make active filters, empty results, disabled items, and quantity changes immediately understandable.
- Preserve keyboard behavior, input size, scroll position, and reliable touch targets.

### 3. Cart, order confirmation, and live status
- Separate summary, notes, totals, and final order action with clear hierarchy.
- Confirm that an order is placed and sent directly to the kitchen; do not imply that a waiter or owner must approve a normal QR order.
- Present the ticket number, kitchen status, table/visit context, and the shared-bill explanation with concise progress visuals.
- Avoid celebratory effects that delay navigation or obscure the order confirmation.
- Support small screens and long item names without clipping.

### 4. Shared visit bill and payment
- Show a clear combined visit bill while maintaining separate order tickets in their appropriate views.
- Distinguish total visit amount, payments already recorded, balance remaining, and current payment state.
- For “pay at counter” or cash requests, explain that the counter is being notified and the table remains active until payment is recorded.
- Do not show a settled/closed state until the backend confirms full settlement. Owner/counter approval remains the authority for recording cash payments.
- Ensure warnings and financial figures use readable contrast and are not communicated by color alone.

### 5. Waiter screen
- Make table selection, assigned staff identity, current table context, open visit, and live order queue immediately scannable.
- Differentiate states with restrained color, labels, and consistent status chips.
- Keep alerts prominent enough to act on, but avoid jumping/pulsing layouts.
- Ensure buttons remain comfortable for fast use on a phone while moving through the restaurant.

### 6. Kitchen display
- Prioritize live ticket flow across new, cooking, and ready states.
- Use stable columns or responsive stacked lanes depending on width. Avoid horizontal overflow that hides tickets on small screens.
- Ticket cards should emphasize table, ticket age, item names, quantities, modifications/notes, and the next state action.
- Use distinct but muted statuses and preserve existing kitchen actions and refresh/realtime behavior.
- Keep the information density operationally useful; do not turn the kitchen display into a marketing screen.

### 7. Owner/admin
- Visually separate the high-level order/payment state from secondary tools.
- Refine tab navigation, payment records, alerts, menu management, table QR tools, settings, analytics, party bookings, and customer communication.
- Financial summaries must remain accurate and sourced from the existing backend.
- Confirm destructive/reset actions with the existing safe confirmation flow; never make destructive actions easier to trigger accidentally.
- Preserve role restrictions in both UI and backend. Styling must not expose actions a role is not authorized to perform.

### 8. Modals, toasts, settings, and utility states
- Keep dialogs compact, centered, readable, and scrollable when content exceeds the viewport.
- Provide visible close/back affordances and clear primary/secondary actions.
- Toasts must be non-blocking, legible, and not cover essential checkout or kitchen controls.
- Apply consistent field spacing, validation feedback, select/input styling, loading states, and focus rings.
- Respect iPhone safe areas and the on-screen keyboard.

## Responsive and accessibility requirements

- Design mobile-first for compact iPhones as well as larger phones, tablets, and desktop widths.
- No horizontal page overflow, cut-off labels, hidden primary actions, or tap targets smaller than practical touch sizes.
- Maintain readable contrast, visible keyboard focus, semantic controls, accessible labels, and status text that does not rely on color alone.
- Do not remove or break the existing viewport and PWA setup.
- Support `prefers-reduced-motion: reduce`.
- Avoid animation that creates nausea, repeated flashing, or a visual distraction during restaurant operations.

## Engineering constraints

1. Inspect the existing DOM, CSS cascade, inline styles, and navigation before changing code.
2. Prefer a new, clearly named presentation stylesheet or small targeted components over a rewrite of the large app file.
3. Do not replace the framework, alter the data model, change Supabase contracts, weaken auth/RLS, bypass role checks, modify payment/order business logic, or remove existing language/notification support for a visual task.
4. Avoid unnecessary dependencies. Use CSS and existing assets where possible.
5. Keep selectors scoped where needed, avoid brittle selectors tied to generated text, and document the purpose of any non-obvious motion.
6. Preserve fast first interaction. Decorative effects must never block QR scanning, menu access, adding items, placing orders, staff actions, or payment confirmation.
7. Add cache-busting query strings only when required for the app's static asset deployment behavior.
8. Keep changes traceable in a dedicated feature branch, open a reviewable pull request, run the repository's checks, and deploy through the established production branch only after validation.
9. Do not claim the production database was migrated, production secrets were changed, or a live workflow was verified unless the corresponding operation actually succeeded.
10. When access is insufficient, report the exact missing permission/action instead of guessing or requesting broad secret access.

## Acceptance checklist

- [ ] The live app remains the same Mirch Masaala application and all existing user journeys still work.
- [ ] The QR CTA is visually primary but subdued and fits the dark restaurant scene.
- [ ] Home atmosphere and brand graphics feel premium without becoming busy.
- [ ] Customer menu, checkout, confirmation, visit bill, and payment stay readable on mobile.
- [ ] Waiter, kitchen, owner, and modal states share a consistent design system.
- [ ] Hover effects are desktop-only; touch feedback works on mobile.
- [ ] Reduced-motion preference disables decorative motion.
- [ ] No new dependency or external asset request is required for basic app usage.
- [ ] No secrets, payment rules, SQL, Supabase permissions, or staff authorization rules are weakened.
- [ ] JavaScript/static checks and deployment workflow pass; report the actual commit, PR, and deployment status.

The finished UI should feel like a premium, warm-lit Indian dining space: calm, tactile, refined, easy to use, and unmistakably built for restaurant operations.
