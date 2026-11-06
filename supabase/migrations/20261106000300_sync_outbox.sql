-- Power Automate bridge: durable outbox for Excel master updates and supplier e-mails.
-- Additive only. Nothing here is marked "sent" until the flow answered 2xx.
create table if not exists public.sync_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('EXCEL_UPSERT','SUPPLIER_EMAIL')),
  item_id uuid references public.gcat_error_items(id) on delete set null,
  followup_id uuid references public.supplier_followups(id) on delete set null,
  status text not null default 'PENDING' check (status in ('PENDING','SENDING','SENT','FAILED')),
  attempts integer not null default 0,
  last_error text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists sync_outbox_status_idx on public.sync_outbox(status, created_at);
create index if not exists sync_outbox_item_idx on public.sync_outbox(item_id);
create trigger sync_outbox_updated_at before update on public.sync_outbox for each row execute procedure public.set_updated_at();

alter table public.sync_outbox enable row level security;
create policy "sync_outbox_read_internal" on public.sync_outbox for select to authenticated
using (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
create policy "sync_outbox_insert_internal" on public.sync_outbox for insert to authenticated
with check (created_by = auth.uid() and public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
create policy "sync_outbox_update_internal" on public.sync_outbox for update to authenticated
using (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]))
with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
