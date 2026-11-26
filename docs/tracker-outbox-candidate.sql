-- REVIEW CANDIDATE ONLY. Not a migration, not applied. Reconcile linked migration history first.
-- Run against an isolated PostgreSQL/Supabase fixture and test RLS/concurrency before promotion.
begin;
create table public.tracker_communication_runs (
 id uuid primary key default gen_random_uuid(),
 automation_id text not null,
 intended_slot timestamptz not null,
 config_version text not null,
 snapshot_id text not null,
 created_at timestamptz not null default now(),
 unique(automation_id,intended_slot)
);
create table public.tracker_communication_jobs (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references public.tracker_communication_runs(id),
 supplier_key text not null,
 contact_key text not null,
 channel text not null check(channel in ('email','whatsapp')),
 purpose text not null,
 template_version text not null,
 payload_hash text not null,
 payload jsonb not null,
 idempotency_key text not null unique,
 status text not null default 'DRAFT' check(status in ('DRAFT','APPROVED','QUEUED','PROCESSING','HANDED_OFF','PROVIDER_ACCEPTED','SENT','DELIVERED','READ','FAILED','UNKNOWN','CANCELLED','EXPIRED')),
 approved_at timestamptz,
 approved_by uuid references auth.users(id),
 scheduled_at timestamptz not null,
 expires_at timestamptz not null check(expires_at>scheduled_at),
 attempts integer not null default 0 check(attempts>=0),
 lease_token uuid,
 lease_expires_at timestamptz,
 provider_message_id text,
 updated_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 unique(run_id,supplier_key,contact_key,channel,purpose)
);
create index tracker_communication_ready_idx on public.tracker_communication_jobs(scheduled_at,id) where status='QUEUED';
create table public.tracker_communication_events (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.tracker_communication_jobs(id),
 event_key text not null unique,
 state text not null,
 created_at timestamptz not null default now()
);
alter table public.tracker_communication_runs enable row level security;
alter table public.tracker_communication_jobs enable row level security;
alter table public.tracker_communication_events enable row level security;
revoke all on public.tracker_communication_runs,public.tracker_communication_jobs,public.tracker_communication_events from public,anon,authenticated;
grant select,insert,update on public.tracker_communication_runs,public.tracker_communication_jobs to service_role;
grant select,insert on public.tracker_communication_events to service_role;
-- Claim exactly one eligible approved job. Revalidate live recipient eligibility and policy outside this RPC before dispatch.
create function public.tracker_claim_communication_job()
returns setof public.tracker_communication_jobs language sql security invoker set search_path='' as $$
 with candidate as (
  select id from public.tracker_communication_jobs
  where status='QUEUED' and approved_at is not null and approved_by is not null
    and scheduled_at<=now() and expires_at>now()
  order by scheduled_at,id for update skip locked limit 1
 )
 update public.tracker_communication_jobs j
 set status='PROCESSING',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',updated_at=now()
 from candidate c where j.id=c.id returning j.*;
$$;
revoke all on function public.tracker_claim_communication_job() from public,anon,authenticated;
grant execute on function public.tracker_claim_communication_job() to service_role;
-- Fence result writes using claim token; atomically persist event. A stale worker cannot overwrite recovery.
create function public.tracker_finish_communication_job(p_job uuid,p_token uuid,p_state text,p_provider_id text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_state not in ('HANDED_OFF','PROVIDER_ACCEPTED','FAILED','UNKNOWN') then raise exception 'invalid outcome'; end if;
 update public.tracker_communication_jobs set status=p_state,provider_message_id=p_provider_id,lease_expires_at=null,lease_token=null,updated_at=now()
 where id=p_job and status='PROCESSING' and lease_token=p_token and lease_expires_at>now();
 if not found then return false; end if;
 insert into public.tracker_communication_events(job_id,event_key,state) values(p_job,p_token::text,p_state);
 return true;
end;$$;
revoke all on function public.tracker_finish_communication_job(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.tracker_finish_communication_job(uuid,uuid,text,text) to service_role;
-- Crash recovery: never retry a potentially dispatched job. Expired queued jobs expire instead of sending late.
create function public.tracker_recover_communication_jobs()
returns void language sql security invoker set search_path='' as $$
 with recovered as (
 update public.tracker_communication_jobs set status='UNKNOWN',lease_token=null,lease_expires_at=null,updated_at=now()
 where status='PROCESSING' and lease_expires_at<=now() returning id
 )
 insert into public.tracker_communication_events(job_id,event_key,state)
 select id,gen_random_uuid()::text,'UNKNOWN' from recovered;
 update public.tracker_communication_jobs set status='EXPIRED',updated_at=now() where status='QUEUED' and expires_at<=now();
$$;
revoke all on function public.tracker_recover_communication_jobs() from public,anon,authenticated;
grant execute on function public.tracker_recover_communication_jobs() to service_role;
commit;
