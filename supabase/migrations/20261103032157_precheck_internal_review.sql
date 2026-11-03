-- Internal review lifecycle for supplier-side IMDS pre-check submissions.
-- A system suggestion is never equivalent to a human clearance decision.
alter table public.supplier_prechecks
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_comment text,
  add column if not exists source_verified_by_human boolean not null default false;

create index if not exists supplier_prechecks_status_idx
  on public.supplier_prechecks(workflow_status, created_at desc);

-- Reviewer/admin must explicitly confirm that original source evidence was checked
-- before changing a submission to CLEARED_FOR_IMDS.
create or replace function public.guard_supplier_precheck_review()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_role public.app_role;
begin
  select role into v_role from public.profiles where id=auth.uid();
  if new.workflow_status is distinct from old.workflow_status then
    if coalesce(v_role,'viewer') not in ('admin','preparer','reviewer') then
      raise exception 'Internal role is required to change supplier pre-check status';
    end if;
    if new.workflow_status='CLEARED_FOR_IMDS' then
      if coalesce(v_role,'viewer') not in ('admin','reviewer') then
        raise exception 'Only reviewer/admin can clear a supplier pre-check for IMDS';
      end if;
      if not new.source_verified_by_human then
        raise exception 'Original MDS source must be verified by a human reviewer';
      end if;
      if nullif(trim(coalesce(new.review_comment,'')),'') is null then
        raise exception 'Review comment is required for IMDS clearance';
      end if;
      if nullif(trim(coalesce(new.mds_id,'')),'') is null or nullif(trim(coalesce(new.mds_version,'')),'') is null then
        raise exception 'IMDS ID and Version are required for clearance';
      end if;
      if lower(coalesce(new.mds_status,'')) not like '%internally released%' or new.preliminary_mds is distinct from false then
        raise exception 'Only internally released, non-preliminary MDS may be cleared';
      end if;
    end if;
    new.reviewed_by:=auth.uid();
    new.reviewed_at:=now();
  end if;
  return new;
end;
$$;

drop trigger if exists guard_supplier_precheck_review on public.supplier_prechecks;
create trigger guard_supplier_precheck_review
before update on public.supplier_prechecks
for each row execute procedure public.guard_supplier_precheck_review();

-- Reviewers can create a follow-up, but only internal users can insert follow-up records.
drop policy if exists followups_write_internal on public.supplier_followups;
create policy followups_insert_internal on public.supplier_followups
for insert to authenticated
with check (
  created_by=auth.uid() and
  public.has_any_role(array['admin','preparer','reviewer']::public.app_role[])
);
