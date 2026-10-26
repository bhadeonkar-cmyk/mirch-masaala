# Mirch Masaala — Premium UI, Graphics & Motion Redesign Brief

## Mission

Elevate the existing Mirch Masaala QR-ordering web app into a polished, contemporary Indian restaurant experience with cinematic warmth, refined graphics, excellent micro-interactions, and exceptionally clear task flow. It should feel intentionally art-directed—not like a generic admin template, a neon gaming UI, or a pile of glowing cards.

This is a refinement of the current production app, not a rebuild. Inspect and reuse the existing screens, elements, IDs, event handlers, data sources, roles, and navigation. Make the customer journey feel welcoming and effortless while keeping waiter, kitchen, and owner tools fast and legible during a busy service.

## Brand direction

**Creative idea:** “Modern Indian hospitality, after dusk.” Imagine warm pendant light falling across dark walnut, matte charcoal, aged brass, and a well-run open kitchen. The interface should be premium, calm, tactile, and quietly lively.

- Base palette: espresso black, deep cocoa, smoked walnut, and warm charcoal.
- Accent palette: antique brass, muted saffron, and soft ivory. Save the brightest warm gold for selected states and the single most important action in a view.
- Status palette: tasteful, semantically consistent green for success/ready/paid, amber for attention/in progress, and muted red for errors/destructive actions. Never use color alone to convey status.
- Surfaces: build depth through restrained gradients, low-contrast edge lighting, hairline borders, subtle inset highlights, and soft ambient shadows. Avoid loud neon outlines, huge outer glows, metallic gradients on every control, and excessive glass blur.
- Graphics: use CSS-created light falloff, soft bokeh, a fine-grain pattern, delicate steam, and precisely placed decorative accents. Existing chef/chilli/pot artwork may remain a friendly brand mascot, but it must feel like one coherent art direction rather than a collection of unrelated emoji.
- Overall contrast: keep body text easy to read, secondary text clearly distinguishable, and the key action unmistakable. Premium means controlled contrast and spacing—not dimming everything until it becomes hard to use.

## Layout and visual system

1. Establish a consistent spacing scale (4, 8, 12, 16, 20, 24, 32 px) and re-use it. Keep related items close and separate sections with whitespace rather than a border around every group.
2. Use a predictable radius family: approximately 10–12 px for compact controls, 14–18 px for cards and action surfaces, and 20–24 px for prominent dialogs.
3. Use a restrained shadow system: one ambient page shadow, one card elevation, and a higher modal shadow. Avoid stacking several intense shadows.
4. Improve typography hierarchy with compact, confidently weighted headings; readable 12–16 px utility text; comfortable line height; and tabular numerals for money, order numbers, totals, and metrics where available.
5. Prioritize mobile first. Make touch targets comfortably tappable (prefer at least 44 px); account for iOS safe areas, the virtual keyboard, sticky headers, bottom actions, and small 320–390 px screens. On desktop, use available space without stretching content into uncomfortably wide lines.
6. Use responsive, content-driven layouts. Do not cause horizontal overflow. Staff queues may use columns on wide displays but must remain readable when they stack on mobile.

## Motion language — polished, purposeful, never distracting

Motion should communicate hierarchy, state change, and feedback. It must not delay ordering or make the user wait for decorative animation.

- Use a consistent ease-out / gentle spring curve. Typical transitions: 120–180 ms for button feedback, 180–240 ms for hover and selection, 250–380 ms for screen/dialog entrances.
- Screen changes: a subtle fade with a very small vertical lift (roughly 4–8 px). No dramatic zooms, long slides, or animated layout jumps.
- Menus and result lists: softly reveal only the first few newly rendered cards with a 4–8 px rise and very short stagger intervals. Keep later items immediate so long menus do not feel slow.
- Buttons: a tiny press-in response and a clear hover/focus state. The primary action may have a subtle ambient edge highlight, but no constant high-brightness pulsing or sweeping shimmer.
- QR scan: animate a slim, low-contrast scan beam inside the illustrated QR frame. The button itself should remain dark and grounded in the scene. Move the arrow only slightly on hover/tap. Do not turn the whole control into a glowing billboard.
- Mascot: preserve a gentle idle motion, limited to one or two brand moments. Avoid perpetual bouncing across every screen. Keep it low amplitude and low intensity.
- Status changes: use short transitions or a small status accent to confirm state. Do not rely on animation alone to say that an order was submitted or payment was recorded.
- Modal: use a short fade/soft rise, with a clear backdrop and a strong visual boundary. Prevent background content from competing.
- Loading: use a restrained, layout-stable progress state or low-contrast skeleton if the current UI supports it. Never animate fake progress that implies a server operation has succeeded.
- Reduced motion: respect `prefers-reduced-motion: reduce` globally. Disable non-essential motion, staggering, pulsing, and smooth scrolling while keeping all information and feedback available.
- Performance: prefer opacity and transform. Do not animate expensive full-screen filters, large blurred shadows, or layout dimensions continuously. Avoid adding animation packages or large remote dependencies.

## Page-by-page experience goals

### 1. Home / QR entry

- Make the brand mark and restaurant name feel like a composed hero lockup. Keep the animated cook/chilli/pot as a small, charming signature.
- Put open/closed status and the language toggle in a compact utility bar with clear alignment.
- Show a short, useful welcome line. Make it dismissible without consuming a large part of the first screen.
- Make **Scan table QR** the strongest customer action. Use a custom QR-frame graphic, subdued brass details, one subtle moving scan beam, a clear heading, and one-line helper text. It should look integrated with the dark restaurant scene—not like a generic bright yellow button.
- Secondary actions (QR help, how to use, party booking, places, reviews, visit-us) should be compact icon shortcuts with consistent hit areas and quiet hover/tap feedback.
- Keep QR-only customer rules intact. A table number must continue to come from the QR route; do not re-enable a customer table-picker as a workaround for missing QR stickers. If the current code exposes staff table selection, preserve that staff-only behavior.
- Keep staff access unobtrusive but discoverable to authorized team members.

### 2. Customer menu

- Keep the active table visible in the top bar and make cart access obvious without competing with the dishes.
- Give search an unmistakable place near the top. Use compact food-type filters and horizontal categories that scroll naturally on a phone.
- Design menu rows as refined, quick-scan food entries: a visually defined image/icon region, clear dish name, optional short description, price, and easy-to-hit Add/quantity controls. Use consistent alignment so prices and actions are easy to compare.
- Use fine borders and restrained depth. Avoid enclosing the whole screen inside a giant card. Keep each card compact enough to browse many dishes.
- Make selected filters, added quantities, disabled/unavailable dishes, and focus states unmistakable.
- Avoid animated card entry that replays with an exaggerated effect on every minor quantity change. Keep motion brief and subtle.
- Preserve pure veg/non-veg filter logic and existing dynamic menu rendering.

### 3. Cart and order confirmation

- Make the cart a clear summary: item, quantity, special request, line total, order total, and the place-order action.
- Keep payment and ordering separate enough that nobody can accidentally mistake “request bill” for “place order.”
- On successful order submission, clearly confirm the ticket reference, table, and that the ticket went directly to the kitchen. Add a small, tasteful success treatment—not a full-screen celebration that obscures information.
- Keep the existing order-progress steps and “Order more”, “Track my orders”, and “Request bill / Pay” actions. Ensure their hierarchy is obvious.
- A customer may place a separate ticket on the same shared table visit. Preserve the rule that all tickets for that visit contribute to the unified table bill.
- Cash/payment requests must never falsely show that the table has been freed. The visit stays active until authorized staff records the full settlement and the closure conditions are satisfied.

### 4. Waiter experience

- Make table choice, current selected table, open visit, live ticket list, dish search, and send-to-kitchen action easy to scan at a glance.
- Visually distinguish occupied/active tables from free tables using both text/shape/state and color.
- Keep the selected table identity sticky in the user's mental model as they scroll.
- Keep repeated order entry quick: avoid decorative movement around every quantity control and avoid unnecessary confirmation steps.
- Preserve waiter identity/assignment, notification controls, cash-request visibility, permissions, and the rule that waiters cannot record or approve payments unless explicitly authorized by the existing system.

### 5. Kitchen display

- Treat the kitchen display as an operational board, not a marketing page. Prioritize table number, ticket reference, age/elapsed time if already available, items, modifications/allergy notes, and the next available action.
- Use a restrained three-stage visual language (New → Cooking → Ready) with consistent status color and strong typography.
- On desktop, use three balanced lanes with enough width for dish names and notes. On mobile, stack lanes without shrinking text or introducing sideways scrolling.
- Give incoming orders a brief visual arrival cue. Do not keep cards flashing or pulsing.
- Keep controls large enough for touch, avoid accidental adjacent taps, and preserve the existing kitchen state transitions.

### 6. Owner / admin

- Make primary daily tools—Orders, Table QR, Alerts, Menu, Settings—easy to identify. Keep secondary tools grouped under More tools.
- Improve order and alert cards using clear metadata hierarchy, compact status pills, aligned amounts, and clearly differentiated action buttons.
- Give reports and stats an information hierarchy: metric label, prominent value, period/comparison if it exists. Do not fabricate KPIs, values, charts, or status information.
- Style forms consistently with labelled fields, clear focus, validation/error messaging, and buttons that describe their action.
- Table QR management should be especially legible: choose table, preview QR, copy/share/download/print, and show concise next-step guidance. Use small directional cues rather than large instruction blocks.
- Avoid a sea of equal-priority gold buttons. Only the main action in each subtask should receive the strongest emphasis.
- Preserve owner-only permissions, staff roles, settings, table visit/accounting rules, alerts, party bookings, menu management, payment logs, and QR creation.

### 7. Dialogs, notifications and empty/loading/error states

- Keep dialogs visually separated from the page with a restrained dark scrim, strong but thin boundary, readable content, and predictable close/cancel placement.
- Toasts should be brief, non-blocking, readable above mobile bottom controls, and never cover essential buttons.
- Success, waiting, empty, offline, denied-permission, validation, and error states should each tell users what happened and what action is available next.
- Never communicate success before the relevant operation actually succeeds. No fabricated loading percentages or fake order status.

## Accessibility and localization

- Maintain semantic HTML, accessible labels, keyboard focus indicators, and sensible tab order. Do not remove outlines without a replacement.
- Preserve existing English/Marathi language behavior. New or changed customer-facing text must follow the existing translation approach; do not hard-code a new untranslated string if the app's language dictionary should own it.
- Keep color contrast adequate for small text, low-light use, and older phones. Do not reduce secondary text to illegible opacity.
- Respect reduced-motion preferences. Ensure animation does not change content availability or focus behavior.
- Do not use color alone to distinguish open/closed, new/ready, payment requested, disabled, or error states.

## Engineering constraints

- Begin by inspecting the existing app and its CSS/markup. Reuse its actual IDs and classes.
- Prefer a dedicated CSS layer appended after current styles so the visual system can evolve without brittle edits throughout the 480 KB single-file app.
- Keep existing handlers, form names, IDs, navigation, local persistence, Supabase RPC names, database schemas, migrations, RLS, JWT/auth behavior, role restrictions, QR URLs, payment verification, notification behavior, and ticket/visit accounting untouched unless a separately verified bug requires a code change.
- No new large frameworks, animation libraries, tracking scripts, third-party image hosts, or runtime network dependencies for cosmetic effects.
- Use CSS graphics and existing assets first. Do not introduce random stock imagery or remote icons that can disappear during service.
- Add a cache-busted stylesheet reference or equivalent so the deployed app loads the new styling immediately.
- Keep styles namespaced or reasonably specific to the intended screens. Test the QR button, menu cards, sticky topbars, modal sizing, bottom safe area, and the staff/mobile views after changes.
- If a true GitHub fork is unavailable through the available repository tools, work on an isolated feature branch and submit a pull request rather than claiming a fork exists. Promote only after checks pass.

## Acceptance checklist

- [ ] App loads and customer can still scan a table QR, search/filter the menu, add/remove quantities, submit an order, and track it.
- [ ] QR button is premium and restrained: dark surface, subdued brass QR frame, one subtle scan animation, no aggressive glow/shimmer.
- [ ] Existing English/Marathi toggle continues to work.
- [ ] Cart, success state, help/order tracking, cash request, and visit-billing behavior are unchanged.
- [ ] Waiter, kitchen, and owner/admin screens remain fully functional and correctly role-gated.
- [ ] Desktop and small mobile screens have no horizontal overflow or overlapping sticky/bottom controls.
- [ ] All tap targets and focus states remain usable.
- [ ] `prefers-reduced-motion` disables non-essential movement.
- [ ] No fake data, new remote dependencies, database changes, or changes to payment authorization.
- [ ] Repository checks pass and the deployed page loads the updated stylesheet.
