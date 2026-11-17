-- TMC / TMNA / TME / TDEM escalations for cases the Appendix II flows send to Toyota regional offices.
-- Status NEED -> SENT -> CONFIRMED (with the answer). Additive only.
create table if not exists public.judgement_escalations (
  id uuid primary key default gen_random_uuid(),
  case_key text not null unique check (char_length(case_key) between 3 and 300),
  item_id uuid,
  part_no text,
  error_type text,
  cas text,
  flow_id text,
  status text not null default 'NEED' check (status in ('NEED','SENT','CONFIRMED')),
  answer text check (answer in ('OK','NG')),
  note text check (char_length(note) <= 1000),
  sent_at timestamptz,
  answered_at timestamptz,
  updated_by uuid references auth.users(id),
  updated_by_name text,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'CONFIRMED' or answer is not null)
);
create index if not exists judgement_escalations_status_idx on public.judgement_escalations(status);

alter table public.judgement_escalations enable row level security;
grant select, insert, update on public.judgement_escalations to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='judgement_escalations' and policyname='judgement_escalations_read') then
    create policy judgement_escalations_read on public.judgement_escalations for select to authenticated
      using (public.has_any_role(array['admin','preparer','reviewer','viewer','rule_author','rule_approver']::public.app_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='judgement_escalations' and policyname='judgement_escalations_insert') then
    create policy judgement_escalations_insert on public.judgement_escalations for insert to authenticated
      with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='judgement_escalations' and policyname='judgement_escalations_update') then
    create policy judgement_escalations_update on public.judgement_escalations for update to authenticated
      using (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]))
      with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
  end if;
end $$;
