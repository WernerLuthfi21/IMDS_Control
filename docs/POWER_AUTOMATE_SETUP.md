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


---
# Option B — NO Premium licence (mail transport, standard connectors only)
Use this when "When an HTTP request is received" is unavailable. Status: **NOT TESTED** against a real tenant.

Why not call Excel from an Office Script directly? Microsoft documents that `fetch` fails when a script runs through Power Automate ("fetch is not defined"), so a script cannot pull from this app on a schedule. Scripts can only be fed JSON by the flow.

## How it works
App → SMTP → a command e-mail in YOUR Outlook inbox → flow trigger **When a new email arrives (V3)** (standard) → Excel Online **Update a row** (standard) or Outlook **Send an email (V2)** (standard). Typical delay: seconds to a minute or two.

## App settings (Vercel, server-only)
`FLOW_SMTP_HOST`, `FLOW_SMTP_PORT` (465), `FLOW_SMTP_USER`, `FLOW_SMTP_PASS`, `FLOW_SMTP_FROM`, `FLOW_INBOX_ADDRESS` (your Outlook address), `POWER_AUTOMATE_SECRET`. Leave `POWER_AUTOMATE_*_URL` empty. For Gmail use a dedicated sender account with 2-step verification and an **app password** (not the normal password). Do not use a personal mailbox you care about; create a throwaway sender.

## Flow A – Excel master
Trigger: *When a new email arrives (V3)*, Folder Inbox, **From** = the sender address, **Subject Filter** = `IMDS-SYNC|<your secret>|excel_upsert`.
1. *Parse JSON* on the e-mail body text, schema as in Flow 1 above (`code`, `Assigned person`, …).
2. Excel Online → *Update a row* (Key Column `code`, Key Value `code`), map columns.
3. (Optional) *Mark as read*.
Body arrives as plain text JSON; if Outlook wraps it in HTML, use `body` → expression `triggerOutputs()?['body/bodyPreview']` or an HTML-to-text step first.

## Flow B – supplier e-mail
Trigger as above, Subject Filter `IMDS-SYNC|<your secret>|supplier_email`. *Parse JSON* (`to`, `cc`, `subject`, `body`) → Outlook *Send an email (V2)*.

## Honest status rules
- Outbox "SENT" with `handed_off_via_mail` = SMTP accepted it. The app **cannot know** whether the flow ran or Outlook sent the supplier mail. The follow-up stays `COMPOSED`, and the Follow-up page shows it as already handed off (so it is not re-sent).
- Check the flow's run history in Power Automate to confirm. A "stuck" Excel update shows there, not here.
- Risk: anyone who can both spoof the sender and guess the subject secret could trigger the flow. Keep the secret long and the From filter on.

---
# Option C — direct, no Premium: "When a Teams webhook request is received"
The built-in **Microsoft Teams Webhook** trigger is a standard (non-premium) trigger that gives a URL accepting POST JSON. Use it exactly like Flow 1/2 but: (a) add **Parse JSON** with Content `triggerBody()`; (b) read the secret from `triggerOutputs()?['headers']?['x-imds-secret']`; (c) use no **Response** action (it is premium; the trigger answers 202 by itself). Put the URL in `POWER_AUTOMATE_EXCEL_URL` / `POWER_AUTOMATE_EMAIL_URL`. Status: NOT TESTED by the author; verify with the **Test** button below.

# Checking and operating it (Follow-up page → Power Automate panel)
- **Checklist:** shows whether the Excel flow, e-mail flow and secret are configured and which transport is used (direct or via mailbox).
- **Test (Excel):** upserts the fixed row `IMDS-PING` (first run adds it, later runs update it, so both paths are exercised). Delete the row whenever you like.
- **Send test to me:** sends one e-mail to your own address only.
- **Top bar pill:** “Excel in sync / n waiting / n failed”. While any internal user has the app open, queued or failed jobs are retried automatically about once a minute; **Retry failed now** gives exhausted jobs a fresh start.
- **Download register CSV:** one-time seed of the current WORKING register in the exact column order of the Excel table. Cells beginning with `= + - @` are prefixed with `'` so Excel never runs them as formulas.
- **Bulk send:** search/filter, Select all shown, Preview of the exact message, progress bar; strictly one e-mail after another; recipients without a supplier PIC are blocked; an item already sent is skipped.
- Limits: if nobody has the app open and the flow is down, retries wait until someone opens it (Vercel Hobby cron is daily only).
