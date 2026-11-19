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
- **Exception, reviewed 2026-11-19 (migration `20261119030000`):** `current_app_role()` runs as `SECURITY DEFINER`. Reason it cannot run as invoker:
  - It reads `public.profiles`, whose SELECT policy calls `has_any_role()` → `current_app_role()`.
  - With Supabase's non-leakproof `auth.uid()`, Postgres evaluates that policy on every row first. As soon as there are two profiles, the loop ends in `stack depth limit exceeded` (SQLSTATE 54001). Storage reports it as "database error, code: 54001" on every upload by other accounts. Reproduced on PG16 before the fix and gone after it.

  Threat review:
  - The function takes no arguments and returns only the caller's own role (`where id = auth.uid()`).
  - It cannot be widened to other users, it has a fixed `search_path = public, pg_temp`, and execute is revoked from `PUBLIC`/`anon`.
  - It writes nothing.
  - `has_any_role()` stays `SECURITY INVOKER`.
- Never replace a failed RLS policy with a broad `SECURITY DEFINER` function. Any future definer function must have an explicit threat review, fixed search path, internal role check, least-privilege execute grants and a documented reason it cannot run as invoker.
