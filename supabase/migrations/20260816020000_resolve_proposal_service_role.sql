-- Embedded Shopify app uses the service role (no auth.uid()).
-- Keep the user-JWT workspace check for any dashboard caller.
create or replace function public.resolve_line_item_proposal(p_proposal_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_proposal public.po_line_item_proposals%rowtype;
  v_line public.po_line_items%rowtype;
  v_po public.purchase_orders%rowtype;
  v_new_qty integer;
  v_new_cost numeric(12,2);
  v_subtotal numeric(12,2);
begin
  if auth.role() is distinct from 'service_role' then
    if auth.uid() is null then raise exception 'not_authenticated'; end if;
    if (
      select workspace_id from public.purchase_orders po
      join public.po_line_items li on li.po_id = po.id
      join public.po_line_item_proposals pr on pr.po_line_item_id = li.id
      where pr.id = p_proposal_id
    ) is distinct from public.current_workspace_id() then
      raise exception 'forbidden';
    end if;
  end if;

  select * into v_proposal from public.po_line_item_proposals where id = p_proposal_id;
  if not found then raise exception 'not_found'; end if;
  if v_proposal.status <> 'pending' then raise exception 'not_pending'; end if;

  select * into v_line from public.po_line_items where id = v_proposal.po_line_item_id;
  select * into v_po from public.purchase_orders where id = v_line.po_id;

  if v_po.status = 'rejected' then raise exception 'po_rejected'; end if;

  if p_accept then
    v_new_qty := coalesce(v_proposal.proposed_qty, v_line.qty);
    v_new_cost := coalesce(v_proposal.proposed_unit_cost, v_line.unit_cost);

    update public.po_line_items
      set qty = v_new_qty,
          unit_cost = v_new_cost,
          line_total = round(v_new_qty * v_new_cost, 2)
      where id = v_line.id;

    select coalesce(sum(line_total), 0) into v_subtotal
    from public.po_line_items where po_id = v_po.id;

    update public.purchase_orders
      set subtotal = v_subtotal,
          total = round(
            v_subtotal
            + coalesce(v_po.tax_amount, 0)
            + coalesce(v_po.shipping_amount, 0)
            + coalesce(v_po.adjustment_amount, 0),
            2
          )
      where id = v_po.id;

    update public.po_line_item_proposals
      set status = 'accepted', resolved_at = now()
      where id = v_proposal.id;
  else
    update public.po_line_item_proposals
      set status = 'rejected', resolved_at = now()
      where id = v_proposal.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'proposal_id', v_proposal.id,
    'accepted', p_accept,
    'po_id', v_po.id
  );
end;
$$;
