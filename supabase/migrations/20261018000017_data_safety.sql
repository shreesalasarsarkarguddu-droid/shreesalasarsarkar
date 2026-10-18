-- Data safety: restore points, delete data, restore, audit log (admin only).
--
-- Restore point = a full copy of every business table, kept inside the database (app_private, not reachable
-- from the API). One is made automatically before every delete / import / restore, so any of those can be undone
-- even if nobody downloaded a backup. The newest 5 are kept.
--
-- Business tables (in parent -> child order):
--   import_batches, legacy_accounts, legacy_payments   = data from the old software
--   borrowers, loans, payments, seizures                = entered in this app
-- Users (staff / logins), settings and the notification log are never touched.

-- ---------------------------------------------------------------- triggers: stay quiet while restoring
-- (restoring payments must not send every receipt again on Telegram / WhatsApp)
drop trigger payments_notify on public.payments;
drop trigger loans_notify on public.loans;
drop trigger seizures_notify on public.seizures;
create trigger payments_notify after insert on public.payments for each row
  when (coalesce(current_setting('app.restoring', true), '') <> 'on') execute function app_private.on_payment();
create trigger loans_notify after insert on public.loans for each row
  when (coalesce(current_setting('app.restoring', true), '') <> 'on') execute function app_private.on_new_loan();
create trigger seizures_notify after insert on public.seizures for each row
  when (coalesce(current_setting('app.restoring', true), '') <> 'on') execute function app_private.on_seizure();

-- ---------------------------------------------------------------- audit log
create table public.data_audit (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  by_user    uuid references auth.users (id) on delete set null,
  by_name    text,
  action     text not null,          -- restore_point / delete / restore / import
  details    jsonb not null default '{}'
);
alter table public.data_audit enable row level security;
create policy "admin reads data audit" on public.data_audit for select to authenticated using ((select public.is_admin()));
revoke all on public.data_audit from anon;
revoke insert, update, delete, truncate on public.data_audit from authenticated;
grant select on public.data_audit to authenticated;

create or replace function app_private.audit(p_action text, p_details jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.data_audit (by_user, by_name, action, details)
  values ((select auth.uid()), (select full_name from public.staff where user_id = (select auth.uid())), p_action, p_details);
$$;

-- ---------------------------------------------------------------- restore points
create table app_private.restore_points (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  by_name     text,
  reason      text not null,
  counts      jsonb not null,
  signature   jsonb not null         -- column list of each table, so a copy is only restored into the same shape
);

create or replace function app_private.data_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['import_batches','legacy_accounts','legacy_payments','borrowers','loans','payments','seizures'];
$$;

create or replace function app_private.table_signature(t text)
returns text language sql stable set search_path = '' as $$
  select string_agg(column_name || ':' || data_type, ',' order by ordinal_position)
    from information_schema.columns where table_schema = 'public' and table_name = t;
$$;

create or replace function app_private.data_counts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t text; n bigint; out jsonb := '{}';
begin
  foreach t in array app_private.data_tables() loop
    execute format('select count(*) from public.%I', t) into n;
    out := out || jsonb_build_object(t, n);
  end loop;
  return out;
end;
$$;

create or replace function app_private.make_restore_point(p_reason text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; t text; sig jsonb := '{}'; old record;
begin
  foreach t in array app_private.data_tables() loop
    sig := sig || jsonb_build_object(t, app_private.table_signature(t));
  end loop;
  insert into app_private.restore_points (created_by, by_name, reason, counts, signature)
  values ((select auth.uid()), (select full_name from public.staff where user_id = (select auth.uid())),
          p_reason, app_private.data_counts(), sig)
  returning id into v_id;
  foreach t in array app_private.data_tables() loop
    execute format('create table app_private.%I as table public.%I', 'rp' || v_id || '_' || t, t);
  end loop;
  -- keep the newest 5
  for old in select id from app_private.restore_points order by id desc offset 5 loop
    foreach t in array app_private.data_tables() loop
      execute format('drop table if exists app_private.%I', 'rp' || old.id || '_' || t);
    end loop;
    delete from app_private.restore_points where id = old.id;
  end loop;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- admin API
create or replace function public.admin_data_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  return jsonb_build_object(
    'counts', app_private.data_counts(),
    'linked_new_on_old', jsonb_build_object(
       'payments', (select count(*) from public.payments where legacy_account_id is not null),
       'seizures', (select count(*) from public.seizures where legacy_account_id is not null)),
    'restore_points', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'created_at', created_at, 'by_name', by_name,
                                  'reason', reason, 'counts', counts) order by id desc) from app_private.restore_points), '[]'),
    'audit', coalesce((select jsonb_agg(x order by x.id desc) from (select id, at, by_name, action, details from public.data_audit
                                  order by id desc limit 20) x), '[]'));
end;
$$;

create or replace function public.admin_create_restore_point(p_reason text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  v_id := app_private.make_restore_point(coalesce(nullif(btrim(p_reason), ''), 'Manual'));
  perform app_private.audit('restore_point', jsonb_build_object('restore_point', v_id));
  return v_id;
end;
$$;

-- p_scope: 'old'  = old-software data (+ any app payments / seizures made on those accounts)
--          'new'  = everything entered in this app (loans, borrowers, payments, seizures)
--          'all'  = both
create or replace function public.admin_delete_data(p_scope text, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_rp bigint; before jsonb; after jsonb;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if p_scope not in ('old', 'new', 'all') then raise exception 'bad scope' using errcode = '22023'; end if;
  if p_confirm is distinct from 'DELETE' then raise exception 'type DELETE to confirm' using errcode = '22023'; end if;

  v_rp := app_private.make_restore_point('Before delete (' || p_scope || ')');
  before := app_private.data_counts();

  if p_scope in ('new', 'all') then
    delete from public.seizures;
    delete from public.payments;
    delete from public.loans;
    delete from public.borrowers;
  end if;
  if p_scope in ('old', 'all') then
    delete from public.seizures where legacy_account_id is not null;
    delete from public.payments where legacy_account_id is not null;
    delete from public.legacy_payments;
    delete from public.legacy_accounts;
    delete from public.import_batches;
  end if;

  after := app_private.data_counts();
  perform app_private.audit('delete', jsonb_build_object('scope', p_scope, 'restore_point', v_rp, 'before', before, 'after', after));
  return jsonb_build_object('restore_point', v_rp, 'before', before, 'after', after);
end;
$$;

-- Put every business table back exactly as it was at a restore point (current state is saved first, so this is undoable too).
create or replace function public.admin_restore(p_point bigint, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rp app_private.restore_points; v_new bigint; t text; tables text[] := app_private.data_tables(); seq text; cols text;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if p_confirm is distinct from 'RESTORE' then raise exception 'type RESTORE to confirm' using errcode = '22023'; end if;
  select * into rp from app_private.restore_points where id = p_point;
  if not found then raise exception 'restore point not found' using errcode = '22023'; end if;
  foreach t in array tables loop
    if rp.signature ->> t is distinct from app_private.table_signature(t) then
      raise exception 'the table % has changed shape since this restore point; it cannot be restored automatically', t using errcode = '22023';
    end if;
  end loop;

  v_new := app_private.make_restore_point('Before restoring #' || p_point);
  perform set_config('app.restoring', 'on', true);

  -- empty all business tables at once (fast; no per-row work)
  truncate public.seizures, public.payments, public.loans, public.borrowers,
           public.legacy_payments, public.legacy_accounts, public.import_batches;
  foreach t in array tables loop
    -- only real columns (generated ones such as search_text are recalculated)
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns where table_schema = 'public' and table_name = t and is_generated = 'NEVER';
    execute format('insert into public.%I (%s) overriding system value select %s from app_private.%I', t, cols, cols, 'rp' || p_point || '_' || t);
    seq := pg_get_serial_sequence('public.' || t, 'id');
    if seq is not null then
      execute format('select setval(%L, greatest((select coalesce(max(id), 0) from public.%I), 1))', seq, t);
    end if;
  end loop;

  perform set_config('app.restoring', 'off', true);
  perform app_private.audit('restore', jsonb_build_object('restored', p_point, 'saved_before_restore', v_new, 'counts', app_private.data_counts()));
  return jsonb_build_object('restored', p_point, 'saved_before_restore', v_new, 'counts', app_private.data_counts());
end;
$$;

revoke execute on all functions in schema app_private from public, anon, authenticated;
revoke execute on function public.admin_data_overview(), public.admin_create_restore_point(text),
  public.admin_delete_data(text, text), public.admin_restore(bigint, text) from anon, public;
grant execute on function public.admin_data_overview(), public.admin_create_restore_point(text),
  public.admin_delete_data(text, text), public.admin_restore(bigint, text) to authenticated;

-- Restore / delete / restore point copy ~45k rows: allow them more than the normal 8 s API limit
-- (PostgREST applies a function's own statement_timeout when it is called).
alter function public.admin_restore(bigint, text) set statement_timeout = '120s';
alter function public.admin_delete_data(text, text) set statement_timeout = '120s';
alter function public.admin_create_restore_point(text) set statement_timeout = '120s';
