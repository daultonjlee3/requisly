-- Quote Requests (RFQ): multi-supplier competitive quotes → award to draft POs.
-- Tokens mirror supplier_link_tokens (no-login). Award creates draft POs only
-- (golden workflow starts at draft — never skips to confirmed).

create table if not exists public.quote_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  status text not null default 'draft'
    check (status in (
      'draft', 'sent', 'partially_responded', 'responded', 'awarded', 'cancelled'
    )),
  notes text,
  needed_by date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  awarded_at timestamptz
);

create index if not exists quote_requests_workspace_idx
  on public.quote_requests (workspace_id, created_at desc);

create table if not exists public.quote_request_lines (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests(id) on delete cascade,
  supplier_product_id uuid references public.supplier_products(id) on delete set null,
  description text not null,
  sku text,
  is_free_text boolean not null default false,
  qty integer not null check (qty > 0),
  sort_order integer not null default 0,
  -- Set when this line is awarded to a responding supplier.
  awarded_quote_request_supplier_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists quote_request_lines_request_idx
  on public.quote_request_lines (quote_request_id, sort_order);

create table if not exists public.quote_request_suppliers (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  token text not null unique,
  status text not null default 'invited'
    check (status in ('invited', 'viewed', 'responded', 'declined')),
  invited_at timestamptz not null default now(),
  viewed_at timestamptz,
  responded_at timestamptz,
  -- Draft PO created when lines for this supplier are awarded.
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  unique (quote_request_id, supplier_id)
);

create index if not exists quote_request_suppliers_token_idx
  on public.quote_request_suppliers (token);

alter table public.quote_request_lines
  drop constraint if exists quote_request_lines_awarded_supplier_fkey;
alter table public.quote_request_lines
  add constraint quote_request_lines_awarded_supplier_fkey
  foreign key (awarded_quote_request_supplier_id)
  references public.quote_request_suppliers(id) on delete set null;

create table if not exists public.quote_request_responses (
  id uuid primary key default gen_random_uuid(),
  quote_request_supplier_id uuid not null
    references public.quote_request_suppliers(id) on delete cascade,
  quote_request_line_id uuid not null
    references public.quote_request_lines(id) on delete cascade,
  unit_cost numeric(12, 4) not null check (unit_cost >= 0),
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  notes text,
  source text not null default 'link'
    check (source in ('link', 'email')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quote_request_supplier_id, quote_request_line_id)
);

create index if not exists quote_request_responses_supplier_idx
  on public.quote_request_responses (quote_request_supplier_id);

comment on table public.quote_requests is
  'Merchant RFQ. Award creates draft POs (golden workflow) — never auto-confirms.';
comment on table public.quote_request_suppliers is
  'Per-supplier invite + no-login token (same pattern as supplier_link_tokens).';
comment on table public.quote_request_responses is
  'Per-line price + lead time from a supplier (link form or email reply parse).';

-- Public load by token (anon), mirrors supplier_link_get shape.
create or replace function public.quote_request_link_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qs public.quote_request_suppliers%rowtype;
  v_qr public.quote_requests%rowtype;
  v_supplier public.suppliers%rowtype;
  v_workspace public.workspaces%rowtype;
  v_lines jsonb;
  v_responses jsonb;
begin
  select * into v_qs from public.quote_request_suppliers where token = p_token;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;

  select * into v_qr from public.quote_requests where id = v_qs.quote_request_id;
  if not found or v_qr.status = 'cancelled' then
    return jsonb_build_object('error', 'closed');
  end if;

  select * into v_supplier from public.suppliers where id = v_qs.supplier_id;
  select * into v_workspace from public.workspaces where id = v_qr.workspace_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'description', l.description,
    'sku', l.sku,
    'qty', l.qty,
    'is_free_text', l.is_free_text,
    'sort_order', l.sort_order
  ) order by l.sort_order), '[]'::jsonb)
  into v_lines
  from public.quote_request_lines l
  where l.quote_request_id = v_qr.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'quote_request_line_id', r.quote_request_line_id,
    'unit_cost', r.unit_cost,
    'lead_time_days', r.lead_time_days,
    'notes', r.notes
  )), '[]'::jsonb)
  into v_responses
  from public.quote_request_responses r
  where r.quote_request_supplier_id = v_qs.id;

  -- Mark viewed
  if v_qs.status = 'invited' then
    update public.quote_request_suppliers
    set status = 'viewed', viewed_at = coalesce(viewed_at, now())
    where id = v_qs.id;
  end if;

  return jsonb_build_object(
    'quote_request', jsonb_build_object(
      'id', v_qr.id,
      'title', v_qr.title,
      'status', v_qr.status,
      'notes', v_qr.notes,
      'needed_by', v_qr.needed_by,
      'workspace_name', v_workspace.name
    ),
    'supplier', jsonb_build_object(
      'id', v_supplier.id,
      'name', v_supplier.name
    ),
    'quote_request_supplier_id', v_qs.id,
    'invite_status', v_qs.status,
    'lines', v_lines,
    'responses', v_responses,
    'can_respond', v_qr.status in ('sent', 'partially_responded', 'responded')
      and v_qr.status <> 'awarded'
      and v_qr.status <> 'cancelled'
  );
end;
$$;

create or replace function public.quote_request_link_submit(
  p_token text,
  p_responses jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qs public.quote_request_suppliers%rowtype;
  v_qr public.quote_requests%rowtype;
  v_item jsonb;
  v_line_id uuid;
  v_unit numeric;
  v_lead integer;
  v_notes text;
  v_responded_count integer;
  v_invited_count integer;
begin
  select * into v_qs from public.quote_request_suppliers where token = p_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_qr from public.quote_requests where id = v_qs.quote_request_id for update;
  if not found or v_qr.status in ('cancelled', 'awarded', 'draft') then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_responses, '[]'::jsonb))
  loop
    v_line_id := (v_item->>'quote_request_line_id')::uuid;
    v_unit := (v_item->>'unit_cost')::numeric;
    v_lead := nullif(v_item->>'lead_time_days', '')::integer;
    v_notes := nullif(v_item->>'notes', '');

    if v_line_id is null or v_unit is null or v_unit < 0 then
      continue;
    end if;

    if not exists (
      select 1 from public.quote_request_lines
      where id = v_line_id and quote_request_id = v_qr.id
    ) then
      continue;
    end if;

    insert into public.quote_request_responses (
      quote_request_supplier_id, quote_request_line_id,
      unit_cost, lead_time_days, notes, source, updated_at
    ) values (
      v_qs.id, v_line_id, v_unit, v_lead, v_notes, 'link', now()
    )
    on conflict (quote_request_supplier_id, quote_request_line_id)
    do update set
      unit_cost = excluded.unit_cost,
      lead_time_days = excluded.lead_time_days,
      notes = excluded.notes,
      source = 'link',
      updated_at = now();
  end loop;

  update public.quote_request_suppliers
  set status = 'responded', responded_at = now()
  where id = v_qs.id;

  select count(*) into v_invited_count
  from public.quote_request_suppliers where quote_request_id = v_qr.id;
  select count(*) into v_responded_count
  from public.quote_request_suppliers
  where quote_request_id = v_qr.id and status = 'responded';

  update public.quote_requests
  set status = case
    when v_responded_count >= v_invited_count then 'responded'
    when v_responded_count > 0 then 'partially_responded'
    else status
  end
  where id = v_qr.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.quote_request_link_get(text) from public;
revoke all on function public.quote_request_link_submit(text, jsonb) from public;
grant execute on function public.quote_request_link_get(text) to anon, authenticated, service_role;
grant execute on function public.quote_request_link_submit(text, jsonb) to anon, authenticated, service_role;

alter table public.quote_requests enable row level security;
alter table public.quote_request_lines enable row level security;
alter table public.quote_request_suppliers enable row level security;
alter table public.quote_request_responses enable row level security;

drop policy if exists "quote_requests member access" on public.quote_requests;
create policy "quote_requests member access"
  on public.quote_requests for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "quote_request_lines member access" on public.quote_request_lines;
create policy "quote_request_lines member access"
  on public.quote_request_lines for all to authenticated
  using (
    exists (
      select 1 from public.quote_requests qr
      where qr.id = quote_request_id and public.is_workspace_member(qr.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.quote_requests qr
      where qr.id = quote_request_id and public.is_workspace_member(qr.workspace_id)
    )
  );

drop policy if exists "quote_request_suppliers member access" on public.quote_request_suppliers;
create policy "quote_request_suppliers member access"
  on public.quote_request_suppliers for all to authenticated
  using (
    exists (
      select 1 from public.quote_requests qr
      where qr.id = quote_request_id and public.is_workspace_member(qr.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.quote_requests qr
      where qr.id = quote_request_id and public.is_workspace_member(qr.workspace_id)
    )
  );

drop policy if exists "quote_request_responses member access" on public.quote_request_responses;
create policy "quote_request_responses member access"
  on public.quote_request_responses for all to authenticated
  using (
    exists (
      select 1
      from public.quote_request_suppliers qs
      join public.quote_requests qr on qr.id = qs.quote_request_id
      where qs.id = quote_request_supplier_id
        and public.is_workspace_member(qr.workspace_id)
    )
  )
  with check (
    exists (
      select 1
      from public.quote_request_suppliers qs
      join public.quote_requests qr on qr.id = qs.quote_request_id
      where qs.id = quote_request_supplier_id
        and public.is_workspace_member(qr.workspace_id)
    )
  );

grant select, insert, update, delete on public.quote_requests to authenticated;
grant select, insert, update, delete on public.quote_request_lines to authenticated;
grant select, insert, update, delete on public.quote_request_suppliers to authenticated;
grant select, insert, update, delete on public.quote_request_responses to authenticated;
grant all on public.quote_requests to service_role;
grant all on public.quote_request_lines to service_role;
grant all on public.quote_request_suppliers to service_role;
grant all on public.quote_request_responses to service_role;
