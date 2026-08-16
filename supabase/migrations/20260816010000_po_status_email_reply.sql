-- Activity-only event for inbound supplier emails. Never a purchase_orders.status.
alter type public.po_status add value if not exists 'email_reply';
