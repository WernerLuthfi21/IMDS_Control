# Restore application source

A single source-only archive is required to populate this private repository.

1. Download `IMDS_Control_source.tar.gz` from the conversation.
2. In this repository, open **Add file → Upload files**.
3. Create the folder path `bootstrap` in the upload area if needed, then upload the archive as `bootstrap/IMDS_Control_source.tar.gz`.
4. Commit directly to `main`.

The GitHub Actions workflow `.github/workflows/restore-source.yml` extracts the archive into the repository root, commits the application source, and runs dependency installation, typecheck, lint, unit tests, production build, and E2E checks.

The archive contains application source and reference JSON only. It excludes original Excel workbooks, PDFs, DOCX files, local secrets, and environment files.
