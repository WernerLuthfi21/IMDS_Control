# SharePoint master workbook — what exists and what is still needed

## Implemented (read-only, NOT yet verified against a real tenant)
- `lib/sharepoint/graph.ts`: Microsoft Graph client-credentials flow, resolves ONE site + ONE workbook path, reads file info and downloads the file.
- `GET /api/sharepoint/status` (admin/preparer/reviewer): shows whether the six variables below are set, and whether the file is reachable. Never returns secrets.
- `POST /api/sharepoint/stage` (admin/preparer): downloads the workbook server-side into the private `import-staging` bucket and writes an audit event. The existing **preview → compare → human commit** flow continues from that path.
- Daily G-CATS Update page: "Fetch latest from SharePoint" and "Check connection".

## Not implemented (do not claim these)
- **Write-back of AO–AW to the Excel file.** Graph range update works only on behalf of a signed-in Microsoft user (delegated `Files.ReadWrite`), so it needs OAuth sign-in, token storage, an approval step with a diff, backup/versioning, audit logging and concurrency checks.
- **Push-based real time (Graph change notifications).** Needs a public webhook endpoint, subscription renewal, and a server-side database writer. Today, "latest" means: press the button (or add a scheduled call later).
- Automatic commit. Commit stays a human action.

## What you need to do once (Microsoft 365 / Entra admin)
1. Entra admin center → App registrations → New registration (single tenant). Note **Tenant ID** and **Client ID**.
2. Certificates & secrets → New client secret → copy the **value** into Vercel (never into git or chat).
3. API permissions → Microsoft Graph → **Application** permission `Sites.Selected` → Grant admin consent. Then grant the app **read** on the one site (Graph: `POST /sites/{site-id}/permissions`, role `read`). `Files.Read.All` also works but is broader.
4. Vercel → Project → Settings → Environment Variables (Production), then redeploy:
   `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `SHAREPOINT_SITE_HOSTNAME` (e.g. `contoso.sharepoint.com`), `SHAREPOINT_SITE_PATH` (e.g. `sites/IMDS`), `SHAREPOINT_MASTER_FILE_PATH` (path inside the default document library).
5. Open Daily G-CATS Update → **Check connection**.

Classification: the workbook must be PROTECTED/INTERNAL/PUBLIC and authorised for this private environment. CONFIDENTIAL or UNKNOWN is blocked before download.
