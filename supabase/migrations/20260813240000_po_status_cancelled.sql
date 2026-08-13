-- Merchant-initiated cancel is distinct from supplier rejection.
alter type public.po_status add value if not exists 'cancelled';
