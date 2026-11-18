-- Re-key G-CATS rows that were imported without a TMA `code`.
--
-- Why: the `code` column is filled only after TMA judges a case. The import used to give uncoded rows a key
-- `fallback:<file hash>:<sheet>:<row>`, which changed with every daily export. Judgements on those rows were
-- lost on the next import, and the Power Automate Excel flow could not find them.
-- Every coded row follows the same rule: code = Download Date (YYYYMMDD) || No. padded to 3 digits
-- (4,841 of 4,841 rows checked 2026-11-19). From now on the import keys uncoded rows the same way
-- (lib/judgement/source-key.ts), and this migration moves the existing fallback rows to that key once.
--
-- Safe to run more than once. It changes only source_record_key / source_case_code.
-- Rows are skipped when:
--   - the derived key already exists, or
--   - Download Date + No. cannot be read.
-- When several fallback rows (the same G-CATS row imported from several files) map to one key, the row that
-- has an internal judgement wins (then the most recently updated one). The others keep their fallback key.
-- They are not deleted.

create or replace function public.gcat_derived_code(raw jsonb)
returns text language plpgsql immutable as $$
declare d text; n text; dt date; num int; m text[];
begin
  select value #>> '{}' into d from jsonb_each(raw) where key ~* '^download date \[col [0-9]+\]$' limit 1;
  select value #>> '{}' into n from jsonb_each(raw) where key ~* '^no\.? \[col [0-9]+\]$' limit 1;
  if d is null or n is null then return null; end if;
  m := regexp_match(d, '^\s*([0-9]{4})[-/.]([0-9]{1,2})[-/.]([0-9]{1,2})');
  if m is not null then
    dt := make_date(m[1]::int, m[2]::int, m[3]::int);
  elsif d ~ '^[0-9]+(\.[0-9]+)?$' and d::numeric between 20000 and 80000 then
    dt := date '1899-12-30' + floor(d::numeric)::int;
  else
    return null;
  end if;
  if n !~ '^\s*[0-9]+(\.0+)?\s*$' then return null; end if;
  num := floor(trim(n)::numeric)::int;
  if num < 1 or num > 999 then return null; end if;
  return to_char(dt, 'YYYYMMDD') || lpad(num::text, 3, '0');
exception when others then
  return null;
end $$;

do $$
declare v_items int := 0; v_cases int := 0;
begin
  -- Same bypass the import RPC uses: this is a key change, not a judgement edit.
  perform set_config('app.gcat_import_batch', 'rekey-uncoded-rows', true);

  create temporary table rekey_plan on commit drop as
  with cand as (
    select i.id, i.case_id, i.source_record_key as old_key, 'code:' || public.gcat_derived_code(i.raw_source) as new_key,
           row_number() over (partition by public.gcat_derived_code(i.raw_source)
                              order by (i.judge is not null) desc, i.updated_at desc nulls last, i.created_at desc) as rn
    from public.gcat_error_items i
    where i.source_record_key like 'fallback:%' and public.gcat_derived_code(i.raw_source) is not null
  )
  select c.* from cand c
  where c.rn = 1 and not exists (select 1 from public.gcat_error_items x where x.source_record_key = c.new_key);

  update public.gcat_error_items i set source_record_key = p.new_key from rekey_plan p where i.id = p.id;
  get diagnostics v_items = row_count;

  update public.gcat_cases c set source_case_code = p.new_key
  from rekey_plan p
  where c.id = p.case_id and c.source_case_code = p.old_key
    and not exists (select 1 from public.gcat_cases x where x.source_case_code = p.new_key);
  get diagnostics v_cases = row_count;

  insert into public.audit_events(actor_id, action, entity_type, entity_id, metadata)
  values (null, 'GCAT_UNCODED_ROWS_REKEYED', 'gcat_error_item', null,
          jsonb_build_object('items', v_items, 'cases', v_cases, 'rule', 'Download Date YYYYMMDD || No. padded to 3', 'migration', '20261119000000'));
  raise notice 'Re-keyed % item(s) and % case(s).', v_items, v_cases;
end $$;
