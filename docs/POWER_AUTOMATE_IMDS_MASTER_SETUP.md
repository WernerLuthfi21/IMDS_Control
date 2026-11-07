# Power Automate setup — IMDS Super Master

This setup uses the website's Supabase-backed IMDS Super Master as the source of truth. The website reads the shared master directly, and these two separate Power Automate flows mirror changes to Excel and send supplier-specific follow-ups.

**Do not reuse `POWER_AUTOMATE_EXCEL_URL`** from the existing G-CATS judgement integration. The Tracker writeback flow has its own URL.

## A. Prepare the Excel master workbook

1. Open the website's **IMDS Tracker → Master Data** page.
2. Upload the workbook containing the `Part List LATEST` sheet.
3. Check the imported row count, then choose **Download Super Master XLSX**.
4. Save that exported workbook in a stable OneDrive for Business or SharePoint location.
5. Confirm it contains:
   - Sheet: `Part List LATEST`
   - Excel table: `PartMaster`
   - Key column: `MasterKey`

The exported sheet retains the Part List LATEST columns and appends `Supplier Promise Date` and `MasterKey`. It also contains an `MD System History` sheet. Keep the workbook in the same OneDrive/SharePoint location after the Flow is configured; do not replace it with a workbook that lacks the `PartMaster` table or `MasterKey` column.

## B. Flow 1 — write Tracker changes to the master Excel

Create an **Instant cloud flow** named, for example, `IMDS Tracker - Update Super Master`.

### 1. Trigger

Choose **When an HTTP request is received**.

Use this JSON schema in the trigger:

```json
{
  "type": "object",
  "properties": {
    "type": { "type": "string" },
    "source": { "type": "string" },
    "rows": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "No.": {},
          "PROJECT": { "type": "string" },
          "VENDOR CODE": { "type": "string" },
          "MAIN PIC EMAIL": { "type": "string" },
          "COMPANY NAME": { "type": "string" },
          "PART NAME": { "type": "string" },
          "P/No.": { "type": "string" },
          "SUBMISSION PLAN": {},
          "IMDS STATUS": { "type": "string" },
          "ID / Ver": { "type": "string" },
          "Part Status": { "type": "string" },
          "Have respond email": { "type": "string" },
          "STATUS UPDATE": { "type": "string" },
          "ID/Ver": { "type": "string" },
          "Date": {},
          "Comment": { "type": "string" },
          "LPOP Confirmation": { "type": "string" },
          "CEK": { "type": "string" },
          "Supplier Promise Date": {},
          "MasterKey": { "type": "string" }
        },
        "required": ["MasterKey"],
        "additionalProperties": true
      }
    }
  },
  "required": ["type", "rows"]
}
```

The extra `additionalProperties` setting allows columns added to the workbook later to be included in the request. If the designer requires a concrete schema for newly added columns, regenerate the Parse JSON schema after the workbook header changes.

### 2. Check the shared secret

Add a Condition before accessing Excel. Compare the incoming HTTP header with the same secret stored in Vercel as `POWER_AUTOMATE_SECRET`.

Left value (Expression):

```text
triggerOutputs()?['headers']?['x-imds-secret']
```

Right value: the secret value you chose for this integration.

Only continue in the **Yes** branch. In the **No** branch, use a Response action with status code `401`. Keep the secret private; do not put it in the URL, email body, or logs. Enable Secure Inputs/Outputs on actions that expose the header or secret where your tenant supports it.

### 3. Apply to each row

Add **Apply to each** and select `rows` from the trigger body. Set loop concurrency to **1** to avoid concurrent edits to the same Excel workbook.

Inside the loop add **Excel Online (Business) → List rows present in a table**:

- Location: the OneDrive/SharePoint location where you saved the Super Master.
- File: the Super Master workbook.
- Table: `PartMaster`.
- Filter Query (choose the **Expression** tab):

```text
concat('MasterKey eq ''', string(items('Apply_to_each')?['MasterKey']), '''')
```

This must produce an OData filter such as:

```text
MasterKey eq 'your-master-key-value'
```

Add a Condition to check whether the List rows action returned a row:

```text
greater(length(body('List_rows_present_in_a_table')?['value']), 0)
```

- **Yes:** use **Update a row**. Table = `PartMaster`, Key Column = `MasterKey`, Key Value = `items('Apply_to_each')?['MasterKey']`. Map the incoming row fields to the same-named Excel columns.
- **No:** use **Add a row into a table**. Table = `PartMaster`. Map the same fields.

At minimum map all columns through `MasterKey`. Map any additional dynamic columns that you have deliberately added to the table. Do not use the display row number as the key; `MasterKey` stays stable when rows are sorted or new models are added.

### 4. Response

After the Apply to each finishes, add **Response**:

- Status Code: `200`
- Body:

```json
{ "ok": true, "message": "IMDS Super Master updated" }
```

Save the Flow and copy its HTTP URL. Add it to Vercel as:

- Name: `POWER_AUTOMATE_TRACKER_URL`
- Value: the HTTP URL from this Flow
- Environment: Production (and Preview if you test preview deployments)

Keep the existing `POWER_AUTOMATE_EXCEL_URL` for the G-CATS judgement integration.

## C. Flow 2 — send individual supplier follow-ups with PDF

Create a second Instant cloud flow named, for example, `IMDS Tracker - Supplier Follow-up`.

### 1. Trigger

Choose **When an HTTP request is received** and use this schema:

```json
{
  "type": "object",
  "properties": {
    "type": { "type": "string" },
    "supplierCode": { "type": "string" },
    "supplierName": { "type": "string" },
    "to": { "type": "string" },
    "cc": { "type": "string" },
    "subject": { "type": "string" },
    "body": { "type": "string" },
    "attachments": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "contentType": { "type": "string" },
          "contentBytes": { "type": "string" }
        },
        "required": ["name", "contentBytes"]
      }
    }
  },
  "required": ["type", "to", "subject", "body", "attachments"]
}
```

Add the same header Condition as Flow 1:

```text
triggerOutputs()?['headers']?['x-imds-secret']
```

Continue only when it matches the shared secret; otherwise respond with `401`.

### 2. Send the email

In the Yes branch add **Office 365 Outlook → Send an email (V2)**:

- To: `to` from the request.
- CC: `cc` from the request (it may be blank).
- Subject: `subject` from the request.
- Body: `body` from the request.
- Attachment Name: `first(triggerBody()?['attachments'])?['name']`
- Attachment Content: use the Expression:

```text
base64ToBinary(first(triggerBody()?['attachments'])?['contentBytes'])
```

The website sends one supplier per HTTP request. The PDF contains only that supplier's outstanding parts. The website's **Send all sequentially** button sends one supplier, waits for the response, then proceeds to the next supplier; it is not a single blast email.

### 3. Response

After **Send an email (V2)** succeeds, add **Response** with status code `200` and body:

```json
{ "ok": true, "message": "Supplier follow-up sent" }
```

For the failure branch, return a non-2xx response such as `500` so the website logs the send as failed.

Save the Flow and add its HTTP URL to Vercel as:

- Name: `POWER_AUTOMATE_EMAIL_URL`
- Value: the HTTP URL from this Flow
- Environment: Production (and Preview if you test preview deployments)

Use the same `POWER_AUTOMATE_SECRET` value in both Flows and Vercel.

## D. Vercel settings and first test

In Vercel → Project → Settings → Environment Variables, configure these server-only variables:

| Name | Purpose |
|---|---|
| `POWER_AUTOMATE_TRACKER_URL` | Flow 1: Excel master upsert |
| `POWER_AUTOMATE_EMAIL_URL` | Flow 2: supplier-specific email + PDF |
| `POWER_AUTOMATE_SECRET` | Shared header secret used by both Flows |

Do not rename or remove `POWER_AUTOMATE_EXCEL_URL`; it belongs to the existing judgement integration. After saving variables, redeploy the relevant Vercel environment.

Test in this order:

1. Import the IMDS Remaining workbook to initialise the shared master.
2. Download the Super Master XLSX and place it in the OneDrive/SharePoint file referenced by Flow 1.
3. Upload one MD System SearchResult workbook. Check the match summary; ambiguous/unmatched rows must be reviewed rather than silently written to a supplier.
4. Open **Sync now** and confirm the queue moves from Pending to Sent.
5. Edit one safe test row in Master Data and confirm the corresponding `MasterKey` row changes in Excel.
6. Configure Flow 2, open one supplier follow-up preview, verify the To/CC and PDF, then send to one test supplier first.

The website remains backed by Supabase and uses Realtime plus a periodic refresh. Excel is the connected workbook mirror; direct edits made outside the website are not automatically pulled back into Supabase by these two flows. To make external Excel edits flow back as well, configure a separate reverse-sync process rather than allowing two systems to overwrite one another silently.
