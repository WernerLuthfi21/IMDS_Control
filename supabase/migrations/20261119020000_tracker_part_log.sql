-- Tracker Check tab and Stop run log: stored in imds_tracker_settings under key "part_log"
-- (written only by /api/imds-master/part-ops, read by the Tracker).
-- Additive: widens the key check only. Safe to run more than once, and it also covers 20261119010000 (due_dates).
alter table public.imds_tracker_settings drop constraint if exists imds_tracker_settings_key_check;
alter table public.imds_tracker_settings add constraint imds_tracker_settings_key_check
  check (key in ('directory','followup_config','autojudge_config','due_dates','part_log'));
