-- Standard attachments for supplier e-mails (Follow-up → files library), stored in imds_tracker_settings under key
-- "attachment_library" (written only by /api/imds-master/attachments; files are kept byte for byte).
-- Additive: widens the key check only. Safe to run more than once; it also covers the earlier keys.
alter table public.imds_tracker_settings drop constraint if exists imds_tracker_settings_key_check;
alter table public.imds_tracker_settings add constraint imds_tracker_settings_key_check
  check (key in ('directory','followup_config','autojudge_config','due_dates','part_log','attachment_library'));
