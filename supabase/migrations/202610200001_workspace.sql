begin;

create schema if not exists private;
revoke all on schema private from public;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  email text not null unique,
  role text not null check (role in ('admin','manager','engineer','estimator','technician','viewer')),
  disabled boolean not null default false,
  address text not null default '', phone text not null default '',
  department text not null default '', job_title text not null default '',
  created_at timestamptz not null default now()
);

create function public.workspace_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and not disabled
    and (auth.jwt()->>'aal' = 'aal2' or not exists (
      select 1 from auth.mfa_factors where user_id = auth.uid() and status = 'verified'
    ))
$$;
revoke all on function public.workspace_role() from public;
grant execute on function public.workspace_role() to authenticated;

create table public.inventory (
  id text primary key check (char_length(id) between 1 and 64),
  name text not null check (char_length(name) between 1 and 120),
  category text not null check (char_length(category) between 1 and 80),
  unit text not null check (char_length(unit) between 1 and 24),
  stock numeric not null check (stock between 0 and 1000000000),
  reorder numeric not null default 0 check (reorder between 0 and 1000000000),
  location text not null default '', supplier text not null default ''
);
create table public.inventory_costs (
  id text primary key references public.inventory(id) on delete cascade,
  price numeric check (price between 0 and 100000000)
);
create table public.projects (
  id bigint generated always as identity primary key,
  name text not null, building jsonb not null,
  author uuid not null references public.profiles(id),
  owner uuid references public.profiles(id),
  client text not null default '', location text not null default '',
  status text not null default 'Planning' check (status in ('Planning','Design','Review','On hold','Completed','Archived')),
  due_date text not null default '', notes text not null default '',
  revision integer not null default 1 check (revision > 0),
  updated timestamptz not null default now()
);
create table public.tickets (
  id bigint generated always as identity primary key,
  title text not null, description text not null, category text not null,
  priority text not null check (priority in ('Low','Normal','High','Urgent')),
  status text not null default 'Open' check (status in ('Open','In progress','Waiting on user','Resolved','Closed')),
  reporter uuid not null references public.profiles(id),
  assignee uuid references public.profiles(id),
  project_id bigint references public.projects(id),
  created timestamptz not null default now(), updated timestamptz not null default now()
);
create table public.ticket_messages (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references public.tickets(id) on delete cascade,
  author uuid not null references public.profiles(id), body text not null,
  created timestamptz not null default now()
);
create table public.workspace_settings (id text primary key, value jsonb not null);
insert into public.workspace_settings values ('general', '{"name":"Accu-Steel workspace","supportEmail":""}');
create table public.audit (
  id bigint generated always as identity primary key,
  actor uuid references public.profiles(id), action text not null,
  detail jsonb not null default '{}', created timestamptz not null default now()
);
create table public.inventory_imports (
  id uuid primary key default gen_random_uuid(), actor uuid not null references public.profiles(id),
  payload jsonb not null, expires timestamptz not null
);

alter table public.profiles enable row level security;
alter table public.inventory enable row level security;
alter table public.inventory_costs enable row level security;
alter table public.projects enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.audit enable row level security;
alter table public.inventory_imports enable row level security;

revoke all on public.profiles, public.inventory, public.inventory_costs, public.projects, public.tickets, public.ticket_messages, public.workspace_settings, public.audit, public.inventory_imports from anon, authenticated;
grant select on public.profiles, public.inventory, public.inventory_costs, public.projects, public.tickets, public.ticket_messages, public.workspace_settings, public.audit to authenticated;
grant all on public.profiles, public.inventory, public.inventory_costs, public.projects, public.tickets, public.ticket_messages, public.workspace_settings, public.audit, public.inventory_imports to service_role;
grant usage, select on all sequences in schema public to service_role;

create policy profile_read on public.profiles for select to authenticated
  using (public.workspace_role() is not null and (id = auth.uid() or public.workspace_role() = 'admin'));
create policy inventory_read on public.inventory for select to authenticated using (public.workspace_role() is not null);
create policy costs_read on public.inventory_costs for select to authenticated using (public.workspace_role() in ('admin','manager','engineer','estimator'));
create policy projects_read on public.projects for select to authenticated using (public.workspace_role() is not null);
create policy tickets_read on public.tickets for select to authenticated
  using (public.workspace_role() is not null and (reporter = auth.uid() or public.workspace_role() in ('admin','technician')));
create policy messages_read on public.ticket_messages for select to authenticated
  using (exists(select 1 from public.tickets where tickets.id = ticket_messages.ticket_id));
create policy settings_read on public.workspace_settings for select to authenticated
  using (public.workspace_role() is not null and id = 'general');
create policy audit_read on public.audit for select to authenticated using (public.workspace_role() = 'admin');

create view public.staff_directory as
  select id, name, role from public.profiles where not disabled and public.workspace_role() is not null;
revoke all on public.staff_directory from anon, public;
grant select on public.staff_directory to authenticated, service_role;

create function private.require_role(allowed text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.workspace_role() = any(allowed), false) then
    raise exception 'Your account does not permit this operation.' using errcode = '42501';
  end if;
end $$;

create function private.inventory_snapshot(part_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',i.id,'name',i.name,'category',i.category,'unit',i.unit,'stock',i.stock,
    'price',c.price,'reorder',i.reorder,'location',i.location,'supplier',i.supplier)
  from public.inventory i left join public.inventory_costs c on c.id=i.id where i.id=part_id
$$;

create function private.write_inventory(item jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.inventory(id,name,category,unit,stock,reorder,location,supplier)
    values(item->>'id',item->>'name',item->>'category',item->>'unit',(item->>'stock')::numeric,
      (item->>'reorder')::numeric,coalesce(item->>'location',''),coalesce(item->>'supplier',''))
    on conflict(id) do update set name=excluded.name, category=excluded.category, unit=excluded.unit,
      stock=excluded.stock,reorder=excluded.reorder,location=excluded.location,supplier=excluded.supplier;
  insert into public.inventory_costs(id,price) values(item->>'id',(item->>'price')::numeric)
    on conflict(id) do update set price=excluded.price;
end $$;

create function public.save_inventory(item jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_role(array['admin','estimator']);
  perform pg_advisory_xact_lock(7600241);
  perform private.write_inventory(item);
  insert into public.audit(actor,action,detail) values(auth.uid(),'inventory.save',jsonb_build_object('id',item->>'id'));
end $$;

create function public.apply_inventory_import(preview_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare preview public.inventory_imports; entry jsonb;
begin
  perform private.require_role(array['admin','estimator']);
  perform pg_advisory_xact_lock(7600241);
  select * into preview from public.inventory_imports where id=preview_id and actor=auth.uid() and expires>now() for update;
  if not found then raise exception 'Preview expired or already applied. Preview again.'; end if;
  for entry in select value from jsonb_array_elements(preview.payload->'rows') loop
    if coalesce(private.inventory_snapshot(entry->'item'->>'id'),'null'::jsonb) is distinct from coalesce(entry->'before','null'::jsonb) then
      raise exception 'Inventory changed since preview. No rows were imported. Preview again.';
    end if;
  end loop;
  for entry in select value from jsonb_array_elements(preview.payload->'rows') loop
    perform private.write_inventory(entry->'item');
  end loop;
  delete from public.inventory_imports where id=preview_id;
  insert into public.audit(actor,action,detail) values(auth.uid(),'inventory.import',jsonb_build_object('fileName',preview.payload->>'fileName','counts',preview.payload->'counts'));
  return preview.payload->'counts';
end $$;

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.save_inventory(jsonb), public.apply_inventory_import(uuid) from public, anon;
grant execute on function public.save_inventory(jsonb), public.apply_inventory_import(uuid) to authenticated;

commit;