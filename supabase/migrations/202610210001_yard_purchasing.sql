begin;
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role in ('admin','manager','engineer','estimator','technician','viewer','purchasing','receiving'));
alter table public.stock_orders drop constraint stock_orders_status_check;
alter table public.stock_orders add constraint stock_orders_status_check check(status in ('draft','awaiting_materials','held','staged','dispatched','received','delivered','cancelled'));
alter table public.stock_orders add column yard_area text not null default '';
alter table public.stock_orders add column staged_at timestamptz;
alter table public.stock_orders add column customer_snapshot jsonb not null default '{}';
update public.stock_orders o set customer_snapshot=jsonb_build_object('name',c.name,'accountNumber',c.account_number,'contactName',c.contact_name,'email',c.email,'phone',c.phone,'shippingInstructions',c.shipping_instructions) from public.customers c where c.id=o.customer_id;
create function private.snapshot_shipping_customer() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.customer_id is not null then select jsonb_build_object('name',name,'accountNumber',account_number,'contactName',contact_name,'email',email,'phone',phone,'shippingInstructions',shipping_instructions) into new.customer_snapshot from public.customers where id=new.customer_id;end if;return new;
end $$;
create trigger shipping_customer_snapshot before insert on public.stock_orders for each row execute function private.snapshot_shipping_customer();
alter table public.stock_order_lines add column reserved_quantity numeric not null default 0 check(reserved_quantity>=0 and reserved_quantity<=quantity);
update public.stock_order_lines l set reserved_quantity=quantity from public.stock_orders o where o.id=l.order_id and o.status='held';

create table public.stock_alerts(id uuid primary key default gen_random_uuid(),part_id text not null references public.inventory(id),location_id text not null references public.locations(id),active boolean not null,available numeric not null,minimum numeric not null,episode integer not null default 1,opened timestamptz not null default now(),updated timestamptz not null default now(),acknowledged_by uuid references public.profiles(id),acknowledged_at timestamptz,unique(part_id,location_id));
create function private.refresh_stock_alert() returns trigger language plpgsql security definer set search_path='' as $$
declare low boolean:=new.stock-new.reserved<new.reorder;
begin
  insert into public.stock_alerts(part_id,location_id,active,available,minimum) values(new.part_id,new.location_id,low,new.stock-new.reserved,new.reorder)
  on conflict(part_id,location_id) do update set active=excluded.active,available=excluded.available,minimum=excluded.minimum,updated=now(),
    episode=case when excluded.active and not stock_alerts.active then stock_alerts.episode+1 else stock_alerts.episode end,
    opened=case when excluded.active and not stock_alerts.active then now() else stock_alerts.opened end,
    acknowledged_by=case when excluded.active and not stock_alerts.active then null else stock_alerts.acknowledged_by end,
    acknowledged_at=case when excluded.active and not stock_alerts.active then null else stock_alerts.acknowledged_at end;
  return new;
end $$;
create trigger stock_alert_refresh after insert or update of stock,reserved,reorder on public.inventory_balances for each row execute function private.refresh_stock_alert();
insert into public.stock_alerts(part_id,location_id,active,available,minimum) select part_id,location_id,stock-reserved<reorder,stock-reserved,reorder from public.inventory_balances;

create table public.purchase_orders(id uuid primary key default gen_random_uuid(),request_key uuid unique not null,request_payload jsonb not null,supplier text not null check(char_length(supplier) between 1 and 160),supplier_reference text not null default '',location_id text not null references public.locations(id),linked_order_id uuid references public.stock_orders(id),status text not null default 'draft' check(status in ('draft','ordered','partially_received','received','cancelled')),expected_date text not null default '',notes text not null default '',revision integer not null default 1,created_by uuid not null references public.profiles(id),created timestamptz not null default now(),updated timestamptz not null default now());
create table public.purchase_order_lines(order_id uuid not null references public.purchase_orders(id) on delete cascade,part_id text not null references public.inventory(id),description text not null,unit text not null,quantity numeric not null check(quantity>0 and quantity<=1000000000),received numeric not null default 0 check(received>=0 and received<=quantity),primary key(order_id,part_id));
create table public.purchase_receipts(id uuid primary key default gen_random_uuid(),request_key uuid unique not null,request_payload jsonb not null,order_id uuid not null references public.purchase_orders(id),delivery_reference text not null default '',notes text not null default '',received_by uuid not null references public.profiles(id),created timestamptz not null default now());
create table public.purchase_receipt_lines(receipt_id uuid not null references public.purchase_receipts(id) on delete cascade,part_id text not null references public.inventory(id),accepted numeric not null check(accepted>=0),rejected numeric not null check(rejected>=0),allocated numeric not null default 0,bin text not null default '',primary key(receipt_id,part_id),check(accepted+rejected>0));
alter table public.stock_movements add column purchase_order_id uuid references public.purchase_orders(id);
alter table public.stock_movements add column receipt_id uuid references public.purchase_receipts(id);
alter table public.stock_alerts enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.purchase_receipts enable row level security;
alter table public.purchase_receipt_lines enable row level security;
revoke all on public.stock_alerts,public.purchase_orders,public.purchase_order_lines,public.purchase_receipts,public.purchase_receipt_lines from public,anon,authenticated;
grant select on public.stock_alerts,public.purchase_orders,public.purchase_order_lines,public.purchase_receipts,public.purchase_receipt_lines to authenticated;
grant all on public.stock_alerts,public.purchase_orders,public.purchase_order_lines,public.purchase_receipts,public.purchase_receipt_lines to service_role;
create policy alerts_read on public.stock_alerts for select to authenticated using(public.workspace_role() in ('admin','manager','estimator','purchasing','receiving'));
create policy purchases_read on public.purchase_orders for select to authenticated using(public.workspace_role() in ('admin','manager','estimator','purchasing','receiving'));
create policy purchase_lines_read on public.purchase_order_lines for select to authenticated using(public.workspace_role() in ('admin','manager','estimator','purchasing','receiving'));
create policy receipts_read on public.purchase_receipts for select to authenticated using(public.workspace_role() in ('admin','manager','estimator','purchasing','receiving'));
create policy receipt_lines_read on public.purchase_receipt_lines for select to authenticated using(public.workspace_role() in ('admin','manager','estimator','purchasing','receiving'));
drop policy costs_read on public.inventory_costs;
create policy costs_read on public.inventory_costs for select to authenticated using(public.workspace_role() in ('admin','manager','engineer','estimator','purchasing'));
drop policy orders_read on public.stock_orders;
drop policy order_lines_read on public.stock_order_lines;
create policy orders_read on public.stock_orders for select to authenticated using(public.workspace_role() in ('admin','manager','estimator','purchasing','receiving'));
create policy order_lines_read on public.stock_order_lines for select to authenticated using(public.workspace_role() in ('admin','manager','estimator','purchasing','receiving'));
drop policy movements_read on public.stock_movements;
create policy movements_read on public.stock_movements for select to authenticated using(public.workspace_role() in ('admin','manager','estimator','purchasing','receiving'));

create or replace function public.inventory_listing(p_location text default null,p_flat boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare selected text;result jsonb;
begin
  perform private.require_role(array['admin','manager','engineer','estimator','technician','viewer','purchasing','receiving']);
  selected:=coalesce(p_location,(select location_id from public.profiles where id=auth.uid()));
  if selected<>'all' and not exists(select 1 from public.locations where id=selected and active) then raise exception 'Choose an active inventory location.';end if;
  if selected='all' and not p_flat then
    select coalesce(jsonb_agg(data order by data->>'id'),'[]') into result from (
      select jsonb_build_object('id',i.id,'name',i.name,'category',i.category,'unit',i.unit,'stock',sum(b.stock),'reserved',sum(b.reserved),'staged',sum(coalesce(s.quantity,0)),'held',sum(b.reserved-coalesce(s.quantity,0)),'available',sum(b.stock-b.reserved),'price',case when public.workspace_role() in ('admin','manager','engineer','estimator','purchasing') then c.price else null end,'reorder',sum(b.reorder),'location','','location_id','all','supplier',i.supplier) data
      from public.inventory i join public.inventory_balances b on b.part_id=i.id left join public.inventory_costs c on c.id=i.id
      left join lateral(select sum(l.reserved_quantity) quantity from public.stock_order_lines l join public.stock_orders o on o.id=l.order_id where l.part_id=i.id and o.source_location=b.location_id and o.status='staged') s on true group by i.id,c.price) entries;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'category',i.category,'unit',i.unit,'stock',b.stock,'reserved',b.reserved,'staged',coalesce(s.quantity,0),'held',b.reserved-coalesce(s.quantity,0),'available',b.stock-b.reserved,'price',case when public.workspace_role() in ('admin','manager','engineer','estimator','purchasing') then c.price else null end,'reorder',b.reorder,'location',b.bin,'location_id',b.location_id,'supplier',i.supplier) order by i.id,b.location_id),'[]') into result
      from public.inventory i join public.inventory_balances b on b.part_id=i.id left join public.inventory_costs c on c.id=i.id
      left join lateral(select sum(l.reserved_quantity) quantity from public.stock_order_lines l join public.stock_orders o on o.id=l.order_id where l.part_id=i.id and o.source_location=b.location_id and o.status='staged') s on true where selected='all' or b.location_id=selected;
  end if;return result;
end $$;

drop function public.transition_stock_order(uuid,text,integer,text,text);
create function public.transition_stock_order(order_id uuid,action text,expected_revision integer,carrier_value text default null,tracking_value text default null,yard_area_value text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare shipment public.stock_orders;line record;balance public.inventory_balances;next_status text;delta numeric;reservation numeric;target text;needed numeric;
begin
  if action in ('receive','stage','unstage') then perform private.require_role(array['admin','manager','estimator','receiving']);else perform private.require_role(array['admin','manager','estimator']);end if;
  perform pg_advisory_xact_lock(7600241);select * into shipment from public.stock_orders where id=order_id for update;
  if not found then raise exception 'Shipment not found.';end if;
  if shipment.revision<>expected_revision then raise exception 'Shipment changed. Refresh before applying this action.';end if;
  if action='hold' and shipment.status in ('draft','awaiting_materials') then next_status:='held';
  elsif action='stage' and shipment.status='held' then
    if char_length(trim(coalesce(yard_area_value,''))) not between 1 and 160 then raise exception 'Enter the yard staging area.';end if;next_status:='staged';
  elsif action='unstage' and shipment.status='staged' then next_status:='held';
  elsif action='dispatch' and shipment.status in ('held','staged') then next_status:='dispatched';
  elsif action='cancel' and shipment.status in ('draft','awaiting_materials','held','staged') then next_status:='cancelled';
  elsif action='receive' and shipment.status='dispatched' and shipment.kind='transfer' then next_status:='received';
  elsif action='deliver' and shipment.status='dispatched' and shipment.kind='customer' then next_status:='delivered';
  else raise exception 'This action is not valid for the current shipment state.';end if;
  for line in select * from public.stock_order_lines where stock_order_lines.order_id=shipment.id order by part_id loop
    delta:=0;reservation:=0;target:=shipment.source_location;
    if action='receive' then
      target:=shipment.destination_location;if not exists(select 1 from public.locations where id=target and active) then raise exception 'Receiving location is inactive.';end if;
      insert into public.inventory_balances(part_id,location_id,stock) values(line.part_id,target,0) on conflict do nothing;delta:=line.quantity;
    else
      select * into balance from public.inventory_balances where part_id=line.part_id and location_id=target for update;
      if action='hold' then needed:=line.quantity-line.reserved_quantity;
        if balance.stock-balance.reserved<needed then raise exception 'Insufficient available stock for %. Nothing was reserved.',line.part_id;end if;reservation:=needed;
      elsif action='dispatch' then
        if line.reserved_quantity<>line.quantity then raise exception 'All materials must be held before dispatch.';end if;delta:=-line.quantity;reservation:=-line.reserved_quantity;
      elsif action='cancel' then reservation:=-line.reserved_quantity;end if;
    end if;
    if delta<>0 or reservation<>0 then
      update public.inventory_balances set stock=stock+delta,reserved=reserved+reservation where part_id=line.part_id and location_id=target;
      update public.stock_order_lines set reserved_quantity=reserved_quantity+reservation where stock_order_lines.order_id=shipment.id and part_id=line.part_id;
      update public.inventory set stock=(select sum(stock) from public.inventory_balances where part_id=line.part_id) where id=line.part_id;
    end if;
    if delta<>0 or reservation<>0 or action in ('stage','unstage') then insert into public.stock_movements(part_id,location_id,order_id,event,stock_delta,reserved_delta,actor,note) values(line.part_id,target,shipment.id,action,delta,reservation,auth.uid(),case when action='stage' then yard_area_value else '' end);end if;
  end loop;
  if char_length(coalesce(carrier_value,''))>100 or char_length(coalesce(tracking_value,''))>200 then raise exception 'Carrier or tracking value is too long.';end if;
  update public.stock_orders set status=next_status,revision=revision+1,updated=now(),carrier=coalesce(carrier_value,carrier),tracking=coalesce(tracking_value,tracking),yard_area=case when action='stage' then trim(yard_area_value) when action='unstage' then '' else yard_area end,staged_at=case when action='stage' then now() when action='unstage' then null else staged_at end where id=shipment.id;
  insert into public.audit(actor,action,detail) values(auth.uid(),'shipment.'||action,jsonb_build_object('id',shipment.id,'from',shipment.status,'to',next_status));
  return jsonb_build_object('id',shipment.id,'status',next_status,'revision',shipment.revision+1);
end $$;
create function public.create_purchase_order(payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.purchase_orders;identifier uuid;line jsonb;linked public.stock_orders;
begin
  perform private.require_role(array['admin','manager','estimator','purchasing']);perform pg_advisory_xact_lock(7600241);
  select * into existing from public.purchase_orders where request_key=(payload->>'requestKey')::uuid;
  if found then if existing.created_by<>auth.uid() or existing.request_payload<>payload then raise exception 'Purchase request key already used.';end if;return existing.id;end if;
  if not exists(select 1 from public.locations where id=payload->>'locationId' and active) then raise exception 'Choose an active receiving location.';end if;
  if char_length(trim(coalesce(payload->>'supplier',''))) not between 1 and 160 then raise exception 'Enter the supplier name.';end if;
  if jsonb_typeof(payload->'lines') is distinct from 'array' then raise exception 'Choose purchase lines.';end if;
  if jsonb_array_length(payload->'lines') not between 1 and 100 then raise exception 'Choose 1-100 purchase lines.';end if;
  if payload->>'linkedOrderId' is not null then
    select * into linked from public.stock_orders where id=(payload->>'linkedOrderId')::uuid for update;
    if not found or linked.kind<>'customer' or linked.source_location<>payload->>'locationId' or linked.status not in ('draft','awaiting_materials') then raise exception 'Choose an open customer order at the receiving site.';end if;
  end if;
  insert into public.purchase_orders(request_key,request_payload,supplier,supplier_reference,location_id,linked_order_id,expected_date,notes,created_by)
    values((payload->>'requestKey')::uuid,payload,trim(payload->>'supplier'),coalesce(payload->>'supplierReference',''),payload->>'locationId',(payload->>'linkedOrderId')::uuid,coalesce(payload->>'expectedDate',''),coalesce(payload->>'notes',''),auth.uid()) returning id into identifier;
  for line in select value from jsonb_array_elements(payload->'lines') loop
    if linked.id is not null and not exists(select 1 from public.stock_order_lines where order_id=linked.id and part_id=line->>'partId') then raise exception 'Special-order materials must belong to the linked customer order.';end if;
    insert into public.purchase_order_lines(order_id,part_id,description,unit,quantity) select identifier,id,name,unit,(line->>'quantity')::numeric from public.inventory where id=line->>'partId';
    if not found then raise exception 'Create this part in the catalog before ordering it.';end if;
    insert into public.inventory_balances(part_id,location_id,stock) values(line->>'partId',payload->>'locationId',0) on conflict do nothing;
  end loop;
  insert into public.audit(actor,action,detail) values(auth.uid(),'purchase.create',jsonb_build_object('id',identifier));return identifier;
end $$;

create function public.transition_purchase_order(purchase_id uuid,action text,expected_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare purchase public.purchase_orders;next_status text;linked public.stock_orders;
begin
  perform private.require_role(array['admin','manager','estimator','purchasing']);perform pg_advisory_xact_lock(7600241);
  select * into purchase from public.purchase_orders where id=purchase_id for update;
  if not found then raise exception 'Purchase order not found.';end if;
  if purchase.revision<>expected_revision then raise exception 'Purchase order changed. Refresh before updating.';end if;
  if action='order' and purchase.status='draft' then
    if not exists(select 1 from public.locations where id=purchase.location_id and active) then raise exception 'Receiving site is inactive.';end if;next_status:='ordered';
    if purchase.linked_order_id is not null then
      select * into linked from public.stock_orders where id=purchase.linked_order_id for update;
      if linked.status not in ('draft','awaiting_materials') then raise exception 'Linked customer order is no longer waiting for materials.';end if;
      update public.stock_orders set status='awaiting_materials',revision=revision+1,updated=now() where id=linked.id;
    end if;
  elsif action='cancel' and purchase.status in ('draft','ordered','partially_received') then next_status:='cancelled';
  else raise exception 'This action is not valid for the purchase order state.';end if;
  update public.purchase_orders set status=next_status,revision=revision+1,updated=now() where id=purchase.id;
  insert into public.audit(actor,action,detail) values(auth.uid(),'purchase.'||action,jsonb_build_object('id',purchase.id));return jsonb_build_object('id',purchase.id,'status',next_status,'revision',purchase.revision+1);
end $$;

create function public.approve_purchase_receipt(purchase_id uuid,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare purchase public.purchase_orders;existing public.purchase_receipts;identifier uuid;line jsonb;ordered public.purchase_order_lines;linked public.stock_orders;accepted numeric;rejected numeric;allocate numeric;need numeric;total numeric:=0;bad numeric:=0;complete boolean;
begin
  perform private.require_role(array['admin','manager','estimator','receiving']);perform pg_advisory_xact_lock(7600241);
  select * into existing from public.purchase_receipts where request_key=(payload->>'requestKey')::uuid;
  if found then if existing.order_id<>purchase_id or existing.received_by<>auth.uid() or existing.request_payload<>payload then raise exception 'Receipt request key already used.';end if;return jsonb_build_object('id',existing.id,'alreadyApplied',true);end if;
  select * into purchase from public.purchase_orders where id=purchase_id for update;
  if not found then raise exception 'Purchase order not found.';end if;
  if purchase.revision<>(payload->>'revision')::integer then raise exception 'Purchase changed. Refresh and count the outstanding quantities again.';end if;
  if purchase.status not in ('ordered','partially_received') then raise exception 'Only ordered materials can be received.';end if;
  if not exists(select 1 from public.locations where id=purchase.location_id and active) then raise exception 'Receiving site is inactive.';end if;
  if jsonb_typeof(payload->'lines') is distinct from 'array' then raise exception 'Enter counted material lines.';end if;
  if jsonb_array_length(payload->'lines') not between 1 and 100 then raise exception 'Choose 1-100 counted lines.';end if;
  if purchase.linked_order_id is not null then select * into linked from public.stock_orders where id=purchase.linked_order_id for update;end if;
  insert into public.purchase_receipts(request_key,request_payload,order_id,delivery_reference,notes,received_by) values((payload->>'requestKey')::uuid,payload,purchase.id,coalesce(payload->>'deliveryReference',''),coalesce(payload->>'notes',''),auth.uid()) returning id into identifier;
  for line in select value from jsonb_array_elements(payload->'lines') loop
    accepted:=(line->>'accepted')::numeric;rejected:=(line->>'rejected')::numeric;
    if accepted is null or rejected is null or accepted<0 or rejected<0 then raise exception 'Counted quantities must be nonnegative numbers.';end if;
    if accepted+rejected=0 then continue;end if;
    select * into ordered from public.purchase_order_lines where order_id=purchase.id and part_id=line->>'partId' for update;
    if not found or accepted+rejected>ordered.quantity-ordered.received then raise exception 'Count exceeds outstanding purchase quantity or part is not on this order.';end if;
    if exists(select 1 from public.inventory where id=ordered.part_id and unit<>ordered.unit) then raise exception 'Catalog unit changed. Review this purchase before receiving.';end if;
    allocate:=0;
    if linked.id is not null and linked.status in ('draft','awaiting_materials') then
      select quantity-reserved_quantity into need from public.stock_order_lines where order_id=linked.id and part_id=ordered.part_id for update;
      allocate:=least(accepted,greatest(coalesce(need,0),0));
    end if;
    insert into public.purchase_receipt_lines(receipt_id,part_id,accepted,rejected,allocated,bin) values(identifier,ordered.part_id,accepted,rejected,allocate,coalesce(line->>'bin',''));
    if accepted>0 then
      update public.purchase_order_lines set received=received+accepted where order_id=purchase.id and part_id=ordered.part_id;
      insert into public.inventory_balances(part_id,location_id,stock) values(ordered.part_id,purchase.location_id,0) on conflict do nothing;
      update public.inventory_balances set stock=stock+accepted,reserved=reserved+allocate,bin=case when coalesce(line->>'bin','')<>'' then line->>'bin' else bin end where part_id=ordered.part_id and location_id=purchase.location_id;
      if allocate>0 then update public.stock_order_lines set reserved_quantity=reserved_quantity+allocate where order_id=linked.id and part_id=ordered.part_id;end if;
      update public.inventory set stock=(select sum(stock) from public.inventory_balances where part_id=ordered.part_id) where id=ordered.part_id;
      insert into public.stock_movements(part_id,location_id,order_id,event,stock_delta,reserved_delta,actor,purchase_order_id,receipt_id,note) values(ordered.part_id,purchase.location_id,case when allocate>0 then linked.id end,'purchase-receipt',accepted,allocate,auth.uid(),purchase.id,identifier,coalesce(payload->>'deliveryReference',''));
    end if;
    total:=total+accepted;bad:=bad+rejected;
  end loop;
  if total+bad=0 then raise exception 'Enter at least one counted quantity.';end if;
  select not exists(select 1 from public.purchase_order_lines where order_id=purchase.id and received<quantity) into complete;
  update public.purchase_orders set status=case when complete then 'received' when exists(select 1 from public.purchase_order_lines where order_id=purchase.id and received>0) then 'partially_received' else 'ordered' end,revision=revision+1,updated=now() where id=purchase.id;
  if linked.id is not null and linked.status in ('draft','awaiting_materials') then
    update public.stock_orders set status=case when not exists(select 1 from public.stock_order_lines where order_id=linked.id and reserved_quantity<quantity) then 'held' else 'awaiting_materials' end,revision=revision+1,updated=now() where id=linked.id;
  end if;
  insert into public.audit(actor,action,detail) values(auth.uid(),'purchase.receive',jsonb_build_object('id',purchase.id,'receipt',identifier,'accepted',total,'rejected',bad));return jsonb_build_object('id',identifier,'accepted',total,'rejected',bad,'alreadyApplied',false);
end $$;

create or replace function public.save_location(payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare site_id text:=payload->>'id';
begin
  perform private.require_role(array['admin']);perform pg_advisory_xact_lock(7600241);
  if not (payload->>'active')::boolean and (
    exists(select 1 from public.profiles where location_id=site_id and not disabled) or
    exists(select 1 from public.inventory_balances where location_id=site_id and (stock>0 or reserved>0)) or
    exists(select 1 from public.stock_orders where status in ('draft','awaiting_materials','held','staged','dispatched') and (source_location=site_id or destination_location=site_id)) or
    exists(select 1 from public.purchase_orders where location_id=site_id and status in ('draft','ordered','partially_received'))
  ) then raise exception 'Move active employees, stock, open shipments, and incoming purchases before deactivating this location.'; end if;
  insert into public.locations(id,name,address,phone,active) values(site_id,payload->>'name',coalesce(payload->>'address',''),coalesce(payload->>'phone',''),(payload->>'active')::boolean)
    on conflict(id) do update set name=excluded.name,address=excluded.address,phone=excluded.phone,active=excluded.active;
  insert into public.audit(actor,action,detail) values(auth.uid(),'location.save',jsonb_build_object('id',site_id,'active',payload->'active'));
end $$;

create function public.supply_board(p_location text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare selected text;result jsonb;
begin
  perform private.require_role(array['admin','manager','estimator','purchasing','receiving']);selected:=coalesce(p_location,(select location_id from public.profiles where id=auth.uid()));
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'unit',i.unit,'supplier',i.supplier,'location_id',b.location_id,'stock',b.stock,'reserved',b.reserved,'available',b.stock-b.reserved,'minimum',b.reorder,'incoming',coalesce(incoming.quantity,0),'suggested',greatest(b.reorder-(b.stock-b.reserved)-coalesce(incoming.quantity,0),0),'alert_id',a.id,'episode',a.episode,'acknowledged',a.acknowledged_at is not null) order by b.location_id,i.id),'[]') into result
  from public.inventory_balances b join public.inventory i on i.id=b.part_id left join public.stock_alerts a on a.part_id=b.part_id and a.location_id=b.location_id
  left join lateral(select sum(l.quantity-l.received) quantity from public.purchase_order_lines l join public.purchase_orders p on p.id=l.order_id where l.part_id=b.part_id and p.location_id=b.location_id and p.status in ('ordered','partially_received') and p.linked_order_id is null) incoming on true
  where (selected='all' or b.location_id=selected) and b.stock-b.reserved<b.reorder;return result;
end $$;
create function public.acknowledge_stock_alert(alert_id uuid,expected_episode integer) returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.require_role(array['admin','manager','estimator','purchasing']);update public.stock_alerts set acknowledged_by=auth.uid(),acknowledged_at=now() where id=alert_id and active and episode=expected_episode;
  if not found then raise exception 'Warning changed or cleared. Refresh the ordering board.';end if;
end $$;

revoke all on function public.create_purchase_order(jsonb),public.transition_purchase_order(uuid,text,integer),public.approve_purchase_receipt(uuid,jsonb),public.supply_board(text),public.acknowledge_stock_alert(uuid,integer) from public,anon;
grant execute on function public.create_purchase_order(jsonb),public.transition_purchase_order(uuid,text,integer),public.approve_purchase_receipt(uuid,jsonb),public.supply_board(text),public.acknowledge_stock_alert(uuid,integer) to authenticated;
revoke all on function public.transition_stock_order(uuid,text,integer,text,text,text) from public,anon;
grant execute on function public.transition_stock_order(uuid,text,integer,text,text,text) to authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
commit;