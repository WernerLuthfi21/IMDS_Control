# User guide

## Judgement Register

The register is the daily home page. Search by source code, delivery part number, supplier code, Error Type or assigned person. Filter to a historical Error Type, then open the row to work on the nine AO–AW fields.

### Record detail

- **Assigned person**: operator who checks the G-CATS error.
- **The starting date**: date checking begins.
- **Judgment procedure**: record the documents and checks actually completed. Historical suggestions are aids; verify their applicability before using them.
- **Judge (OK/NG)**: operator result after checking.
- **Comment of Record of changing to “OK”**: required when Judge is OK.
- **IMDS Reject comment**: required when Judge is NG.
- **KM Judge / KM Comment**: area-leader (TMA KM) recheck, restricted to reviewer/admin.
- **Last Change Date**: set by the website when the record is saved.

A source judgement value outside exact `OK` or `NG` is displayed as a source value requiring review; it is not coerced into an active judgement.

### Bulk preparation

Select multiple records on the current page. Bulk preparation is enabled only when at least two records share the same exact historical Error Type label. It can apply Assigned person, start date and the common procedure. It does not apply Judge, comments or KM decisions. Verify record-specific evidence separately.

## Daily G-CATS update

Upload the latest compatible Error Check Log workbook on **Daily G-CATS Update**. Inspect the detected sheet/header, row count, AO–AW coverage, row warnings, new/refresh/same-snapshot counts and historical Error Type distribution. Commit after review.

The importer targets `G-CATS Error Log Master Data`. The preferred identity is `code`; repeating `No.` is never used as an identity. No-code rows receive a conservative source fallback based on file hash + sheet + row. Each batch is retained as a snapshot. Missing rows are not deleted. Website edits override only the fields explicitly changed in the website; other fields can be refreshed from later G-CATS downloads.

The browser can optionally watch a local/OneDrive-synced workbook for changes while the tab is open. This requires browser permission and is not a background service. Every detected update requires preview and manual commit. Excel export is a read-only report copy; direct workbook write-back is not implemented.

## Historical procedure suggestions

The record detail page queries prior records by exact Error Type, then independently searches same part, same supplier and same CAS context. It ranks similar procedures and displays counts. Use the suggestion as a starting point only; confirm source version, destination, evidence, and actual current case conditions.

## Evidence & tasks

Open Evidence & Tasks from the current record. The selected case is carried into the page. Create a task for Drawing mass/tolerance, SMS-BR, New SMS/destination, supplier confirmation or TMA/TMC escalation. Upload evidence to private storage and record PDF page, sheet, or row provenance.

## Supplier pre-check

Supplier users can enter Supplier Code, Part Number, IMDS ID/version, MDS status and preliminary status manually, or upload XLSX/CSV. The preview maps recognized headers into editable fields. Submit the pre-check for internal review. A self-reported status is not proof that the original MDS is final or internally released.

The supplied MDS Report PDF says parsing is not allowed. PDF upload is therefore an attachment for manual review only. It is not parsed. An authorized reviewer must check the original MDS in IMDS; only reviewer/admin can clear the pre-check after the explicit human confirmation and required values are present.

## Supplier follow-up and Outlook

Internal users select a supplier PIC from the contact database. The notification record becomes visible in that supplier's portal account and an editable Outlook compose draft opens. Review the message and send it yourself. The platform does not send email automatically or report a sent status.

## Substance Intelligence and Rule Library

CAS lookup joins packaged GADSL and TSZ reference data. The result is a reference aid. It does not decide Toyota policy or the substance family flow by itself. The Rule Library shows source coverage and current activation boundaries.

## Roles

- `viewer`: view permitted internal data.
- `supplier`: own supplier pre-checks and own portal follow-ups only.
- `preparer`: import, edit operator fields, create evidence/tasks, prepare follow-up and review supplier pre-check input.
- `reviewer`: operator fields plus TMA KM review and supplier pre-check clearance.
- `admin`: configuration and all permitted internal review tasks.
- `rule_author` / `rule_approver`: governance roles reserved for rule lifecycle operations.

## Local preview vs persistent mode

Without Supabase credentials, the app has limited local preview only. Supabase enables accounts, persistent register, import batches, supplier workflows, audit events, private evidence storage and role enforcement.
