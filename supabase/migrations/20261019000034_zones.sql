-- Zones: a list of areas (admin keeps it), each with its own receipt number series.
-- A zone's series runs from its start number up to just before the next zone's start number.
-- Loans / old accounts keep the zone as text (as before); it is matched to this list by name, ignoring case.

create table public.zones (
  id             bigint generated always as identity primary key,
  name           text not null check (length(btrim(name)) between 1 and 60),
  receipt_start  bigint not null check (receipt_start > 0),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid() references auth.users (id)
);
create unique index zones_name_key on public.zones (upper(btrim(name)));
create unique index zones_receipt_start_key on public.zones (receipt_start);

create index if not exists legacy_payments_receipt_no_idx on public.legacy_payments (receipt_no);

alter table public.zones enable row level security;
create policy "staff read zones" on public.zones for select to authenticated using ((select public.is_staff()));
revoke all on public.zones from anon;
revoke insert, update, delete, truncate on public.zones from authenticated;
grant select on public.zones to authenticated;

-- each zone with the end of its series, the last receipt used in it and the next free one
create or replace function public.zone_status()
returns table (id bigint, name text, receipt_start bigint, receipt_end bigint, active boolean, last_used bigint, next_no bigint, accounts int)
language sql stable security definer set search_path = '' as $$
  with z as (
    select z.*, lead(z.receipt_start) over (order by z.receipt_start) - 1 as receipt_end from public.zones z
  ),
  used as (
    select z.id,
           (select max(n) from (
              select max(receipt_no) n from public.payments where receipt_no >= z.receipt_start and (z.receipt_end is null or receipt_no <= z.receipt_end)
              union all
              select max(receipt_no) from public.pending_payments where receipt_no >= z.receipt_start and (z.receipt_end is null or receipt_no <= z.receipt_end)
              union all
              select max(receipt_no) from public.legacy_payments where receipt_no >= z.receipt_start and (z.receipt_end is null or receipt_no <= z.receipt_end)
            ) x) as last_used
      from z
  )
  select z.id, z.name, z.receipt_start, z.receipt_end, z.active, u.last_used,
         case when u.last_used is null then z.receipt_start
              when z.receipt_end is null or u.last_used < z.receipt_end then u.last_used + 1 end,
         ((select count(*) from public.loans l where upper(btrim(l.zone)) = upper(btrim(z.name)))
          + (select count(*) from public.legacy_accounts a where upper(btrim(a.zone)) = upper(btrim(z.name))))::int
    from z join used u on u.id = z.id
   where public.is_staff()
   order by z.receipt_start;
$$;

create or replace function public.admin_zone(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
-- p = { action: add | edit | hide | show | delete, id, name, receipt_start }
declare z public.zones; v_start bigint;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if p ->> 'action' in ('add', 'edit') then
    if nullif(btrim(p ->> 'name'), '') is null then raise exception 'enter the zone name' using errcode = '22023'; end if;
    v_start := (p ->> 'receipt_start')::bigint;
    if v_start is null or v_start <= 0 then raise exception 'enter the first receipt number of the zone' using errcode = '22023'; end if;
  end if;
  begin
    if p ->> 'action' = 'add' then
      insert into public.zones (name, receipt_start) values (upper(btrim(p ->> 'name')), v_start) returning * into z;
      perform app_private.log('zone_add', z.name, null, jsonb_build_object('receipt_start', z.receipt_start));
      return jsonb_build_object('id', z.id);
    end if;
    select * into z from public.zones where id = (p ->> 'id')::bigint for update;
    if not found then raise exception 'zone not found' using errcode = 'P0002'; end if;
    if p ->> 'action' = 'edit' then
      update public.zones set name = upper(btrim(p ->> 'name')), receipt_start = v_start where id = z.id;
      -- keep the accounts on the zone when it is renamed
      if upper(btrim(p ->> 'name')) <> z.name then
        update public.loans set zone = upper(btrim(p ->> 'name')) where upper(btrim(zone)) = z.name;
        update public.legacy_accounts set zone = upper(btrim(p ->> 'name')) where upper(btrim(zone)) = z.name;
      end if;
      perform app_private.log('zone_edit', upper(btrim(p ->> 'name')), null, jsonb_build_object(
        'changes', jsonb_build_object('name', jsonb_build_object('from', z.name, 'to', upper(btrim(p ->> 'name'))),
                                      'receipt_start', jsonb_build_object('from', z.receipt_start, 'to', v_start))));
    elsif p ->> 'action' in ('hide', 'show') then
      update public.zones set active = (p ->> 'action' = 'show') where id = z.id;
      perform app_private.log('zone_' || (p ->> 'action'), z.name, null, '{}'::jsonb);
    elsif p ->> 'action' = 'delete' then
      if exists (select 1 from public.loans where upper(btrim(zone)) = z.name)
         or exists (select 1 from public.legacy_accounts where upper(btrim(zone)) = z.name) then
        raise exception 'accounts are in this zone; hide it instead' using errcode = '22023';
      end if;
      delete from public.zones where id = z.id;
      perform app_private.log('zone_delete', z.name, null, jsonb_build_object('receipt_start', z.receipt_start));
    else
      raise exception 'bad action' using errcode = '22023';
    end if;
  exception when unique_violation then
    if sqlerrm like '%receipt_start%' then raise exception 'another zone already starts at that receipt number' using errcode = '22023'; end if;
    raise exception 'a zone with this name already exists' using errcode = '22023';
  end;
  return jsonb_build_object('id', z.id);
end;
$$;

-- receipt hint: also the account's zone series (when the account is in a zone)
drop function if exists public.receipt_hint();
create or replace function public.receipt_hint(p_source text default null, p_ref bigint default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with acc_zone as (
    select case p_source
             when 'old' then (select zone from public.legacy_accounts where sno = p_ref)
             when 'new' then (select zone from public.loans where id = p_ref)
           end as zone
  )
  select jsonb_build_object(
    'last_app', (select max(n) from (select max(receipt_no) n from public.payments union all select max(receipt_no) from public.pending_payments) x),
    'last_mine', (select max(n) from (select max(receipt_no) n from public.payments where created_by = auth.uid()
                                      union all select max(receipt_no) from public.pending_payments where created_by = auth.uid()) x),
    'last_old', (select max(receipt_no) from public.legacy_payments),
    'books', coalesce((select jsonb_agg(jsonb_build_object('from', b.from_no, 'to', b.to_no,
                 'next', (select min(n) from generate_series(b.from_no, b.to_no) n
                           where not exists (select 1 from public.payments where receipt_no = n)
                             and not exists (select 1 from public.pending_payments where receipt_no = n))) order by b.from_no)
               from public.receipt_books b where b.user_id = auth.uid() and b.closed_at is null), '[]'),
    'zone', (select jsonb_build_object('name', s.name, 'start', s.receipt_start, 'end', s.receipt_end, 'last', s.last_used, 'next', s.next_no)
               from public.zone_status() s, acc_zone a
              where upper(btrim(a.zone)) = upper(s.name))
  )
  where public.has_perm('collect');
$$;

-- zones go into backups / restore points
create or replace function app_private.data_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['import_batches','legacy_accounts','legacy_payments','borrowers','loans','payments','seizures','adjustments',
               'receipt_books','cash_closings','collection_assignments','pending_payments','zones'];
$$;

revoke execute on all functions in schema app_private from public, anon, authenticated;
revoke execute on function public.zone_status(), public.admin_zone(jsonb), public.receipt_hint(text, bigint) from anon, public;
grant execute on function public.zone_status(), public.admin_zone(jsonb), public.receipt_hint(text, bigint) to authenticated;
