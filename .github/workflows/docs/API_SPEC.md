# API overview

All persistent write routes use the authenticated Supabase session. The browser receives only publishable/anon credentials; PostgreSQL RLS and guarded functions enforce access.

| Method / route | Purpose | Access |
|---|---|---|
| `GET /api/reference?cas=` | CAS → GADSL / TSZ Appendix lookup | Local preview; authenticated when persistent mode is enabled |
| `POST /api/judgement/evaluate` | Run deterministic recommendation/trace and save run | `admin`, `preparer`, `reviewer` in persistent mode |
| `GET /api/register/suggestions` | Historical procedure suggestions by same Error Type, part, supplier and CAS contexts | Internal `admin`, `preparer`, `reviewer`, `viewer` |
| `PATCH /api/register/:id` | Edit AO–AW record fields with role guard and per-field override tracking | Internal preparer/reviewer/admin; KM fields reviewer/admin only |
| `POST /api/register/bulk` | Bulk Assigned person, starting date and procedure for same exact Error Type | `admin`, `preparer`, `reviewer`; max 100 records; no Judge/KM fields |
| `GET /api/register/export` | Export register as Excel report copy | Authenticated internal user |
| `POST /api/imports/create-upload` | Create signed upload URL in private import staging bucket | `admin` / `preparer` |
| `POST /api/imports/preview` | Parse staged Error Log workbook, compare source keys and create batch/snapshot rows | `admin` / `preparer`; own upload path only |
| `POST /api/imports/commit` | Call guarded `commit_import_batch` PostgreSQL function | `admin` / `preparer`; own staged batch |
| `GET /api/imports/history` | List recent import snapshots | Internal authenticated roles |
| `GET /api/tasks?caseId=` / `POST /api/tasks` | List / create case verification tasks | Authenticated read; internal write roles |
| `POST /api/evidence/prepare-upload` | Create signed private evidence upload URL | `admin` / `preparer` / `reviewer` |
| `POST /api/evidence/register` / `GET /api/evidence?caseId=` | Register/read evidence metadata and provenance | Authenticated internal access; storage private |
| `POST /api/prechecks/upload` | Create signed supplier attachment URL | Supplier for own profile, admin/preparer |
| `POST /api/prechecks/preview` | Extract mapped fields from XLSX/CSV; PDF parsing explicitly rejected | Supplier for own namespace, admin/preparer |
| `POST /api/prechecks` / `GET /api/prechecks` | Submit/read supplier readiness checks | Supplier own supplier code; internal review roles |
| `PATCH /api/prechecks/:id` | Internal review status transitions and human source verification | Internal preparer/reviewer/admin; only reviewer/admin can clear |
| `GET/POST /api/suppliers/contacts` | Read / add supplier PIC contacts | Internal roles; add requires admin/preparer |
| `GET/POST /api/followups` | Read portal-visible follow-ups / create in-app notification and Outlook draft record | Internal write; supplier reads own supplier-code records through RLS |
| `POST /api/approvals/finalize` | Finalize one approved judgement | `admin` / `reviewer` / `rule_approver` through database RPC |

No endpoint submits judgement data to the external G-CATS system. No API performs a final judgement automatically. Automatic Microsoft Graph email send and Excel/SharePoint write-back are not implemented.
