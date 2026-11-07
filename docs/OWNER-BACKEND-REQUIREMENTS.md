# Owner dashboard — backend contracts and missing requirements

Phase 3 builds the Owner dashboard **only on database objects that already exist** in `supabase/*.sql`.
Nothing here was run against a live Supabase project; no SQL was executed or changed.

## 1. Where permissions are enforced

The UI hides tabs, but the real gate is the database. Each RPC below starts with
`get_my_staff_role()` and raises `Owner/Admin access required` for any other role, and is `GRANT`ed to
`authenticated` only (anon revoked):

| RPC (file) | Used by panel |
|---|---|
| `mm_admin_accounts_summary(date)` (setup-live) | Dashboard, Reports |
| `mm_admin_cancel_order(text,text)` (setup-live) | Orders |
| `mm_admin_review_customer_order(text,text,text)` (visit-service-controls) | Orders (approve/reject) |
| `mm_admin_set_table_capacity(text,int)` (menu-item-options-and-table-capacity) | Tables |
| `mm_admin_list_party_bookings(int)`, `mm_admin_update_party_booking(uuid,text,text)` (party-bookings) | Bookings |
| `mm_admin_save_waiter(text,text)`, `mm_admin_set_waiter_active(text,bool)`, `mm_list_waiters(bool)` (owner-operations-toolkit) | Team |
| `mm_admin_set_restaurant_review_status(uuid,text)`, `mm_admin_delete_restaurant_review(uuid)` (restaurant-feedback) | Reviews |
| `mm_admin_maintenance_status()`, `mm_admin_export_backup()`, `mm_admin_record_backup_export()`, `mm_admin_reset_business_data(text,bool)` (owner-operations-toolkit) | Backup / Reset |
| `mm_staff_record_visit_payment` (admin only), `mm_staff_get_visit_bill` | Payments |

Direct table access: `mm_restaurant_config` INSERT/UPDATE needs role `admin` (RLS);
`menu_items` UPDATE is limited to the columns `price, is_available` (column grant) for admin and kitchen.

## 2. Panel status

| Panel | Status | Backed by |
|---|---|---|
| Dashboard / live activity | Supported | accounts summary, `orders`, table visits, notifications, maintenance status |
| Orders | Supported | `orders`, cancel / review RPCs |
| Tables and QR | Supported (create / rename / deactivate **blocked**, see 3) | table RPCs, client QR |
| Menu | Partly: price + availability only | `menu_items` UPDATE (price, is_available) |
| Waiters | Supported | waiter RPCs |
| Kitchen | Read-only overview | `orders`, `menu_items` |
| Staff logins | **Blocked** | see 3 |
| Bookings and party orders | Supported | party booking RPCs |
| Payments and billing | Supported | visit bill / payment RPCs |
| Reviews | Supported | `mm_restaurant_reviews` + admin RPCs |
| Places to Visit | **Blocked** | no table or RPC |
| Sales reports | Supported (daily summary) | accounts summary |
| Notifications | Supported | `mm_staff_notifications`, `mm_resolve_staff_notification` |
| Backup | Supported (export + status) | export / record RPCs |
| Restore | **Blocked** | no restore RPC |
| Reset | Supported, guarded | `mm_admin_reset_business_data` (needs recorded backup + typed phrase) |
| Settings | Partly | `mm_restaurant_config` columns only |

## 3. Missing backend (needs a migration — NOT created here)

1. **Menu CRUD** — no INSERT/DELETE grant on `menu_items` / `categories`, and no UPDATE grant on
   `name`, `description`, `category_id`, options. Needed: admin-only RPCs
   (`mm_admin_upsert_menu_item`, `mm_admin_archive_menu_item`, `mm_admin_upsert_category`) plus an `archived_at` column.
2. **Settings columns** — `mm_restaurant_config` has no: logo, description, address / location,
   opening hours, holidays, tax %, service charge %, restaurant language. Needed: new columns (with CHECKs)
   or a `mm_restaurant_hours` table, plus a storage bucket for the logo.
   The existing admin UPDATE policy would cover them once the columns exist.
3. **Table CRUD** — `restaurant_tables` has SELECT only. Needed: `mm_admin_create_table`,
   `mm_admin_rename_table`, `mm_admin_set_table_active`.
4. **Staff logins** — logins are Supabase Auth users mapped by a role table; there is no RPC to create,
   disable or reset them. This needs a service-role Edge Function (never the browser). The UI therefore never
   handles passwords. See `supabase/STAFF-LOGIN.md`.
5. **Restore** — `mm_admin_export_backup()` exists; there is no import RPC. A restore must be a reviewed,
   transactional, admin-only function, because a client-side restore would write business data row by row.
6. **Places to Visit** — no table.
7. **Sales analytics beyond one day** — `mm_admin_accounts_summary(date)` returns a single day; a range or
   item-level report needs a new RPC.

## 4. Test evidence limits

`scripts/qa-v2` runs the real front-end in Chromium against an **in-memory fake of these contracts**
(`fake-backend.cjs`), which re-implements each RPC's role check and rules as read from the SQL. It proves the UI
calls the right contracts and handles refusals. It does **not** prove the live database behaves identically.
A real-Supabase run needs a throwaway project or branch with the migrations applied.
