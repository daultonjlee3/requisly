-- One-click confirm for parsed PO email replies. Nothing is written until redeem.
alter table public.supplier_one_click_tokens
  drop constraint if exists supplier_one_click_tokens_action_check;

alter table public.supplier_one_click_tokens
  add constraint supplier_one_click_tokens_action_check
  check (action in ('confirm_as_is', 'mark_shipped', 'confirm_email_parse'));

alter table public.supplier_one_click_tokens
  add column if not exists payload jsonb;

comment on column public.supplier_one_click_tokens.payload is
  'Pending interpretation for confirm_email_parse. Applied only after the supplier clicks confirm.';
