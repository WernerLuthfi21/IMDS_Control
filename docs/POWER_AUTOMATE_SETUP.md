# Power Automate bridge (Excel master + supplier e-mail)

Status: **implemented in the app, NOT TESTED against a real Power Automate tenant.** The app only posts JSON to two flow URLs you create. It does not log in to SharePoint, Outlook or G-CATS itself.

## How it works
1. Every saved judgement (AO–AW) writes the register first, then adds an `EXCEL_UPSERT` job to `sync_outbox`, then posts the *current* row to the Excel flow after the response. Failed jobs stay queued (max 5 tries); **Sync now** on the Follow-up page retries them.
2. Bulk supplier mail: tick rows on the Follow-up page → one click → the browser calls the server once per row, strictly in order. Each call creates the follow-up, posts to the e-mail flow, and marks it `SENT` only when the flow answers HTTP 2xx. “SENT” = accepted by the flow, not read by the supplier.
3. If a flow URL is not set, nothing is claimed as synced; the UI shows “NOT configured” and jobs wait.

## Requirements / caveats
- Trigger **“When an HTTP request is received”** is a **premium** connector: needs Power Automate Premium (or equivalent) for the flow owner. Confirm your licence first.
- Excel Online (Business) actions work only on an **Excel Table** inside a workbook in SharePoint/OneDrive. Convert the judgement register sheet to a Table (Insert → Table) with a unique `code` column. Duplicate header names and multiple historical master sheets are not merged by the app; point the flow at ONE sheet/table only.
- Row lock: Excel actions fail if someone has the file open in desktop Excel with exclusive edit; turn on “Retry policy” on the action.

## Flow 1 – Excel master (`POWER_AUTOMATE_EXCEL_URL`)
Trigger *When an HTTP request is received*, schema:
```json
{"type":"object","properties":{"type":{"type":"string"},"code":{"type":"string"},
"Assigned person":{"type":"string"},"Starting date":{"type":"string"},"Judgment procedure":{"type":"string"},
"Judge OK/NG":{"type":"string"},"Comment of changing to OK":{"type":"string"},"IMDS Reject comment":{"type":"string"},
"KM Judge":{"type":"string"},"KM Comment":{"type":"string"},"Last Change Date":{"type":"string"}}}
```
1. Condition: header `x-imds-secret` equals your secret (`triggerOutputs()['headers']['x-imds-secret']`); otherwise Response 401 and stop.
2. Excel Online → **Update a row**: Key Column `code`, Key Value `triggerBody()?['code']`, map the columns above.
3. Response 200 (on failure of step 2 configure Response 500 with “run after: has failed”).
Header names must match your table headers; rename in the action mapping if yours differ.

## Flow 2 – supplier e-mail (`POWER_AUTOMATE_EMAIL_URL`)
Payload: `{type, followupId, to, cc, subject, body}` (all strings; `cc` is `;`-separated).
1. Same secret check.
2. Outlook → **Send an email (V2)**: To `to`, CC `cc`, Subject `subject`, Body `body`.
3. Response 200 only after the send step succeeded (else 500).

## App environment (Vercel, server-only, never NEXT_PUBLIC)
`POWER_AUTOMATE_EXCEL_URL`, `POWER_AUTOMATE_EMAIL_URL`, `POWER_AUTOMATE_SECRET`. The flow URL contains a signature: treat it as a secret.

## Database
Migration `20261106000300_sync_outbox.sql` (additive). Check remote migration versions before pushing; never reset the remote project.

## Not covered
No SharePoint read-back of manual Excel edits through this bridge (the existing read-only fetch remains). Direct G-CATS / MD System integration is not implemented.
