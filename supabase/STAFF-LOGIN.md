# Mirch Masaala staff login

The staff-facing login screen now accepts usernames and passwords. Supabase Auth continues to verify the password, and `staff_profiles` continues to determine the account role. The username is mapped to a synthetic, non-deliverable authentication email inside the browser, so staff do not need to enter or have personal email addresses.

## Default username convention

- Owner/Admin: `owner`
- Waiter: `waiter1`
- Kitchen: `kitchen1`

These are suggested usernames only, not pre-created accounts and not passwords.

## Create the accounts once in Supabase

Until a secure staff-account manager is added to the app, the initial accounts must be created by an owner in the Supabase Dashboard:

1. Open Authentication → Users → Add user.
2. For `owner`, use the internal email `owner@staff.mirchmasaala.invalid`; for `waiter1`, use `waiter1@staff.mirchmasaala.invalid`; for `kitchen1`, use `kitchen1@staff.mirchmasaala.invalid`.
3. Set a unique private password for each user and confirm the account in the dashboard if prompted. These `.invalid` addresses are internal login aliases, not real mailboxes. Staff should type only the username on the website.
4. Copy each new user's Auth UID. In the Supabase SQL Editor, assign the role using the matching UID:

       INSERT INTO public.staff_profiles (user_id, role)
       VALUES ('PASTE_AUTH_USER_UID_HERE'::uuid, 'admin')
       ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

Use role `waiter` for `waiter1` and `kitchen` for `kitchen1`. Run the statement once per account, replacing both the UID and role.

## Security notes

- The app checks the role returned by `get_my_staff_role`; selecting a role on the login screen does not grant that role.
- Never use shared/simple passwords for real restaurant accounts. Create a different password for each person and share it privately.
- Existing staff accounts may still sign in using their old email + password during the transition.
- Do not put Supabase secret/service-role keys or staff passwords into the website source.