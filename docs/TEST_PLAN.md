# Test plan

## Automated unit tests

- CAS dash normalization and check-digit validation.
- GADSL 2026 V1.0 packaged reference row count.
- CAS lookup provenance response.
- Error Type 6 missing supplier response -> MANUAL REVIEW.
- Error Type 6 A/B branches and exact comments.
- Error Type 8 missing approved percentage basis -> MANUAL REVIEW.
- Prohibited substance family -> HOLD until specific flow and evidence are available.
- Numeric Error Type 19 always HOLD regardless of selected source context.
- Invalid mass input -> range calculation error rather than an invented value.

## Browser smoke tests

- Dashboard renders and displays the Type 19 governance hold.
- Substance Intelligence page renders.

## Required acceptance tests before production

1. Import the real, approved operational workbook to a test Supabase environment; compare source rows and counts with Excel.
2. Verify duplicate `Delivery Part No` columns retain positional identity and the intended operational column mapping with the data owner.
3. Test import idempotency by staging and committing the same file twice.
4. Test rollback behavior when one staged row violates a constraint; verify no partial batch is committed.
5. Test roles: viewer cannot import/create tasks/approve; preparer can import; reviewer can approve only an owner-approved rule; rule approver can approve rules.
6. Test all 23 source-listed Error Types against approved expected outcomes and all known source conflicts.
7. Validate every auto-calculated mass threshold against the controlled TSZ2900G revision and signed-off denominator/rounding method.
8. Validate every chemical rule with exact CAS, GADSL status, TSZ group, destination, material/use context and effective date.
9. Verify source-page/sheet/row traceability in exported case evidence.
10. Validate storage access isolation and classification controls using separate users.
11. Verify Vercel and self-host deployments, database backups, restore and key rotation.
12. Perform security review of RLS, signed URLs, SQL functions and audit events.

The acceptance tests require the Toyota process owner and data owner; they are not represented as already completed.
