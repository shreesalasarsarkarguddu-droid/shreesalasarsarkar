-- Phase 5: restore from a backup FILE (the zip downloaded from Settings, or the nightly Telegram backup).
--   1. the browser unzips (and decrypts) the file and sends each table's CSV; the server stages the rows here
--   2. preview: rows in the backup vs. now, per table
--   3. commit: restore point first, then every data table is replaced in one transaction and the counts are checked.
-- Values come in as text and are converted to each column's type. Columns that no longer exist are ignored;
-- columns the backup does not have get their default. People named in the backup who have no login here
-- are replaced by the admin doing the restore (counted in the preview).

create table app_private.backup_jobs (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid not null,
  file_name   text,
  taken       text,
  status      text not null default 'staged'
);
create table app_private.backup_rows (
  job   uuid not null references app_private.backup_jobs (id) on delete cascade,
  tbl   text not null,
  n     int not null,
  row   jsonb not null,
  primary key (job, tbl, n)
);

create or replace function app_private.my_backup_job(p_job uuid)
returns app_private.backup_jobs language plpgsql stable security definer set search_path = '' as $$
declare j app_private.backup_jobs;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  select * into j from app_private.backup_jobs where id = p_job and created_by = (select auth.uid());
  if not found then raise exception 'this upload has expired; choose the file again' using errcode = '22023'; end if;
  if j.status <> 'staged' then raise exception 'this backup was already restored' using errcode = '22023'; end if;
  return j;
end;
$$;

create or replace function public.admin_backup_begin(p_file text, p_taken text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  delete from app_private.backup_jobs where created_at < now() - interval '3 hours' or created_by = (select auth.uid());
  insert into app_private.backup_jobs (created_by, file_name, taken) values ((select auth.uid()), left(p_file, 200), left(p_taken, 300))
  returning id into v;
  return v;
end;
$$;

create or replace function public.admin_backup_stage(p_job uuid, p_tbl text, p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare j app_private.backup_jobs := app_private.my_backup_job(p_job); v_from int;
begin
  if not (p_tbl = any (app_private.data_tables())) then raise exception 'unknown table %', p_tbl using errcode = '22023'; end if;
  select coalesce(max(n), 0) into v_from from app_private.backup_rows where job = p_job and tbl = p_tbl;
  insert into app_private.backup_rows (job, tbl, n, row)
  select p_job, p_tbl, v_from + o::int, e from jsonb_array_elements(p_rows) with ordinality as t(e, o);
  return v_from + jsonb_array_length(p_rows);
end;
$$;

-- text from the CSV -> array literal ('["a","b"]' from the website zip, '{a,b}' from the database dump)
create or replace function app_private.array_text(v text)
returns text language sql immutable set search_path = '' as $$
  select case when v is null or v = '' then null
              when left(btrim(v), 1) = '[' then (select coalesce(array_agg(x), '{}')::text from jsonb_array_elements_text(v::jsonb) x)
              else v end;
$$;

-- a person named in the backup: kept if they have a login here, else the admin doing the restore
create or replace function app_private.known_user(v text, p_admin uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select case when nullif(v, '') is null then null
              when exists (select 1 from public.staff s where s.user_id::text = v) then v::uuid
              else p_admin end;
$$;

-- select-list expression that turns staged text into column c of table t
create or replace function app_private.restore_expr(t text, c text, typ text, is_array boolean)
returns text language sql immutable set search_path = '' as $$
  select case
    when typ = 'uuid' and c in ('created_by', 'cancelled_by', 'received_by', 'reviewed_by', 'user_id', 'by_user', 'updated_by')
      then format('app_private.known_user(r.row ->> %L, %L::uuid)', c, '00000000-0000-0000-0000-000000000000')  -- admin id filled in at run time
    when is_array then format('app_private.array_text(r.row ->> %L)::%s', c, typ)
    else format('nullif(r.row ->> %L, %L)::%s', c, '', typ)
  end;
$$;

create or replace function app_private.restore_cols(p_job uuid, t text)
returns table (col text, expr text) language sql stable security definer set search_path = '' as $$
  select a.attname::text,
         app_private.restore_expr(t, a.attname, format_type(a.atttypid, a.atttypmod), ty.typcategory = 'A')
    from pg_attribute a
    join pg_type ty on ty.oid = a.atttypid
   where a.attrelid = ('public.' || quote_ident(t))::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
     and exists (select 1 from app_private.backup_rows b where b.job = p_job and b.tbl = t and b.n = 1 and b.row ? a.attname)
   order by a.attnum;
$$;

create or replace function public.admin_backup_preview(p_job uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j app_private.backup_jobs := app_private.my_backup_job(p_job); t text; out jsonb := '[]'; n bigint; now_n bigint;
        ignored text[]; missing_people int := 0;
begin
  foreach t in array app_private.data_tables() loop
    select count(*) into n from app_private.backup_rows where job = p_job and tbl = t;
    execute format('select count(*) from public.%I', t) into now_n;
    select array_agg(k order by k) into ignored
      from (select jsonb_object_keys(row) k from app_private.backup_rows where job = p_job and tbl = t and n = 1) x
     where not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t and c.column_name = x.k);
    out := out || jsonb_build_object('table', t, 'in_backup', n, 'now', now_n,
                                     'present', exists (select 1 from app_private.backup_rows where job = p_job and tbl = t),
                                     'ignored_columns', coalesce(to_jsonb(ignored), '[]'));
  end loop;
  select count(distinct v) into missing_people
    from app_private.backup_rows b
    cross join lateral (select b.row ->> k as v from unnest(array['created_by','cancelled_by','received_by','reviewed_by','user_id']) k) x
   where b.job = p_job and nullif(x.v, '') is not null
     and not exists (select 1 from public.staff s where s.user_id::text = x.v);
  return jsonb_build_object('file', j.file_name, 'taken', j.taken, 'tables', out, 'unknown_people', missing_people,
    'has_accounts', exists (select 1 from app_private.backup_rows where job = p_job and tbl in ('legacy_accounts', 'loans')));
end;
$$;

create or replace function public.admin_backup_commit(p_job uuid, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j app_private.backup_jobs := app_private.my_backup_job(p_job);
  tables text[] := app_private.data_tables(); t text; cols text; exprs text; seq text; v_rp bigint;
  want bigint; got bigint; problems text[] := '{}'; v_admin text := (select auth.uid())::text;
begin
  if p_confirm is distinct from 'RESTORE' then raise exception 'type RESTORE to confirm' using errcode = '22023'; end if;
  if not exists (select 1 from app_private.backup_rows where job = p_job and tbl in ('legacy_accounts', 'loans')) then
    raise exception 'this backup has no accounts or loans; it does not look like a full backup' using errcode = '22023';
  end if;

  v_rp := app_private.make_restore_point('Before restoring a backup file');
  perform set_config('app.restoring', 'on', true);
  execute 'truncate ' || (select string_agg(format('public.%I', x), ', ') from unnest(tables) x);

  foreach t in array tables loop
    if not exists (select 1 from app_private.backup_rows where job = p_job and tbl = t) then continue; end if;
    select string_agg(quote_ident(col), ', '), string_agg(replace(expr, '00000000-0000-0000-0000-000000000000', v_admin), ', ')
      into cols, exprs from app_private.restore_cols(p_job, t);
    begin
      execute format('insert into public.%I (%s) overriding system value select %s from app_private.backup_rows r where r.job = %L and r.tbl = %L order by r.n',
                     t, cols, exprs, p_job, t);
    exception when others then
      raise exception 'could not restore table % (%); nothing was changed', t, sqlerrm using errcode = '22023';
    end;
    seq := pg_get_serial_sequence('public.' || t, 'id');
    if seq is not null then
      execute format('select setval(%L, greatest((select coalesce(max(id), 0) from public.%I), 1))', seq, t);
    end if;
    select count(*) into want from app_private.backup_rows where job = p_job and tbl = t;
    execute format('select count(*) from public.%I', t) into got;
    if want <> got then problems := problems || format('%s: %s in the file, %s restored', t, want, got); end if;
  end loop;
  if cardinality(problems) > 0 then
    raise exception 'check failed, nothing was changed: %', array_to_string(problems, '; ') using errcode = '22023';
  end if;

  -- totals stored on old accounts follow the restored receipts
  update public.legacy_accounts a
     set legacy_paid = coalesce(x.paid, 0), legacy_payments_count = coalesce(x.cnt, 0), legacy_last_paid = x.last_paid
    from (select a2.id, sum(lp.paid_amount) paid, count(lp.id) cnt, max(lp.paid_date) last_paid
            from public.legacy_accounts a2
            left join public.legacy_payments lp on lp.account_id = a2.id and lp.ledger = a2.ledger
           group by a2.id) x
   where x.id = a.id;

  perform set_config('app.restoring', 'off', true);
  update app_private.backup_jobs set status = 'restored' where id = p_job;
  delete from app_private.backup_rows where job = p_job;
  perform app_private.audit('restore_file', jsonb_build_object('file', j.file_name, 'taken', j.taken, 'saved_before_restore', v_rp,
                                                               'counts', app_private.data_counts()));
  return jsonb_build_object('saved_before_restore', v_rp, 'counts', app_private.data_counts());
end;
$$;
alter function public.admin_backup_commit(uuid, text) set statement_timeout = '180s';
alter function public.admin_backup_preview(uuid) set statement_timeout = '60s';

-- the Data page shows this action too
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
                                  where action in ('restore_point', 'delete', 'restore', 'import', 'restore_file')
                                  order by id desc limit 20) x), '[]'));
end;
$$;

revoke execute on all functions in schema app_private from public, anon, authenticated;
revoke execute on function public.admin_backup_begin(text, text), public.admin_backup_stage(uuid, text, jsonb),
  public.admin_backup_preview(uuid), public.admin_backup_commit(uuid, text) from anon, public;
grant execute on function public.admin_backup_begin(text, text), public.admin_backup_stage(uuid, text, jsonb),
  public.admin_backup_preview(uuid), public.admin_backup_commit(uuid, text) to authenticated;
