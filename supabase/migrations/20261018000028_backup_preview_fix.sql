-- Fix: admin_backup_preview had a variable named like a column ("n").
create or replace function public.admin_backup_preview(p_job uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j app_private.backup_jobs := app_private.my_backup_job(p_job); t text; out jsonb := '[]'; v_rows bigint; v_now bigint;
        ignored text[]; missing_people int := 0;
begin
  foreach t in array app_private.data_tables() loop
    select count(*) into v_rows from app_private.backup_rows b where b.job = p_job and b.tbl = t;
    execute format('select count(*) from public.%I', t) into v_now;
    select array_agg(x.k order by x.k) into ignored
      from (select jsonb_object_keys(b.row) k from app_private.backup_rows b where b.job = p_job and b.tbl = t and b.n = 1) x
     where not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t and c.column_name = x.k);
    out := out || jsonb_build_object('table', t, 'in_backup', v_rows, 'now', v_now, 'present', v_rows > 0,
                                     'ignored_columns', coalesce(to_jsonb(ignored), '[]'));
  end loop;
  select count(distinct x.v) into missing_people
    from app_private.backup_rows b
    cross join lateral (select b.row ->> k as v from unnest(array['created_by','cancelled_by','received_by','reviewed_by','user_id']) k) x
   where b.job = p_job and nullif(x.v, '') is not null
     and not exists (select 1 from public.staff s where s.user_id::text = x.v);
  return jsonb_build_object('file', j.file_name, 'taken', j.taken, 'tables', out, 'unknown_people', missing_people,
    'has_accounts', exists (select 1 from app_private.backup_rows b where b.job = p_job and b.tbl in ('legacy_accounts', 'loans')));
end;
$$;
alter function public.admin_backup_preview(uuid) set statement_timeout = '60s';
