# Access requests, approval and password recovery

Status: implemented in code; **NOT TESTED against the real Supabase project** (sandbox cannot reach it). Migration `20261107000000_access_requests.sql` is **not applied remotely** until you push it.

## Who can do what
| Action | Who | Result |
|---|---|---|
| Request access (login page) | Anyone, **suppliers only** (name, company, supplier code, work email, **own password**) | Login is created **banned** (cannot sign in); pending request; admins get an email |
| Register a colleague | Signed-in TMMIN staff (admin/preparer/reviewer), Settings → Register TMMIN staff | Pending request (`via = STAFF`); nothing is created |
| Approve / reject | **Admin only** (Settings → Access requests) | Approve creates the account by e-mail invitation and sets role (+ supplier code) |
| Forgot password | Anyone, suppliers and staff alike (login → Forgot password) | Reset link by e-mail; same answer whether or not the account exists |
| "No email? Ask an administrator" | Anyone on the forgot screen | `password_help` request; admin clicks **Send reset** |
| Approval PIC list | Admin (Settings → Approval PIC) | Who receives the "request waiting" e-mail; empty list = all admins |

Supplier password: chosen at request time, stored only as a Supabase Auth hash. On approval the ban is lifted and a confirmation email is sent; the supplier must click it (proves the email is theirs) before signing in. Rejecting deletes the banned login.

Rules enforced in the server: suppliers can only be granted `supplier` (+ valid supplier code); a request you submitted must be approved by a different admin (unless you are the only admin); every decision writes `audit_events`.

The notification e-mail contains **no approve link**: approval happens signed-in on the website.

## Environment variables (Vercel, server-only)
- `SUPABASE_SERVICE_ROLE_KEY` – needed to create accounts and store public requests. **Never** `NEXT_PUBLIC_`, never committed.
- `APP_BASE_URL` – e.g. `https://your-app.vercel.app` (used in links; falls back to the request host).
- `STAFF_EMAIL_DOMAINS` – optional, e.g. `tmmin.co.id` (comma list). Empty = admin reviews every staff request anyway.
- `NOTIFY_SMTP_HOST/PORT/USER/PASS/FROM` – approval notification mail (falls back to `FLOW_SMTP_*`). Without it requests still appear in the admin queue; the notification status is stored as `SMTP_NOT_CONFIGURED`.
- `THROTTLE_SALT` – optional random string for hashing rate-limit keys.

## Supabase dashboard settings (required, do these once)
1. **Authentication → Sign In / Providers → turn OFF “Allow new users to sign up”.** Otherwise anyone with the public key can create an account themselves. Accounts must come only from approvals.
2. **Authentication → SMTP**: configure a custom SMTP. The built-in Supabase mailer only delivers to your own team and is heavily rate-limited, so supplier invites and resets will NOT arrive without it.
3. **Authentication → URL Configuration**: Site URL = your app URL; add `<APP_BASE_URL>/auth/confirm` to Redirect URLs.
4. **Authentication → Email Templates**: make the links work from any device:
   - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`
   - Confirm signup: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/workspace`
   - Invite user: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/reset-password`
5. **Authentication → Password policy**: set a minimum length (the form already requires 10+ with a digit) and consider leaked-password protection.

## Protections built in
Same-origin check on public POSTs, honeypot field, input length/charset validation, per-IP and per-email rate limits (hashed, stored server-side), no account enumeration on forgot-password and password-help, single pending request per email, RLS on all new tables (browser cannot write them), service-role key used only in route handlers, audit log for requests/decisions.

## Not implemented
Authenticator-app (TOTP) MFA and SSO. Supabase supports TOTP MFA; add it as a follow-up if required. Forgot-password is the primary recovery path.
