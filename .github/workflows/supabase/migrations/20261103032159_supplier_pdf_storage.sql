-- MDS Report PDFs are allowed as private attachments only; application code rejects PDF parsing.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv'
]
where id = 'supplier-precheck-private';
