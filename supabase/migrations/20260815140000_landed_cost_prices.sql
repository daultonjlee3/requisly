-- Landed cost components on the effective-dated price schedule.
-- unit_cost remains the supplier/FOB invoice cost; freight/duty/customs
-- allocate into per-unit landed cost (generated column).

alter table public.supplier_product_prices
  add column if not exists freight_per_unit numeric(12, 4) not null default 0
    check (freight_per_unit >= 0),
  add column if not exists duty_per_unit numeric(12, 4) not null default 0
    check (duty_per_unit >= 0),
  add column if not exists customs_per_unit numeric(12, 4) not null default 0
    check (customs_per_unit >= 0);

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'supplier_product_prices'
      and column_name = 'landed_unit_cost'
  ) then
    alter table public.supplier_product_prices
      add column landed_unit_cost numeric(12, 4)
        generated always as (
          unit_cost + freight_per_unit + duty_per_unit + customs_per_unit
        ) stored;
  end if;
end $$;

comment on column public.supplier_product_prices.unit_cost is
  'Supplier invoice / FOB unit cost (ex-works). Landed cost adds freight/duty/customs.';
comment on column public.supplier_product_prices.freight_per_unit is
  'Allocated freight (shipping) cost per unit.';
comment on column public.supplier_product_prices.duty_per_unit is
  'Allocated import duty per unit.';
comment on column public.supplier_product_prices.customs_per_unit is
  'Allocated customs / brokerage / other import fees per unit.';
comment on column public.supplier_product_prices.landed_unit_cost is
  'Generated: unit_cost + freight_per_unit + duty_per_unit + customs_per_unit.';

-- Must drop: CREATE OR REPLACE cannot rename/reorder view columns.
drop view if exists public.supplier_product_pricing;

create view public.supplier_product_pricing
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
    select spp.landed_unit_cost
    from public.supplier_product_prices spp
    where spp.supplier_product_id = sp.id
      and spp.effective_date <= current_date
    order by spp.effective_date desc, spp.created_at desc
    limit 1
  ) as current_landed_unit_cost,
  (
    select spp.freight_per_unit
    from public.supplier_product_prices spp
    where spp.supplier_product_id = sp.id
      and spp.effective_date <= current_date
    order by spp.effective_date desc, spp.created_at desc
    limit 1
  ) as current_freight_per_unit,
  (
    select spp.duty_per_unit
    from public.supplier_product_prices spp
    where spp.supplier_product_id = sp.id
      and spp.effective_date <= current_date
    order by spp.effective_date desc, spp.created_at desc
    limit 1
  ) as current_duty_per_unit,
  (
    select spp.customs_per_unit
    from public.supplier_product_prices spp
    where spp.supplier_product_id = sp.id
      and spp.effective_date <= current_date
    order by spp.effective_date desc, spp.created_at desc
    limit 1
  ) as current_customs_per_unit,
  (
    select spp.unit_cost
    from public.supplier_product_prices spp
    where spp.supplier_product_id = sp.id
      and spp.effective_date > current_date
    order by spp.effective_date asc, spp.created_at asc
    limit 1
  ) as next_unit_cost,
  (
    select spp.landed_unit_cost
    from public.supplier_product_prices spp
    where spp.supplier_product_id = sp.id
      and spp.effective_date > current_date
    order by spp.effective_date asc, spp.created_at asc
    limit 1
  ) as next_landed_unit_cost,
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

create or replace function public.current_supplier_product_landed_unit_cost(
  p_supplier_product_id uuid
)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select spp.landed_unit_cost
  from public.supplier_product_prices spp
  where spp.supplier_product_id = p_supplier_product_id
    and spp.effective_date <= current_date
  order by spp.effective_date desc, spp.created_at desc
  limit 1;
$$;

revoke all on function public.current_supplier_product_landed_unit_cost(uuid) from public;
grant execute on function public.current_supplier_product_landed_unit_cost(uuid) to authenticated;
grant execute on function public.current_supplier_product_landed_unit_cost(uuid) to service_role;
