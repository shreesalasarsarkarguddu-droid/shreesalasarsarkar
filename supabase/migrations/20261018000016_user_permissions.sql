-- Staff accounts with per-user permissions, managed by admins from the app.
--   admin  = everything (+ users, settings, backup)
--   staff  = only the permissions ticked for that person
-- Permissions: view_accounts, collect, new_loan, seize, reports
-- Everything is enforced in the database (RLS + the RPC functions); the app only hides what you can't use.
-- Logins are created from SQL (admin-only functions below), so the Supabase secret key is never needed on the web server.

alter table public.staff
  add column if not exists active      boolean not null default true,
  add column if not exists permissions text[]  not null default '{}';

-- keep today's behaviour for existing non-admin logins
update public.staff set permissions = array['view_accounts','collect','new_loan','seize','reports'] where role = 'staff' and permissions = '{}';

alter table public.staff add constraint staff_permissions_check
  check (permissions <@ array['view_accounts','collect','new_loan','seize','reports']);

-- ---------------------------------------------------------------- checks
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.active);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.active and s.role = 'admin');
$$;

create or replace function public.has_perm(p text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s
                  where s.user_id = (select auth.uid()) and s.active
                    and (s.role = 'admin' or p = any (s.permissions)));
$$;
revoke execute on function public.has_perm(text) from anon, public;
grant execute on function public.has_perm(text) to authenticated;

-- ---------------------------------------------------------------- table access
drop policy "staff read borrowers"   on public.borrowers;
drop policy "staff create borrowers" on public.borrowers;
drop policy "staff read imports"     on public.import_batches;
drop policy "staff read accounts"    on public.legacy_accounts;
drop policy "staff read payments"    on public.legacy_payments;
drop policy "staff read loans"       on public.loans;
drop policy "staff create loans"     on public.loans;
drop policy "staff read payments"    on public.payments;
drop policy "staff create payments"  on public.payments;
drop policy "staff read seizures"    on public.seizures;

create policy "read borrowers"       on public.borrowers       for select to authenticated using ((select public.has_perm('view_accounts')));
create policy "read imports"         on public.import_batches  for select to authenticated using ((select public.has_perm('view_accounts')));
create policy "read accounts"        on public.legacy_accounts for select to authenticated using ((select public.has_perm('view_accounts')));
create policy "read legacy payments" on public.legacy_payments for select to authenticated using ((select public.has_perm('view_accounts')));
create policy "read loans"           on public.loans           for select to authenticated using ((select public.has_perm('view_accounts')));
create policy "read payments"        on public.payments        for select to authenticated using ((select public.has_perm('view_accounts')));
create policy "read seizures"        on public.seizures        for select to authenticated using ((select public.has_perm('view_accounts')));

-- (writes go through the functions below; direct inserts need the same permission)
create policy "create borrowers" on public.borrowers for insert to authenticated
  with check ((select public.has_perm('new_loan')) and created_by = (select auth.uid()));
create policy "create loans" on public.loans for insert to authenticated
  with check ((select public.has_perm('new_loan')) and created_by = (select auth.uid()));
create policy "create payments" on public.payments for insert to authenticated
  with check ((select public.has_perm('collect')) and created_by = (select auth.uid()));

-- ---------------------------------------------------------------- write functions: swap the is_staff() guard for the right permission
do $$
declare r record; d text;
begin
  for r in select * from (values
      ('public.create_loan(jsonb)',   'new_loan'),
      ('public.record_payment(jsonb)', 'collect'),
      ('public.set_seized(jsonb)',    'seize')) as v(fn, perm)
  loop
    d := pg_get_functiondef(r.fn::regprocedure);
    if position('public.is_staff()' in d) = 0 then raise exception 'guard not found in %', r.fn; end if;
    execute replace(d, 'public.is_staff()', format('public.has_perm(%L)', r.perm));
  end loop;
end $$;

-- ---------------------------------------------------------------- admin: user management
create or replace function public.admin_list_users()
returns table (user_id uuid, email text, full_name text, role text, active boolean, permissions text[], last_sign_in_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  return query
    select s.user_id, u.email::text, s.full_name, s.role, s.active, s.permissions, u.last_sign_in_at, s.created_at
      from public.staff s join auth.users u on u.id = s.user_id
     order by s.active desc, (s.role = 'admin') desc, s.full_name;
end;
$$;

-- clean a permission list: only known keys; anything at all implies view_accounts
create or replace function app_private.clean_perms(p text[])
returns text[] language sql immutable set search_path = '' as $$
  select case when cardinality(x) = 0 then x else (select array_agg(distinct k order by k) from unnest(x || array['view_accounts']) k) end
  from (select coalesce(array(select k from unnest(p) k where k = any (array['view_accounts','collect','new_loan','seize','reports'])), '{}') as x) q;
$$;

create or replace function public.admin_create_user(p_email text, p_name text, p_password text, p_role text, p_perms text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(p_email)); v_id uuid := gen_random_uuid();
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'enter a valid email' using errcode = '22023'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'password must be at least 8 characters' using errcode = '22023'; end if;
  if nullif(btrim(p_name), '') is null then raise exception 'enter the person''s name' using errcode = '22023'; end if;
  if p_role not in ('admin', 'staff') then raise exception 'bad role' using errcode = '22023'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then raise exception 'that email already has a login' using errcode = '23505'; end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', btrim(p_name)), now(), now(),
          '', '', '', '');
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          'email', v_id::text, null, now(), now());
  insert into public.staff (user_id, full_name, role, active, permissions)
  values (v_id, btrim(p_name), p_role, true, case when p_role = 'admin' then '{}' else app_private.clean_perms(p_perms) end);
  return v_id;
end;
$$;

create or replace function public.admin_update_user(p_user uuid, p_name text, p_role text, p_active boolean, p_perms text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if nullif(btrim(p_name), '') is null then raise exception 'enter the person''s name' using errcode = '22023'; end if;
  if p_role not in ('admin', 'staff') then raise exception 'bad role' using errcode = '22023'; end if;
  if p_user = (select auth.uid()) and (p_role <> 'admin' or not p_active) then
    raise exception 'you cannot remove your own admin access or switch yourself off' using errcode = '22023';
  end if;
  update public.staff
     set full_name = btrim(p_name), role = p_role, active = p_active,
         permissions = case when p_role = 'admin' then '{}' else app_private.clean_perms(p_perms) end
   where user_id = p_user;
  if not found then raise exception 'user not found' using errcode = '22023'; end if;
  if not p_active then delete from auth.sessions where user_id = p_user; end if;   -- sign them out everywhere
end;
$$;

create or replace function public.admin_set_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'password must be at least 8 characters' using errcode = '22023'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = p_user;
  if not found then raise exception 'user not found' using errcode = '22023'; end if;
  delete from auth.sessions where user_id = p_user;
end;
$$;

revoke execute on function public.admin_list_users(), public.admin_create_user(text, text, text, text, text[]),
  public.admin_update_user(uuid, text, text, boolean, text[]), public.admin_set_password(uuid, text) from anon, public;
grant execute on function public.admin_list_users(), public.admin_create_user(text, text, text, text, text[]),
  public.admin_update_user(uuid, text, text, boolean, text[]), public.admin_set_password(uuid, text) to authenticated;
revoke execute on function app_private.clean_perms(text[]) from public, anon, authenticated;
