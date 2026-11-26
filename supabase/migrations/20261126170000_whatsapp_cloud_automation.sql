-- Additive WhatsApp Cloud API integration for IMDS Control Center.
-- Existing supplier, email, auth, sync_outbox and Power Automate data are not replaced.

alter table public.supplier_contacts
  add column if not exists whatsapp_phone_e164 text,
  add column if not exists whatsapp_opt_in boolean not null default false,
  add column if not exists whatsapp_opt_in_at timestamptz,
  add column if not exists whatsapp_opt_out_at timestamptz,
  add column if not exists whatsapp_consent_source text;

create index if not exists supplier_contacts_whatsapp_eligible_idx
  on public.supplier_contacts (active, whatsapp_opt_in)
  where whatsapp_opt_in = true and whatsapp_phone_e164 is not null;

create table if not exists public.whatsapp_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sender_key text not null,
  sender_label text not null,
  sender_phone text not null,
  template_name text not null,
  template_language text not null,
  body_parameter_templates jsonb not null default '[]'::jsonb,
  mode text not null check (mode in ('automatic','semi_automatic')),
  status text not null default 'DRAFT'
    check (status in ('DRAFT','AWAITING_APPROVAL','QUEUED','RUNNING','COMPLETED','PARTIAL','FAILED','CANCELLED')),
  total_count integer not null default 0,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_campaigns_created_idx
  on public.whatsapp_campaigns (created_at desc);
create index if not exists whatsapp_campaigns_status_idx
  on public.whatsapp_campaigns (status, created_at);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.whatsapp_campaigns(id) on delete cascade,
  supplier_contact_id uuid references public.supplier_contacts(id) on delete set null,
  supplier_code text,
  recipient_name text,
  recipient_phone text not null,
  sender_key text not null,
  template_name text not null,
  template_language text not null,
  template_parameters jsonb not null default '[]'::jsonb,
  status text not null default 'PENDING'
    check (status in ('AWAITING_APPROVAL','PENDING','SENDING','SENT','DELIVERED','READ','FAILED','CANCELLED')),
  attempts integer not null default 0,
  provider_message_id text unique,
  provider_status text,
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  last_status_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, supplier_contact_id)
);

create index if not exists whatsapp_messages_queue_idx
  on public.whatsapp_messages (status, created_at);
create index if not exists whatsapp_messages_campaign_idx
  on public.whatsapp_messages (campaign_id, status);
create index if not exists whatsapp_messages_provider_idx
  on public.whatsapp_messages (provider_message_id)
  where provider_message_id is not null;

drop trigger if exists whatsapp_campaigns_updated_at on public.whatsapp_campaigns;
create trigger whatsapp_campaigns_updated_at
  before update on public.whatsapp_campaigns
  for each row execute procedure public.set_updated_at();

drop trigger if exists whatsapp_messages_updated_at on public.whatsapp_messages;
create trigger whatsapp_messages_updated_at
  before update on public.whatsapp_messages
  for each row execute procedure public.set_updated_at();

alter table public.whatsapp_campaigns enable row level security;
alter table public.whatsapp_messages enable row level security;

grant select, insert, update on public.supplier_contacts to authenticated;
grant select, insert, update on public.whatsapp_campaigns to authenticated;
grant select, insert, update on public.whatsapp_messages to authenticated;

drop policy if exists whatsapp_campaigns_read_internal on public.whatsapp_campaigns;
create policy whatsapp_campaigns_read_internal
  on public.whatsapp_campaigns for select to authenticated
  using (public.has_any_role(array['admin','preparer','reviewer','viewer']::public.app_role[]));

drop policy if exists whatsapp_campaigns_insert_internal on public.whatsapp_campaigns;
create policy whatsapp_campaigns_insert_internal
  on public.whatsapp_campaigns for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.has_any_role(array['admin','preparer']::public.app_role[])
  );

drop policy if exists whatsapp_campaigns_update_internal on public.whatsapp_campaigns;
create policy whatsapp_campaigns_update_internal
  on public.whatsapp_campaigns for update to authenticated
  using (public.has_any_role(array['admin','preparer']::public.app_role[]))
  with check (public.has_any_role(array['admin','preparer']::public.app_role[]));

drop policy if exists whatsapp_messages_read_internal on public.whatsapp_messages;
create policy whatsapp_messages_read_internal
  on public.whatsapp_messages for select to authenticated
  using (public.has_any_role(array['admin','preparer','reviewer','viewer']::public.app_role[]));

drop policy if exists whatsapp_messages_insert_internal on public.whatsapp_messages;
create policy whatsapp_messages_insert_internal
  on public.whatsapp_messages for insert to authenticated
  with check (public.has_any_role(array['admin','preparer']::public.app_role[]));

drop policy if exists whatsapp_messages_update_internal on public.whatsapp_messages;
create policy whatsapp_messages_update_internal
  on public.whatsapp_messages for update to authenticated
  using (public.has_any_role(array['admin','preparer']::public.app_role[]))
  with check (public.has_any_role(array['admin','preparer']::public.app_role[]));

-- Existing supplier_contacts policies remain in force; new contact fields inherit the same internal role checks.
