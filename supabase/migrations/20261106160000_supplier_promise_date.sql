alter table public.imds_master_parts
  add column if not exists supplier_promise_date date,
  add column if not exists supplier_promise_updated_at timestamptz;

create index if not exists imds_master_supplier_promise_idx
on public.imds_master_parts(supplier_promise_date)
where supplier_promise_date is not null;
