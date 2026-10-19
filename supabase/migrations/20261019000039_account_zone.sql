-- Set an account's zone from the collection screens (Collect window, account page, loan page).
--   * no zone yet (or a name not in the zone list): anyone who collects can set it
--   * already in a zone: only "fix mistakes" (admin) can change it
--   * DHAMTARI = no zone (main book). Receipts already written stay in their book; new ones go to the new zone's book.
--   * an old account's zone set here is kept when the old software's files are imported again

alter table public.legacy_accounts add column if not exists zone_set_in_app boolean not null default false;

-- the account's zone, the zone list and whether this person may change it
create or replace function public.account_zone_info(p_source text, p_ref bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  with cur as (select app_private.ref_zone(p_source, p_ref) as zone),
  known as (select z.name from public.zones z, cur where z.name = upper(btrim(cur.zone)))
  select jsonb_build_object(
    'zone', (select case when (select name from known) is not null then (select name from known) else nullif(btrim(zone), '') end from cur),
    'in_list', exists (select 1 from known),
    'zones', coalesce((select jsonb_agg(name order by name) from public.zones where active), '[]'),
    'can_change', case when exists (select 1 from known) then public.has_perm('fix_entries')
                       else public.has_perm('collect') or public.has_perm('fix_entries') end)
  where public.has_perm('view_accounts') or public.has_perm('collect');
$$;

create or replace function public.set_account_zone(p_source text, p_ref bigint, p_zone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_old text; v_new text := nullif(upper(btrim(coalesce(p_zone, ''))), ''); v_in_list boolean; r jsonb;
begin
  if p_source = 'old' then
    select zone into v_old from public.legacy_accounts where sno = p_ref for update;
    if not found then raise exception 'account not found' using errcode = 'P0002'; end if;
  elsif p_source = 'new' then
    select zone into v_old from public.loans where id = p_ref for update;
    if not found then raise exception 'loan not found' using errcode = 'P0002'; end if;
  else
    raise exception 'bad source' using errcode = '22023';
  end if;

  v_in_list := exists (select 1 from public.zones where name = upper(btrim(v_old)));
  if v_in_list and not public.has_perm('fix_entries') then
    raise exception 'only admin can change a zone that is already set' using errcode = '42501';
  end if;
  if not v_in_list and not (public.has_perm('collect') or public.has_perm('fix_entries')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_new is not null and not exists (select 1 from public.zones where name = v_new and active) then
    raise exception 'choose a zone from the list' using errcode = '22023';
  end if;
  if coalesce(upper(btrim(v_old)), '') = coalesce(v_new, '') then
    return jsonb_build_object('zone', v_new, 'changed', false);
  end if;

  if p_source = 'old' then
    update public.legacy_accounts set zone = v_new, zone_set_in_app = true where sno = p_ref;
  else
    update public.loans set zone = v_new where id = p_ref;
  end if;

  r := app_private.acct_ref((select id from public.legacy_accounts where p_source = 'old' and sno = p_ref),
                            case when p_source = 'new' then p_ref end);
  perform app_private.log('zone_changed', r ->> 'subject', r - 'subject',
    jsonb_build_object('from', coalesce(nullif(btrim(v_old), ''), 'DHAMTARI'), 'to', coalesce(v_new, 'DHAMTARI')));
  return jsonb_build_object('zone', v_new, 'changed', true);
end;
$$;

-- importing the old software's files again keeps a zone set in the app
do $$
declare d text;
begin
  d := pg_get_functiondef('public.admin_import_commit'::regproc);
  if position('zone = excluded.zone,' in d) = 0 then raise exception 'admin_import_commit: marker not found'; end if;
  execute replace(d, 'zone = excluded.zone,',
    'zone = case when public.legacy_accounts.zone_set_in_app then public.legacy_accounts.zone else excluded.zone end,');
end $$;

revoke execute on function public.account_zone_info(text, bigint), public.set_account_zone(text, bigint, text) from anon, public;
grant execute on function public.account_zone_info(text, bigint), public.set_account_zone(text, bigint, text) to authenticated;
