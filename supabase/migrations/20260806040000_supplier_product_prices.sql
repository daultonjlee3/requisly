-- Effective-dated pricing — schedule is the source of truth.
drop table if exists public.supplier_product_price_history;

create table if not exists public.supplier_product_prices (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references public.supplier_products(id) on delete cascade,
  unit_cost numeric(12,2) not null,
  effective_date date not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists supplier_product_prices_product_date_idx
  on public.supplier_product_prices (supplier_product_id, effective_date desc);

comment on table public.supplier_product_prices is
  'Effective-dated price schedule. Current price = latest row with effective_date <= today. Future rows are scheduled.';

insert into public.supplier_product_prices (supplier_product_id, unit_cost, effective_date, created_at)
select sp.id, sp.unit_cost, coalesce(sp.created_at::date, current_date), coalesce(sp.created_at, now())
from public.supplier_products sp
where sp.unit_cost is not null
  and not exists (
    select 1 from public.supplier_product_prices spp
    where spp.supplier_product_id = sp.id
  );

create or replace view public.supplier_product_pricing
with (security_invoker = true) as
select
  sp.id as supplier_product_id,
  sp.workspace_id,
  sp.supplier_id,
  (
    select spp.unit_cost
    from public.supplier_product_prices spp
    where spp.supplier_product_id = sp.id
      and spp.effective_date <= current_date
    order by spp.effective_date desc, spp.created_at desc
    limit 1
  ) as current_unit_cost,
  (
    select spp.unit_cost
    from public.supplier_product_prices spp
    where spp.supplier_product_id = sp.id
      and spp.effective_date > current_date
    order by spp.effective_date asc, spp.created_at asc
    limit 1
  ) as next_unit_cost,
  (
    select spp.effective_date
    from public.supplier_product_prices spp
    where spp.supplier_product_id = sp.id
      and spp.effective_date > current_date
    order by spp.effective_date asc, spp.created_at asc
    limit 1
  ) as next_effective_date
from public.supplier_products sp;

grant select on public.supplier_product_pricing to authenticated;
grant select on public.supplier_product_pricing to service_role;

create or replace function public.current_supplier_product_unit_cost(p_supplier_product_id uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select spp.unit_cost
  from public.supplier_product_prices spp
  where spp.supplier_product_id = p_supplier_product_id
    and spp.effective_date <= current_date
  order by spp.effective_date desc, spp.created_at desc
  limit 1;
$$;

revoke all on function public.current_supplier_product_unit_cost(uuid) from public;
grant execute on function public.current_supplier_product_unit_cost(uuid) to authenticated;

alter table public.supplier_product_prices enable row level security;

drop policy if exists "supplier_product_prices member access" on public.supplier_product_prices;
create policy "supplier_product_prices member access"
  on public.supplier_product_prices for all to authenticated
  using (
    exists (
      select 1
      from public.supplier_products sp
      where sp.id = supplier_product_prices.supplier_product_id
        and public.is_workspace_member(sp.workspace_id)
    )
  )
  with check (
    exists (
      select 1
      from public.supplier_products sp
      where sp.id = supplier_product_prices.supplier_product_id
        and public.is_workspace_member(sp.workspace_id)
    )
  );

grant select, insert, update, delete on public.supplier_product_prices to authenticated;
grant all on public.supplier_product_prices to service_role;

comment on column public.supplier_products.unit_cost is
  'DEPRECATED cache — do not edit. Source of truth is supplier_product_prices / supplier_product_pricing view.';
