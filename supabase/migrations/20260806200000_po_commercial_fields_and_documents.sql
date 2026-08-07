-- Commercial fields on purchase orders (Shopify-parity cost rollup)
alter table public.purchase_orders
  add column if not exists payment_terms text,
  add column if not exists reference_number text,
  add column if not exists tax_amount numeric(12,2) not null default 0,
  add column if not exists shipping_amount numeric(12,2) not null default 0,
  add column if not exists adjustment_amount numeric(12,2) not null default 0;

-- Document kind for PDF vs uploads
alter table public.po_documents
  add column if not exists kind text not null default 'upload';

do $$ begin
  alter table public.po_documents
    add constraint po_documents_kind_check
    check (kind in ('po_pdf', 'upload', 'invoice', 'packing_slip', 'other'));
exception when duplicate_object then null;
end $$;

-- Storage bucket for PO documents (service role uploads from embedded app)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'po-documents',
  'po-documents',
  false,
  52428800,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/csv',
    'text/plain'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "po_documents_storage_select" on storage.objects;
create policy "po_documents_storage_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'po-documents');

drop policy if exists "po_documents_storage_insert" on storage.objects;
create policy "po_documents_storage_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'po-documents');

drop policy if exists "po_documents_storage_update" on storage.objects;
create policy "po_documents_storage_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'po-documents')
  with check (bucket_id = 'po-documents');

drop policy if exists "po_documents_storage_delete" on storage.objects;
create policy "po_documents_storage_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'po-documents');
