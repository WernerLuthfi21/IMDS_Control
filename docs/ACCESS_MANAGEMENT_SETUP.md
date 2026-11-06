# Access management setup

This feature is deployed with the application code, but the database migration and server-side credentials must be configured before access requests, provisioning and email notifications are active.

## 1. Apply the database migration

From the repository root, link the correct Supabase project and apply migrations:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Confirm that the migration `20261106000400_access_management.sql` was applied. It creates `access_requests`, `access_approval_recipients` and the narrowly scoped supplier-request RPC.

Do not expose database owner credentials or a service-role key in client code.

## 2. Configure Vercel server environment variables

Add the following to the Vercel project. The service role key must be stored as a sensitive server-only variable; never prefix it with `NEXT_PUBLIC_`.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Auth invitation/provisioning and secure read of configured approval recipients |
| `FLOW_SMTP_HOST` | SMTP host for Admin approval notifications |
| `FLOW_SMTP_PORT` | SMTP port, typically 465 or 587 depending on provider |
| `FLOW_SMTP_USER` | SMTP account |
| `FLOW_SMTP_PASS` | SMTP credential or app password; store as sensitive |
| `FLOW_SMTP_FROM` | Approved sender address; defaults to SMTP user |
| `NEXT_PUBLIC_ACCESS_REQUEST_EMAIL` | Optional legacy fallback recipient if the Admin recipient list is empty |

Add sensitive variables to Production and Preview only where those environments should send actual approval emails or invitations. Use approved TMMIN mail infrastructure and its security policy for SMTP.

## 3. Configure Supabase Auth email delivery and redirects

In Supabase Authentication settings:

- Configure the SMTP sender and delivery provider for invite and password recovery emails.
- Set the production Site URL to the IMDS workspace domain.
- Add the exact `/reset-password` redirect URL to the allowed redirect URLs.
- Add the relevant preview URL only if password recovery/invitations are intentionally tested in Preview.

The application's `FLOW_SMTP_*` sender sends the notification to Admin PICs. Supabase Auth SMTP separately sends the user invitation and password recovery link.

## 4. Bootstrap and secure the Admin

Ensure at least one trusted TMMIN administrator already has `profiles.role = 'admin'`. Role assignment for the first administrator must be performed through the existing trusted database/admin process, not through the public request form.

The administrator should:

1. Sign in to the workspace.
2. Open Settings and enrol a TOTP authenticator (Microsoft Authenticator, Google Authenticator or a compatible app).
3. Verify the authenticator code.
4. Open Access management and add one or more Admin PIC email recipients.
5. Test a supplier request and a staff nomination, then approve or reject them from the web queue.

Admin approval actions, recipient changes and role changes require a verified authenticator session (AAL2). Without a verified factor, these sensitive operations fail closed until MFA is configured.

## 5. Access flows

- Public login: sign in or submit a **Supplier** access request. The request cannot create an account or choose a role; it is stored as pending.
- TMMIN internal account: an authenticated non-supplier staff member can nominate a colleague from **Request TMMIN account**. The account starts at `viewer` and is not provisioned until Admin approval.
- Admin: **Access management** displays both request types, allows approve/reject and manages approval-email recipients.
- Password recovery: `/forgot-password` sends a single-use Supabase recovery link to `/reset-password`. Users can also change their password in Settings.
- Sign-in: users with an enrolled authenticator complete a TOTP challenge after password verification.

## 6. Operational notes

- A request is saved even when notification email is not configured; the submitter is shown an explicit warning and the request remains in the Admin queue.
- Configure at least one active Admin PIC and verify SMTP delivery before relying on automatic notification.
- Review Supabase Auth email delivery logs and the Vercel function logs during initial testing.
- Never send a service-role key, SMTP credential or recovery link in a support message.
