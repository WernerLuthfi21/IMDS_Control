-- Allow supplier confirmations for SMS Mass and Application44ERROR (No.24) as well.
alter table public.supplier_confirmations drop constraint if exists supplier_confirmations_family_check;
alter table public.supplier_confirmations add constraint supplier_confirmations_family_check check (family in ('substance','pb','mass','sms','app44'));
