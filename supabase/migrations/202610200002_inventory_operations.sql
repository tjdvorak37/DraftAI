begin;

create table public.locations (
  id text primary key check (id ~ '^[A-Z0-9][A-Z0-9_-]{0,23}$'),
  name text not null check (char_length(name) between 2 and 100),
  address text not null default '', phone text not null default '', active boolean not null default true
);
insert into public.locations(id,name) values('MAIN','Primary location');
alter table public.profiles add column location_id text not null default 'MAIN' references public.locations(id);
create table public.inventory_balances (
  part_id text not null references public.inventory(id), location_id text not null references public.locations(id),
  stock numeric not null default 0 check (stock between 0 and 1000000000),
  reserved numeric not null default 0 check (reserved >= 0 and reserved <= stock),
  reorder numeric not null default 0 check (reorder between 0 and 1000000000),
  bin text not null default '', primary key(part_id,location_id)
);
insert into public.inventory_balances(part_id,location_id,stock,reorder,bin) select id,'MAIN',stock,reorder,location from public.inventory;
create table public.customers (
  id uuid primary key default gen_random_uuid(), name text not null check (char_length(name) between 2 and 160),
  account_number text not null default '', contact_name text not null default '', email text not null default '',
  phone text not null default '', website text not null default '', billing_address jsonb not null default '{}',
  shipping_address jsonb not null default '{}', shipping_instructions text not null default '', contacts jsonb not null default '[]',
  notes text not null default '', active boolean not null default true, revision integer not null default 1,
  updated timestamptz not null default now()
);
create table public.stock_orders (
  id uuid primary key default gen_random_uuid(), request_key uuid unique not null, request_payload jsonb not null,
  kind text not null check(kind in ('customer','transfer')), status text not null default 'draft' check(status in ('draft','held','dispatched','received','delivered','cancelled')),
  source_location text not null references public.locations(id), destination_location text references public.locations(id),
  customer_id uuid references public.customers(id), shipping_address jsonb not null default '{}',
  reference text not null default '', scheduled_date text not null default '', carrier text not null default '', tracking text not null default '', notes text not null default '',
  created_by uuid not null references public.profiles(id), revision integer not null default 1,
  created timestamptz not null default now(), updated timestamptz not null default now(),
  check((kind='customer' and customer_id is not null and destination_location is null) or (kind='transfer' and destination_location is not null and destination_location<>source_location and customer_id is null))
);
create table public.stock_order_lines (
  order_id uuid not null references public.stock_orders(id) on delete cascade, part_id text not null references public.inventory(id),
  quantity numeric not null check(quantity>0 and quantity<=1000000000),description text not null,unit text not null, primary key(order_id,part_id)
);
create table public.stock_movements (
  id bigint generated always as identity primary key, part_id text not null references public.inventory(id),
  location_id text not null references public.locations(id), order_id uuid references public.stock_orders(id),
  event text not null, stock_delta numeric not null, reserved_delta numeric not null,
  actor uuid references public.profiles(id), created timestamptz not null default now(), note text not null default ''
);
insert into public.stock_movements(part_id,location_id,event,stock_delta,reserved_delta,note)
  select part_id,location_id,'opening',stock,0,'Existing inventory preserved during multi-location migration.' from public.inventory_balances;

alter table public.locations enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.customers enable row level security;
alter table public.stock_orders enable row level security;
alter table public.stock_order_lines enable row level security;
alter table public.stock_movements enable row level security;
revoke all on public.locations,public.inventory_balances,public.customers,public.stock_orders,public.stock_order_lines,public.stock_movements from public,anon,authenticated;
grant select on public.locations,public.inventory_balances,public.customers,public.stock_orders,public.stock_order_lines,public.stock_movements to authenticated;
grant all on public.locations,public.inventory_balances,public.customers,public.stock_orders,public.stock_order_lines,public.stock_movements to service_role;
grant usage,select on all sequences in schema public to service_role;
create policy locations_read on public.locations for select to authenticated using(public.workspace_role() is not null);
create policy balances_read on public.inventory_balances for select to authenticated using(public.workspace_role() is not null);
create policy customers_read on public.customers for select to authenticated using(public.workspace_role() in ('admin','manager','estimator'));
create policy orders_read on public.stock_orders for select to authenticated using(public.workspace_role() in ('admin','manager','estimator'));
create policy order_lines_read on public.stock_order_lines for select to authenticated using(public.workspace_role() in ('admin','manager','estimator'));
create policy movements_read on public.stock_movements for select to authenticated using(public.workspace_role() in ('admin','manager','estimator'));

create function public.save_location(payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare site_id text:=payload->>'id';
begin
  perform private.require_role(array['admin']);perform pg_advisory_xact_lock(7600241);
  if not (payload->>'active')::boolean and (
    exists(select 1 from public.profiles where location_id=site_id and not disabled) or
    exists(select 1 from public.inventory_balances where location_id=site_id and (stock>0 or reserved>0)) or
    exists(select 1 from public.stock_orders where status in ('draft','held','dispatched') and (source_location=site_id or destination_location=site_id))
  ) then raise exception 'Move active employees, stock, and open shipments before deactivating this location.'; end if;
  insert into public.locations(id,name,address,phone,active) values(site_id,payload->>'name',coalesce(payload->>'address',''),coalesce(payload->>'phone',''),(payload->>'active')::boolean)
    on conflict(id) do update set name=excluded.name,address=excluded.address,phone=excluded.phone,active=excluded.active;
  insert into public.audit(actor,action,detail) values(auth.uid(),'location.save',jsonb_build_object('id',site_id,'active',payload->'active'));
end $$;
create function private.check_work_location() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(7600241);
  if not new.disabled and not exists(select 1 from public.locations where id=new.location_id and active) then raise exception 'Choose an active work location.'; end if;
  return new;
end $$;
create trigger staff_location_check before insert or update of location_id,disabled on public.profiles for each row execute function private.check_work_location();

create function public.inventory_listing(p_location text default null, p_flat boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare selected text; result jsonb;
begin
  perform private.require_role(array['admin','manager','engineer','estimator','technician','viewer']);
  selected := coalesce(p_location,(select location_id from public.profiles where id=auth.uid()));
  if selected<>'all' and not exists(select 1 from public.locations where id=selected and active) then raise exception 'Choose an active inventory location.'; end if;
  if selected='all' and not p_flat then
    select coalesce(jsonb_agg(row_data order by row_data->>'id'),'[]') into result from (
      select jsonb_build_object('id',i.id,'name',i.name,'category',i.category,'unit',i.unit,'stock',sum(b.stock),'reserved',sum(b.reserved),'available',sum(b.stock-b.reserved),
        'price',case when public.workspace_role() in ('admin','manager','engineer','estimator') then c.price else null end,
        'reorder',sum(b.reorder),'location','','location_id','all','supplier',i.supplier) row_data
      from public.inventory i join public.inventory_balances b on b.part_id=i.id left join public.inventory_costs c on c.id=i.id group by i.id,c.price
    ) entries;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'category',i.category,'unit',i.unit,'stock',b.stock,'reserved',b.reserved,'available',b.stock-b.reserved,
      'price',case when public.workspace_role() in ('admin','manager','engineer','estimator') then c.price else null end,
      'reorder',b.reorder,'location',b.bin,'location_id',b.location_id,'supplier',i.supplier) order by i.id,b.location_id),'[]') into result
      from public.inventory i join public.inventory_balances b on b.part_id=i.id left join public.inventory_costs c on c.id=i.id where selected='all' or b.location_id=selected;
  end if;
  return result;
end $$;

create function private.inventory_snapshot(part_id text, site_id text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',i.id,'name',i.name,'category',i.category,'unit',i.unit,'stock',b.stock,'price',c.price,'reorder',b.reorder,'location',b.bin,'location_id',b.location_id,'supplier',i.supplier)
    from public.inventory i join public.inventory_balances b on b.part_id=i.id left join public.inventory_costs c on c.id=i.id where i.id=part_id and b.location_id=site_id
$$;
create or replace function private.inventory_snapshot(part_id text) returns jsonb language sql stable security definer set search_path='' as $$ select private.inventory_snapshot(part_id,'MAIN') $$;

create or replace function private.write_inventory(item jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare site_id text := coalesce(item->>'location_id','MAIN'); previous numeric; held numeric; old_unit text; incoming numeric := (item->>'stock')::numeric;
begin
  if not exists(select 1 from public.locations where id=site_id and active) then raise exception 'Inventory location is not active or does not exist.'; end if;
  select unit into old_unit from public.inventory where id=item->>'id';
  if old_unit is not null and old_unit<>item->>'unit' and exists(select 1 from public.inventory_balances where part_id=item->>'id' and stock>0) then raise exception 'Cannot change units while stock exists. Use a reviewed conversion process.'; end if;
  select stock,reserved into previous,held from public.inventory_balances where part_id=item->>'id' and location_id=site_id for update;
  if incoming<coalesce(held,0) then raise exception 'Count cannot be lower than materials currently held for delivery.'; end if;
  insert into public.inventory(id,name,category,unit,stock,reorder,location,supplier)
    values(item->>'id',item->>'name',item->>'category',item->>'unit',0,(item->>'reorder')::numeric,coalesce(item->>'location',''),coalesce(item->>'supplier',''))
    on conflict(id) do update set name=excluded.name,category=excluded.category,unit=excluded.unit,supplier=excluded.supplier;
  insert into public.inventory_balances(part_id,location_id,stock,reserved,reorder,bin) values(item->>'id',site_id,incoming,0,(item->>'reorder')::numeric,coalesce(item->>'location',''))
    on conflict(part_id,location_id) do update set stock=excluded.stock,reorder=excluded.reorder,bin=excluded.bin;
  insert into public.inventory_costs(id,price) values(item->>'id',(item->>'price')::numeric) on conflict(id) do update set price=excluded.price;
  update public.inventory set stock=(select sum(stock) from public.inventory_balances where part_id=item->>'id') where id=item->>'id';
  if incoming<>coalesce(previous,0) then insert into public.stock_movements(part_id,location_id,event,stock_delta,reserved_delta,actor,note)
    values(item->>'id',site_id,'count-adjustment',incoming-coalesce(previous,0),0,auth.uid(),'Manual count or reviewed inventory import.'); end if;
end $$;

create or replace function public.apply_inventory_import(preview_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare preview public.inventory_imports; entry jsonb;
begin
  perform private.require_role(array['admin','estimator']); perform pg_advisory_xact_lock(7600241);
  select * into preview from public.inventory_imports where id=preview_id and actor=auth.uid() and expires>now() for update;
  if not found then raise exception 'Preview expired or already applied. Preview again.'; end if;
  for entry in select value from jsonb_array_elements(preview.payload->'rows') loop
    if coalesce(private.inventory_snapshot(entry->'item'->>'id',coalesce(entry->'item'->>'location_id','MAIN')),'null'::jsonb) is distinct from coalesce(entry->'before','null'::jsonb) then raise exception 'Inventory changed since preview. No rows imported.'; end if;
  end loop;
  for entry in select value from jsonb_array_elements(preview.payload->'rows') loop perform private.write_inventory(entry->'item'); end loop;
  delete from public.inventory_imports where id=preview_id;
  insert into public.audit(actor,action,detail) values(auth.uid(),'inventory.import',jsonb_build_object('fileName',preview.payload->>'fileName','counts',preview.payload->'counts'));
  return preview.payload->'counts';
end $$;

create function public.create_stock_order(payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare existing public.stock_orders; identifier uuid; line jsonb; shipping jsonb;
begin
  perform private.require_role(array['admin','manager','estimator']); perform pg_advisory_xact_lock(7600241);
  select * into existing from public.stock_orders where request_key=(payload->>'requestKey')::uuid;
  if found then
    if existing.created_by<>auth.uid() or existing.request_payload<>payload then raise exception 'Request key already used for a different shipment.'; end if;
    return existing.id;
  end if;
  if not exists(select 1 from public.locations where id=payload->>'sourceLocation' and active) then raise exception 'Choose an active shipping location.'; end if;
  if payload->>'kind'='transfer' then
    if not exists(select 1 from public.locations where id=payload->>'destinationLocation' and active) or payload->>'destinationLocation'=payload->>'sourceLocation' then raise exception 'Choose a different active receiving location.'; end if;
  elsif payload->>'kind'='customer' then
    select coalesce(payload->'shippingAddress',shipping_address) into shipping from public.customers where id=(payload->>'customerId')::uuid and active;
    if shipping is null or coalesce(shipping->>'line1','')='' then raise exception 'Choose an active customer with a shipping address.'; end if;
  else raise exception 'Invalid shipment type.'; end if;
  if jsonb_typeof(payload->'lines') is distinct from 'array' then raise exception 'Choose 1-100 inventory lines.'; end if;
  if jsonb_array_length(payload->'lines') not between 1 and 100 then raise exception 'Choose 1-100 inventory lines.'; end if;
  insert into public.stock_orders(request_key,request_payload,kind,source_location,destination_location,customer_id,shipping_address,reference,scheduled_date,carrier,tracking,notes,created_by)
    values((payload->>'requestKey')::uuid,payload,payload->>'kind',payload->>'sourceLocation',case when payload->>'kind'='transfer' then payload->>'destinationLocation' end,
      case when payload->>'kind'='customer' then (payload->>'customerId')::uuid end,coalesce(shipping,'{}'),coalesce(payload->>'reference',''),coalesce(payload->>'scheduledDate',''),coalesce(payload->>'carrier',''),coalesce(payload->>'tracking',''),coalesce(payload->>'notes',''),auth.uid()) returning id into identifier;
  for line in select value from jsonb_array_elements(payload->'lines') loop
    if not exists(select 1 from public.inventory_balances where part_id=line->>'partId' and location_id=payload->>'sourceLocation') then raise exception 'Part is not stocked at the source location.'; end if;
    insert into public.stock_order_lines(order_id,part_id,quantity,description,unit)
      select identifier,line->>'partId',(line->>'quantity')::numeric,name,unit from public.inventory where id=line->>'partId';
  end loop;
  insert into public.audit(actor,action,detail) values(auth.uid(),'shipment.create',jsonb_build_object('id',identifier,'kind',payload->>'kind'));
  return identifier;
end $$;

create function public.transition_stock_order(order_id uuid, action text, expected_revision integer, carrier_value text default null, tracking_value text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare shipment public.stock_orders; line record; balance public.inventory_balances; next_status text; delta numeric; reservation numeric; target text;
begin
  perform private.require_role(array['admin','manager','estimator']); perform pg_advisory_xact_lock(7600241);
  select * into shipment from public.stock_orders where id=order_id for update;
  if not found then raise exception 'Shipment not found.'; end if;
  if shipment.revision<>expected_revision then raise exception 'Shipment changed. Refresh before applying this action.'; end if;
  if action='hold' and shipment.status='draft' then next_status:='held';
  elsif action='dispatch' and shipment.status='held' then next_status:='dispatched';
  elsif action='cancel' and shipment.status in ('draft','held') then next_status:='cancelled';
  elsif action='receive' and shipment.status='dispatched' and shipment.kind='transfer' then next_status:='received';
  elsif action='deliver' and shipment.status='dispatched' and shipment.kind='customer' then next_status:='delivered';
  else raise exception 'This action is not valid for the current shipment state.'; end if;
  for line in select * from public.stock_order_lines where stock_order_lines.order_id=shipment.id order by part_id loop
    delta:=0; reservation:=0; target:=shipment.source_location;
    if action='receive' then
      target:=shipment.destination_location;
      if not exists(select 1 from public.locations where id=target and active) then raise exception 'Receiving location is inactive.'; end if;
      insert into public.inventory_balances(part_id,location_id,stock) values(line.part_id,target,0) on conflict do nothing;
      delta:=line.quantity;
    else
      select * into balance from public.inventory_balances where part_id=line.part_id and location_id=target for update;
      if action='hold' then
        if balance.stock-balance.reserved<line.quantity then raise exception 'Insufficient available stock for %. Nothing was reserved.',line.part_id; end if;
        reservation:=line.quantity;
      elsif action='dispatch' then delta:=-line.quantity; reservation:=-line.quantity;
      elsif action='cancel' and shipment.status='held' then reservation:=-line.quantity;
      end if;
    end if;
    if delta<>0 or reservation<>0 then
      update public.inventory_balances set stock=stock+delta,reserved=reserved+reservation where part_id=line.part_id and location_id=target;
      insert into public.stock_movements(part_id,location_id,order_id,event,stock_delta,reserved_delta,actor) values(line.part_id,target,shipment.id,action,delta,reservation,auth.uid());
      update public.inventory set stock=(select sum(stock) from public.inventory_balances where part_id=line.part_id) where id=line.part_id;
    end if;
  end loop;
  if char_length(coalesce(carrier_value,''))>100 or char_length(coalesce(tracking_value,''))>200 then raise exception 'Carrier or tracking value is too long.'; end if;
  update public.stock_orders set status=next_status,revision=revision+1,updated=now(),carrier=coalesce(carrier_value,carrier),tracking=coalesce(tracking_value,tracking) where id=shipment.id;
  insert into public.audit(actor,action,detail) values(auth.uid(),'shipment.'||action,jsonb_build_object('id',shipment.id,'from',shipment.status,'to',next_status));
  return jsonb_build_object('id',shipment.id,'status',next_status,'revision',shipment.revision+1);
end $$;

revoke all on function public.inventory_listing(text,boolean),public.create_stock_order(jsonb),public.transition_stock_order(uuid,text,integer,text,text),public.save_location(jsonb) from public,anon;
grant execute on function public.inventory_listing(text,boolean),public.create_stock_order(jsonb),public.transition_stock_order(uuid,text,integer,text,text),public.save_location(jsonb) to authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
commit;