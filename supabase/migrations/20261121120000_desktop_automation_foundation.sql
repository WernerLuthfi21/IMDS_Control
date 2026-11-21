-- Desktop automation platform foundation.
-- Agent credentials and all agent mutations are server-only; authenticated users receive read access via RLS.
create table if not exists public.automation_devices (
  id uuid primary key default gen_random_uuid(),
  device_key text not null unique,
  display_name text not null,
  hostname text not null,
  os_name text not null default 'Windows',
  os_version text,
  architecture text,
  agent_version text,
  status text not null default 'PENDING'
    check (status in ('PENDING','ACTIVE','PAUSED','REVOKED','OFFLINE')),
  last_seen_at timestamptz,
  enrolled_by uuid references auth.users(id),
  enrolled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists automation_devices_status_seen_idx
  on public.automation_devices(status, last_seen_at desc);

-- Credential hashes are isolated from all browser-readable tables.
create table if not exists public.automation_agent_credentials (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null unique references public.automation_devices(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.automation_user_sessions (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.automation_devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  windows_sid text not null,
  windows_session_id integer not null,
  windows_username text,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','LOCKED','DISCONNECTED','LOGGED_OUT','UNKNOWN')),
  is_interactive boolean not null default true,
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(device_id, windows_sid, windows_session_id)
);
create index if not exists automation_sessions_user_idx
  on public.automation_user_sessions(user_id, last_seen_at desc);
create index if not exists automation_sessions_device_idx
  on public.automation_user_sessions(device_id, status, last_seen_at desc);

create table if not exists public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null default gen_random_uuid(),
  idempotency_key text not null unique,
  job_type text not null check (job_type in ('NEW_SMS_LOOKUP','SMS_BR_DRAWING_LOOKUP','IMDS_JUDGEMENT_CHECK')),
  trigger_type text not null check (trigger_type in ('MANUAL','SCHEDULED','RULE')),
  status text not null default 'QUEUED'
    check (status in ('CREATED','QUEUED','ASSIGNED','WAITING_FOR_SESSION','WAITING_FOR_DESKTOP','RUNNING','NEEDS_REVIEW','COMPLETED','FAILED','CANCELLED')),
  priority smallint not null default 100 check (priority between 0 and 1000),
  part_number text not null,
  requested_by uuid not null references auth.users(id),
  assigned_device_id uuid references public.automation_devices(id),
  assigned_session_id uuid references public.automation_user_sessions(id),
  assigned_user_id uuid references auth.users(id),
  input_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb,
  error_code text,
  error_message text,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists automation_jobs_queue_idx
  on public.automation_jobs(status, priority, created_at)
  where status in ('CREATED','QUEUED','WAITING_FOR_SESSION','WAITING_FOR_DESKTOP');
create index if not exists automation_jobs_requester_idx
  on public.automation_jobs(requested_by, created_at desc);
create index if not exists automation_jobs_trace_idx on public.automation_jobs(trace_id);

create table if not exists public.automation_job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.automation_jobs(id) on delete cascade,
  attempt_no integer not null check (attempt_no > 0),
  device_id uuid references public.automation_devices(id),
  session_id uuid references public.automation_user_sessions(id),
  agent_version text,
  workflow_version text,
  status text not null check (status in ('RUNNING','SUCCEEDED','FAILED','ABORTED','NEEDS_REVIEW')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result_checksum text,
  error_code text,
  error_message text,
  unique(job_id, attempt_no)
);
create index if not exists automation_attempts_job_idx
  on public.automation_job_attempts(job_id, attempt_no desc);

-- Append-only execution events; do not store passwords, tokens, PDF passwords or document contents here.
create table if not exists public.automation_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.automation_jobs(id) on delete cascade,
  attempt_id uuid references public.automation_job_attempts(id) on delete set null,
  trace_id uuid not null,
  event_type text not null,
  event_at timestamptz not null default now(),
  actor_user_id uuid references auth.users(id),
  device_id uuid references public.automation_devices(id),
  session_id uuid references public.automation_user_sessions(id),
  details jsonb not null default '{}'::jsonb,
  previous_event_hash text,
  event_hash text
);
create index if not exists automation_events_job_idx
  on public.automation_job_events(job_id, event_at, id);

create table if not exists public.automation_desktop_locks (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.automation_devices(id) on delete cascade,
  job_id uuid not null references public.automation_jobs(id) on delete cascade,
  session_id uuid not null references public.automation_user_sessions(id) on delete cascade,
  acquired_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  released_at timestamptz
);
create unique index if not exists automation_one_active_desktop_lock_per_device
  on public.automation_desktop_locks(device_id) where released_at is null;

create trigger automation_devices_updated_at before update on public.automation_devices
  for each row execute procedure public.set_updated_at();
create trigger automation_sessions_updated_at before update on public.automation_user_sessions
  for each row execute procedure public.set_updated_at();
create trigger automation_jobs_updated_at before update on public.automation_jobs
  for each row execute procedure public.set_updated_at();

alter table public.automation_devices enable row level security;
alter table public.automation_agent_credentials enable row level security;
alter table public.automation_user_sessions enable row level security;
alter table public.automation_jobs enable row level security;
alter table public.automation_job_attempts enable row level security;
alter table public.automation_job_events enable row level security;
alter table public.automation_desktop_locks enable row level security;

-- The UI is read-only in this foundation migration. All writes are performed by trusted server routes
-- using a server-only service credential after validating the user's session or the agent's device credential.
create policy automation_devices_read_internal on public.automation_devices
  for select to authenticated
  using (public.has_any_role(array['admin','preparer','reviewer','viewer','rule_author','rule_approver']::public.app_role[]));

create policy automation_sessions_read_internal on public.automation_user_sessions
  for select to authenticated
  using (
    public.has_any_role(array['admin','preparer','reviewer','viewer','rule_author','rule_approver']::public.app_role[])
    and (
      user_id = auth.uid()
      or public.has_any_role(array['admin','preparer','reviewer','viewer','rule_author','rule_approver']::public.app_role[])
    )
  );

create policy automation_jobs_read_internal on public.automation_jobs
  for select to authenticated
  using (
    requested_by = auth.uid()
    or assigned_user_id = auth.uid()
    or public.has_any_role(array['admin','preparer','reviewer','viewer','rule_author','rule_approver']::public.app_role[])
  );

create policy automation_attempts_read_internal on public.automation_job_attempts
  for select to authenticated
  using (exists (
    select 1 from public.automation_jobs j
    where j.id = job_id
      and (j.requested_by = auth.uid() or j.assigned_user_id = auth.uid()
        or public.has_any_role(array['admin','preparer','reviewer','viewer','rule_author','rule_approver']::public.app_role[]))
  ));

create policy automation_events_read_internal on public.automation_job_events
  for select to authenticated
  using (exists (
    select 1 from public.automation_jobs j
    where j.id = job_id
      and (j.requested_by = auth.uid() or j.assigned_user_id = auth.uid()
        or public.has_any_role(array['admin','preparer','reviewer','viewer','rule_author','rule_approver']::public.app_role[]))
  ));

create policy automation_locks_read_internal on public.automation_desktop_locks
  for select to authenticated
  using (public.has_any_role(array['admin','preparer','reviewer','viewer','rule_author','rule_approver']::public.app_role[]));

-- No SELECT policy is intentionally defined for automation_agent_credentials.
