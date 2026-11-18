-- Allow suppliers to pre-confirm a WARP Part number (Appendix I No.21) in the self-check:
-- "Is supplier code X the correct code for these parts?" Additive: widens the family check only.
alter table public.supplier_confirmations drop constraint if exists supplier_confirmations_family_check;
alter table public.supplier_confirmations add constraint supplier_confirmations_family_check check (family in ('substance','pb','mass','sms','app44','warp'));
