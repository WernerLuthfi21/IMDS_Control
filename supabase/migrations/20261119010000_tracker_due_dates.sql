-- Allow the Tracker to share due dates (per model, and per supplier × model) through imds_tracker_settings.
-- Additive: widens the key check only. Safe to run more than once.
alter table public.imds_tracker_settings drop constraint if exists imds_tracker_settings_key_check;
alter table public.imds_tracker_settings add constraint imds_tracker_settings_key_check check (key in ('directory','followup_config','due_dates'));
