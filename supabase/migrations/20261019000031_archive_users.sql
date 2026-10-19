-- Remove a user (archive): login off, signed out everywhere, hidden from lists and drop-downs.
-- Their name stays on everything they did. Open receipt books are closed and future collection lists cleared.
-- Restore brings them back to the list (switched off; the admin turns the login on again if wanted).

alter table public.staff add column if not exists archived_at timestamptz;

create or replace function public.admin_archive_user(p_user uuid, p_archive boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_name text; v_books int := 0; v_lists int := 0;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if p_user = (select auth.uid()) then raise exception 'you cannot remove yourself' using errcode = '22023'; end if;
  select full_name into v_name from public.staff where user_id = p_user;
  if not found then raise exception 'user not found' using errcode = '22023'; end if;

  if p_archive then
    if (select role from public.staff where user_id = p_user) = 'admin'
       and (select count(*) from public.staff where role = 'admin' and active and archived_at is null and user_id <> p_user) = 0 then
      raise exception 'this is the last admin; make someone else admin first' using errcode = '22023';
    end if;
    update public.staff set archived_at = now(), active = false, force_logout_at = now() where user_id = p_user;
    delete from auth.refresh_tokens where user_id = p_user::text;
    delete from auth.sessions where user_id = p_user;
    update public.receipt_books set closed_at = now() where user_id = p_user and closed_at is null;
    get diagnostics v_books = row_count;
    delete from public.collection_assignments where user_id = p_user and day >= (now() at time zone 'Asia/Kolkata')::date;
    get diagnostics v_lists = row_count;
    perform app_private.log('user_archived', v_name, null, jsonb_build_object('books_closed', v_books, 'list_entries_removed', v_lists));
  else
    update public.staff set archived_at = null where user_id = p_user;
    perform app_private.log('user_restored', v_name, null, '{}');
  end if;
  return jsonb_build_object('books_closed', v_books, 'list_entries_removed', v_lists);
end;
$$;

-- the Users page: + archived_at
drop function if exists public.admin_list_users();
create or replace function public.admin_list_users()
returns table (user_id uuid, email text, full_name text, role text, active boolean, permissions text[], last_sign_in_at timestamptz,
               created_at timestamptz, archived_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  return query
    select s.user_id, u.email::text, s.full_name, s.role, s.active, s.permissions, u.last_sign_in_at, s.created_at, s.archived_at
      from public.staff s join auth.users u on u.id = s.user_id
     order by s.archived_at is not null, s.active desc, (s.role = 'admin') desc, s.full_name;
end;
$$;

-- drop-downs: removed people are left out (the activity filter asks for everyone)
drop function if exists public.staff_names();
create or replace function public.staff_names(p_all boolean default false)
returns table (user_id uuid, full_name text, active boolean)
language sql stable security definer set search_path = '' as $$
  select s.user_id, s.full_name || case when s.archived_at is not null then ' (removed)' else '' end, s.active
    from public.staff s
   where (public.has_perm('cash') or public.has_perm('activity') or public.has_perm('approve') or public.has_perm('assign'))
     and (p_all or s.archived_at is null)
   order by s.archived_at is not null, s.active desc, s.full_name;
$$;

-- switching a removed user's login back on is not allowed while removed
do $$
declare d text; m text := 'update public.staff
     set full_name = btrim(p_name), role = p_role, active = p_active,';
begin
  d := pg_get_functiondef('public.admin_update_user(uuid,text,text,boolean,text[])'::regprocedure);
  if position(m in d) = 0 then raise exception 'admin_update_user marker not found'; end if;
  execute replace(d, m, 'if p_active and exists (select 1 from public.staff where user_id = p_user and archived_at is not null) then
    raise exception ''this user is removed; restore them first'' using errcode = ''22023'';
  end if;
  ' || m);
end $$;

revoke execute on function public.admin_archive_user(uuid, boolean), public.admin_list_users(), public.staff_names(boolean) from anon, public;
grant execute on function public.admin_archive_user(uuid, boolean), public.admin_list_users(), public.staff_names(boolean) to authenticated;
