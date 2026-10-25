-- Site on / off. While off, nobody (admins too) gets any data: is_staff / is_admin / has_perm say no, so every RLS policy
-- and function refuses; the Next.js proxy shows "site closed". Only the power admin (staff.is_poweradmin) still works and
-- switches it at /power. Not shown on the Users page and not changeable there. Emergency: scripts/site_switch.py on.

alter table public.staff add column is_poweradmin boolean not null default false;
alter table public.app_settings
  add column site_off boolean not null default false,
  add column site_off_message text check (length(site_off_message) <= 500),
  add column site_off_changed_at timestamptz,
  add column site_off_changed_by uuid;

create or replace function app_private.is_power()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.active and s.is_poweradmin
                  and app_private.session_ok(s.force_logout_at));
$$;

create or replace function app_private.site_open()
returns boolean language sql stable security definer set search_path = '' as $$
  select not coalesce((select site_off from public.app_settings where id = 1), false) or app_private.is_power();
$$;
revoke all on function app_private.is_power() from public, anon, authenticated;
revoke all on function app_private.site_open() from public, anon, authenticated;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.active and app_private.session_ok(s.force_logout_at))
         and app_private.site_open();
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.active and s.role = 'admin'
                  and app_private.session_ok(s.force_logout_at))
         and app_private.site_open();
$$;

create or replace function public.has_perm(p text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s
                  where s.user_id = (select auth.uid()) and s.active and app_private.session_ok(s.force_logout_at)
                    and (s.role = 'admin' or p = any (s.permissions)))
         and app_private.site_open();
$$;

-- for the proxy and the closed page (anyone may ask; "power" is only true for the signed-in power admin)
create or replace function public.site_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'off', coalesce(s.site_off, false),
    'message', case when s.site_off then coalesce(s.site_off_message, 'The site is closed for some time. Please come back later.') end,
    'changed_at', s.site_off_changed_at,
    'power', app_private.is_power())
  from public.app_settings s where s.id = 1;
$$;
revoke all on function public.site_status() from public;
grant execute on function public.site_status() to anon, authenticated;

create or replace function public.set_site_power(p_off boolean, p_message text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_msg text := left(nullif(btrim(p_message), ''), 500);
begin
  if not app_private.is_power() then raise exception 'only the power admin can do this' using errcode = '42501'; end if;
  if p_off is null then raise exception 'say on or off' using errcode = '22023'; end if;
  update public.app_settings
     set site_off = p_off, site_off_message = case when p_off then v_msg end,
         site_off_changed_at = now(), site_off_changed_by = auth.uid()
   where id = 1;
  perform app_private.log(case when p_off then 'site_off' else 'site_on' end, null, null,
    jsonb_build_object('message', case when p_off then v_msg end, 'from', 'power page'));
  return public.site_status();
end $$;
revoke all on function public.set_site_power(boolean, text) from public, anon;
grant execute on function public.set_site_power(boolean, text) to authenticated;

-- the Users page neither lists nor changes the power admin
do $$
declare d text; f text;
begin
  d := pg_get_functiondef('public.admin_list_users()'::regprocedure);
  d := replace(d, 'from public.staff s join auth.users u on u.id = s.user_id
     order by', 'from public.staff s join auth.users u on u.id = s.user_id
     where not s.is_poweradmin
     order by');
  if position('where not s.is_poweradmin' in d) = 0 then raise exception 'admin_list_users: marker not found'; end if;
  execute d;

  foreach f in array array['public.admin_update_user(uuid,text,text,boolean,text[])', 'public.admin_set_password(uuid,text)',
                           'public.admin_sign_out_user(uuid)', 'public.admin_archive_user(uuid,boolean)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('p_user' in d) = 0 then raise exception '%: p_user not found', f; end if;
    -- right after the first "begin"
    d := regexp_replace(d, '\mbegin\M', 'begin
  if exists (select 1 from public.staff where user_id = p_user and is_poweradmin) then
    raise exception ''this login cannot be changed here'' using errcode = ''42501'';
  end if;', '');
    if position('this login cannot be changed here' in d) = 0 then raise exception '%: begin not found', f; end if;
    execute d;
  end loop;
end $$;
