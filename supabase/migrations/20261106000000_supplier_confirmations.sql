-- Supplier self-check confirmations, saved per delivery part number so TMMIN does not have to ask again.
-- Append-only: no UPDATE or DELETE is granted, so history is never lost. The newest row wins when it is read.
create table if not exists public.supplier_confirmations (
  id uuid primary key default gen_random_uuid(),
  supplier_code text not null,
  delivery_part_no text not null,
  part_key text not null,
  family text not null check (family in ('substance','pb','mass')),
  cas text not null default '',
  flow_id text,
  flow_title text,
  error_type text,
  answers jsonb not null default '{}'::jsonb,
  result_state text,
  result_comment text,
  source text not null default 'SUPPLIER_SELF_CHECK',
  source_file_name text,
  submitted_by uuid not null references auth.users(id),
  submitted_at timestamptz not null default now()
);
create index if not exists supplier_confirmations_lookup_idx on public.supplier_confirmations(part_key, family, cas, submitted_at desc);
create index if not exists supplier_confirmations_supplier_idx on public.supplier_confirmations(supplier_code, submitted_at desc);

alter table public.supplier_confirmations enable row level security;

create policy "supplier_confirmations_insert_own" on public.supplier_confirmations for insert to authenticated
with check (
  submitted_by = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'supplier' and p.supplier_code is not null and upper(p.supplier_code) = upper(supplier_confirmations.supplier_code))
);
create policy "supplier_confirmations_select_own" on public.supplier_confirmations for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'supplier' and upper(p.supplier_code) = upper(supplier_confirmations.supplier_code)));
create policy "supplier_confirmations_select_internal" on public.supplier_confirmations for select to authenticated
using (public.has_any_role(array['admin','preparer','reviewer','viewer','rule_author','rule_approver']::public.app_role[]));

revoke all on public.supplier_confirmations from anon, public;
grant select, insert on public.supplier_confirmations to authenticated;
