-- Judgement memory ("the system remembers") and auto-judgement settings.
-- Additive only: one new table and, when the settings table exists, one more allowed settings key.
-- Nothing is deleted or rewritten.

-- 1) Answers Toyota already gave once (vehicle destination, tolerance class from the drawing,
--    Toyota-owned flow answers). Keyed per delivery part number so the next identical case is
--    not asked again. Every value keeps who/what set it and when.
create table if not exists public.judgement_memory (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('part')),
  scope_key text not null check (char_length(scope_key) between 1 and 80),
  field text not null check (field ~ '^[A-Za-z0-9]{1,24}$'),
  value text not null check (char_length(value) between 1 and 16),
  source text not null default 'reviewer' check (source in ('reviewer','import','system')),
  set_by uuid references auth.users(id),
  set_by_name text,
  source_item_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope, scope_key, field)
);
create index if not exists judgement_memory_key_idx on public.judgement_memory(scope, scope_key);

alter table public.judgement_memory enable row level security;
grant select, insert, update on public.judgement_memory to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='judgement_memory' and policyname='judgement_memory_read') then
    create policy judgement_memory_read on public.judgement_memory for select to authenticated
      using (public.has_any_role(array['admin','preparer','reviewer','viewer','rule_author','rule_approver']::public.app_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='judgement_memory' and policyname='judgement_memory_insert') then
    create policy judgement_memory_insert on public.judgement_memory for insert to authenticated
      with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='judgement_memory' and policyname='judgement_memory_update') then
    create policy judgement_memory_update on public.judgement_memory for update to authenticated
      using (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]))
      with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
  end if;
end $$;

-- 2) Auto-judgement settings live in imds_tracker_settings under the key 'autojudge_config'.
--    Widen the allowed keys only if that table already exists (migration 20261110000000).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='imds_tracker_settings') then
    alter table public.imds_tracker_settings drop constraint if exists imds_tracker_settings_key_check;
    alter table public.imds_tracker_settings add constraint imds_tracker_settings_key_check
      check (key in ('directory','followup_config','autojudge_config'));
  end if;
end $$;
