# Security and document handling policy

## Classification policy

- `PROTECTED`: may be processed for this project under the user's stated permission. Restrict access, retain source provenance and keep repositories private until redistribution is approved.
- `INTERNAL`: process only within the controlled project environment and according to the owner's policy.
- `PUBLIC`: may be processed.
- `CONFIDENTIAL`: prohibited. Do not read, extract, index, upload, store, summarize, copy into source, prompts, logs, screenshots, tests or skill knowledge bases.
- `UNKNOWN`: block processing until classification is confirmed.

The workbook import endpoint requires explicit classification and rejects CONFIDENTIAL/UNKNOWN. This is an application safeguard; user classification must be truthful and is not an automated content-classification scanner.

## Secrets

- Keep `.env.local` and `.env` out of version control.
- Only publishable/anon Supabase keys are used by browser-facing code.
- Never put a Supabase service-role key in `NEXT_PUBLIC_*` or a client component.
- Rotate credentials if they are ever committed or disclosed.

## Access

- `viewer`: default; read-only role.
- `preparer`: may stage and commit imports and prepare workflows.
- `reviewer`: review/approval role.
- `rule_author`: may create draft rule definitions.
- `rule_approver`: may approve rule versions and finalize eligible judgements.
- `admin`: administrative privileges.
- `supplier`: sees only Supplier Self-check for its own supplier code (RLS by `supplier_code` on the profile).

Grant roles through a controlled administrator action / SQL, not through client input.

## Important limitation

Classification selection is an explicit user attestation. The application does not inspect document markings automatically, scan all text for Confidential labels, or certify legal handling permission. Before external processing, verify that the full document and all included data may be processed by the selected infrastructure and service providers.


## Auto-judgement and memory

- Auto-judgement writes final OK/NG only under the conditions in `docs/RULE_COVERAGE.md` (owner decision of 2026-11-18). Settings changes need admin or rule approver and are audited with before/after values. Running needs preparer, reviewer or admin; writes go through the caller's RLS session, never a service-role key.
- `judgement_memory` stores only short validated codes (destination, tolerance class, Y/N answers) per delivery part number, with who/when. No supplier documents or source rows are copied into it.

## Database function and row-policy safeguards

- Exposed `public` tables are protected by Row Level Security policies. The later bulk-preparation RPC is `SECURITY INVOKER`, so it remains subject to the caller's table policies; the migration grants reviewer update access to the register while the judgement guard trigger still restricts KM fields to reviewer/admin.
- Bulk preparation accepts only `assigned_person`, `starting_date`, and `judgement_procedure`, verifies all selected rows share one exact historical Error Type label, and writes a change log for each row. It cannot update Judge, OK/NG comments or KM review fields.
- `current_app_role()` and `has_any_role()` are granted only to authenticated users and are used by row policies. Trigger-only functions are revoked from `PUBLIC` and `anon`. Guarded commit/finalization RPCs have explicit role checks and authenticated-only execution grants.
- **Reviewed exception (2026-11-19, migration `20261119030000`):** `current_app_role()` runs as `SECURITY DEFINER`.
  - Why: as invoker it read `profiles`, whose policy calls `has_any_role()` → `current_app_role()` again. With Supabase's non-leakproof `auth.uid()` the policy runs on every profile row, so with two or more users it looped to `stack depth limit exceeded`, SQLSTATE 54001 ("database error, code: 54001" in Storage). Reproduced on PG16 and fixed.
  - Threat review: no arguments; returns only the caller's role (`where id = auth.uid()`); fixed `search_path`; no writes; not executable by `anon`. `has_any_role()` stays invoker.
- Never replace a failed RLS policy with a broad `SECURITY DEFINER` function. Any future definer function must have an explicit threat review, fixed search path, internal role check, least-privilege execute grants and a documented reason it cannot run as invoker.

## Access requests, approval and password recovery

Migration `20261107000000_access_requests.sql`. Check it is applied remotely (`npx supabase migration list --linked`) before relying on these screens.

### Who can do what
| Action | Who | Result |
|---|---|---|
| Request access (login page) | Anyone, **suppliers only** (name, company, supplier code, work email, **own password**) | Login is created **banned** (cannot sign in); pending request; admins get an email |
| Register a colleague | Signed-in TMMIN staff (admin/preparer/reviewer), Settings → Register TMMIN staff | Pending request (`via = STAFF`); nothing is created |
| Approve / reject | **Admin only** (Settings → Access requests) | Approve creates the account by e-mail invitation and sets role (+ supplier code) |
| Forgot password | Anyone, suppliers and staff alike (login → Forgot password) | Reset link by e-mail; same answer whether or not the account exists |
| "No email? Ask an administrator" | Anyone on the forgot screen | `password_help` request; admin clicks **Send reset** |
| Approval PIC list | Admin (Settings → Approval PIC) | Who receives the "request waiting" e-mail; empty list = all admins |

Supplier password: chosen at request time, stored only as a Supabase Auth hash. On approval the ban is lifted and the admin vouches for the email, so the supplier can sign in immediately (check the “contact on file” badge before approving). Strict mode: set `REQUIRE_EMAIL_CONFIRMATION=1` and configure Auth SMTP; then the supplier must click a confirmation email first. Rejecting deletes the banned login.

Rules enforced in the server: suppliers can only be granted `supplier` (+ valid supplier code); a request you submitted must be approved by a different admin (unless you are the only admin); every decision writes `audit_events`.

The notification e-mail contains **no approve link**: approval happens signed-in on the website.

### Environment variables (Vercel, server-only)
- `SUPABASE_SERVICE_ROLE_KEY` – needed to create accounts and store public requests. **Never** `NEXT_PUBLIC_`, never committed.
- `APP_BASE_URL` – e.g. `https://your-app.vercel.app` (used in links; falls back to the request host).
- `STAFF_EMAIL_DOMAINS` – optional, e.g. `tmmin.co.id` (comma list). Empty = admin reviews every staff request anyway.
- `NOTIFY_SMTP_HOST/PORT/USER/PASS/FROM` – approval notification mail (falls back to `FLOW_SMTP_*`). Without it requests still appear in the admin queue; the notification status is stored as `SMTP_NOT_CONFIGURED`.
- `THROTTLE_SALT` – optional random string for hashing rate-limit keys.

### Supabase dashboard settings (required, do these once)
1. **Authentication → Sign In / Providers → turn OFF “Allow new users to sign up”.** Otherwise anyone with the public key can create an account themselves. Accounts must come only from approvals.
2. **Authentication → SMTP**: configure a custom SMTP. The built-in Supabase mailer only delivers to your own team and is heavily rate-limited, so supplier invites and resets will NOT arrive without it.
3. **Authentication → URL Configuration**: Site URL = your app URL; add `<APP_BASE_URL>/auth/confirm` to Redirect URLs.
4. **Authentication → Email Templates**: make the links work from any device:
   - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`
   - Confirm signup: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/workspace`
   - Invite user: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/reset-password`
5. **Authentication → Password policy**: set a minimum length (the form already requires 10+ with a digit) and consider leaked-password protection.

### Protections built in
Same-origin check on public POSTs, honeypot field, input length/charset validation, per-IP and per-email rate limits (hashed, stored server-side), no account enumeration on forgot-password and password-help, single pending request per email, RLS on all new tables (browser cannot write them), service-role key used only in route handlers, audit log for requests/decisions.

### Not implemented
Authenticator-app (TOTP) MFA and SSO. Supabase supports TOTP MFA; add it as a follow-up if required. Forgot-password is the primary recovery path.

## Browser security headers (2026-11-21)

`lib/security/headers.ts`, applied to every route in `next.config.ts` (tested in `tests/security-headers.test.ts`
and the E2E header check):

- **Content-Security-Policy (enforced)**: `default-src 'self'`; scripts only from this origin (+ `vercel.live` for
  preview comments); `connect-src` this origin + the Supabase project (https + wss); `img-src` self, data:, blob:,
  Supabase; fonts self-hosted (`font-src 'self'`); `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
  `frame-ancestors 'none'`. App pages get a **per-request nonce** from `proxy.ts` (`'nonce-…' 'strict-dynamic'`); Next.js tags its
  scripts from the request CSP header and the layout tags the theme script via `x-nonce`. An injected inline script
  without the nonce does not run. `'unsafe-inline'` remains only as the CSP1 fallback (ignored when a nonce is present).
- `/imds-tracker` gets the same policy plus exactly what the approved Tracker loads: cdnjs (SheetJS, jsPDF,
  autotable), jsDelivr (MSAL), Google Fonts, Microsoft Graph / login. COOP there is `same-origin-allow-popups` for
  the MSAL sign-in popup; everywhere else `same-origin`.
- Also: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` (camera, microphone, geolocation, payment, usb off), HSTS in production.

Open findings (owner decision, Tracker is approved UI):
- The Tracker loads four CDN scripts **without Subresource Integrity**. Add `integrity` + `crossorigin` hashes for the
  pinned versions, or self-host the files, in the Tracker integration PR.
- Tracker `innerHTML` writes (44) were reviewed: user and workbook values pass through `esc()` / `escAttr()`;
  the remaining interpolations are numbers, fixed labels and internal ids.

