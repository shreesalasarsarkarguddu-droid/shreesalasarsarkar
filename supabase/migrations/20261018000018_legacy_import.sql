-- Import the old software's 4 files from the website (admin only), safely:
--   1. the website reads the files and STAGES the rows here (app_private, not reachable from the API)
--   2. PREVIEW compares them with the database: new / changed / unchanged accounts, accounts not in the files,
--      receipts added / removed, possible double entries - nothing is changed yet
--   3. COMMIT: restore point first, then in ONE transaction:
--        accounts  = updated in place by SNO (new SNOs added); accounts missing from the files are KEPT
--        receipts  = replaced only for the SNOs in the files
--      then the row counts and money totals are checked against the files; any mismatch cancels everything.
-- App entries (new loans, payments, seizures) are never touched; they stay linked to their accounts.

create table app_private.import_jobs (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid not null,
  batches     jsonb not null,      -- per file: name, totals, notes (as the Python importer wrote them)
  checks      jsonb not null,      -- per file: row count + money total the database must match
  status      text not null default 'staged',   -- staged / imported
  preview     jsonb
);
create table app_private.import_rows (
  job   uuid not null references app_private.import_jobs (id) on delete cascade,
  kind  text not null check (kind in ('acc', 'pay')),
  n     int not null,
  row   jsonb not null,
  primary key (job, kind, n)
);

create or replace function app_private.my_job(p_job uuid)
returns app_private.import_jobs language plpgsql stable security definer set search_path = '' as $$
declare j app_private.import_jobs;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  select * into j from app_private.import_jobs where id = p_job and created_by = (select auth.uid());
  if not found then raise exception 'this upload has expired; choose the files again' using errcode = '22023'; end if;
  return j;
end;
$$;

create or replace function public.admin_import_begin(p_batches jsonb, p_checks jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  delete from app_private.import_jobs where created_at < now() - interval '1 day' or (status = 'staged' and created_at < now() - interval '2 hours');
  insert into app_private.import_jobs (created_by, batches, checks) values ((select auth.uid()), p_batches, p_checks) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_import_stage(p_job uuid, p_kind text, p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare j app_private.import_jobs := app_private.my_job(p_job); v_from int;
begin
  if j.status <> 'staged' then raise exception 'this upload was already imported' using errcode = '22023'; end if;
  select coalesce(max(n), 0) into v_from from app_private.import_rows where job = p_job and kind = p_kind;
  insert into app_private.import_rows (job, kind, n, row)
  select p_job, p_kind, v_from + o::int, e from jsonb_array_elements(p_rows) with ordinality as t(e, o);
  return v_from + jsonb_array_length(p_rows);
end;
$$;

-- staged rows as real table rows
create or replace function app_private.staged_accounts(p_job uuid)
returns table (file text, a public.legacy_accounts) language sql stable security definer set search_path = '' as $$
  select r.row ->> '_file', jsonb_populate_record(null::public.legacy_accounts, r.row - '_file')
    from app_private.import_rows r where r.job = p_job and r.kind = 'acc';
$$;
create or replace function app_private.staged_payments(p_job uuid)
returns table (file text, p public.legacy_payments) language sql stable security definer set search_path = '' as $$
  select r.row ->> '_file', jsonb_populate_record(null::public.legacy_payments, r.row - '_file')
    from app_private.import_rows r where r.job = p_job and r.kind = 'pay';
$$;

-- columns compared to decide "changed" (bookkeeping columns and the raw dump are left out)
create or replace function app_private.acc_business(a public.legacy_accounts)
returns jsonb language sql immutable set search_path = '' as $$
  select to_jsonb(a) - array['id','import_batch_id','raw','search_text','legacy_paid','legacy_payments_count','legacy_last_paid','recovery'];
$$;

create or replace function public.admin_import_preview(p_job uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j app_private.import_jobs := app_private.my_job(p_job); v jsonb;
begin
  with s as (select file, (a).* from app_private.staged_accounts(p_job)),
       sa as (select x.a from app_private.staged_accounts(p_job) x),
       e as (select la.* from public.legacy_accounts la),
       dup as (select sno from s group by sno having count(*) > 1),
       cmp as (
         select s.sno, s.ledger as new_ledger, e.ledger as old_ledger, s.borrower_name,
                case when e.id is null then 'new'
                     when app_private.acc_business(sa.a) = app_private.acc_business(e) then 'same' else 'changed' end as kind
           from sa join s on s.sno = (sa.a).sno
           left join public.legacy_accounts e on e.sno = s.sno),
       sp as (select (p).* from app_private.staged_payments(p_job)),
       snos as (select sno from s union select sno from sp),
       old_r as (select ledger, sno, installment_no, paid_date, paid_amount from public.legacy_payments where sno in (select sno from snos)),
       new_r as (select ledger, sno, installment_no, paid_date, paid_amount from sp),
       risk as (   -- receipts in the files dated on/after the first payment taken in this app for that account
         select e.sno, e.borrower_name, min(ap.paid_date) as app_first, count(distinct nr.installment_no) as file_receipts_after
           from public.legacy_accounts e
           join public.payments ap on ap.legacy_account_id = e.id
           join new_r nr on nr.sno = e.sno and nr.paid_date >= (select min(paid_date) from public.payments where legacy_account_id = e.id)
          group by e.sno, e.borrower_name)
  select jsonb_build_object(
    'files', j.batches,
    'checks', j.checks,
    'duplicate_snos', (select coalesce(jsonb_agg(sno), '[]') from dup),
    'accounts', jsonb_build_object(
        'in_files', (select count(*) from s),
        'new', (select count(*) from cmp where kind = 'new'),
        'changed', (select count(*) from cmp where kind = 'changed'),
        'same', (select count(*) from cmp where kind = 'same'),
        'moved', (select count(*) from cmp where kind <> 'new' and new_ledger <> old_ledger),
        'not_in_files', (select count(*) from e where e.sno not in (select sno from s)),
        'examples_new', (select coalesce(jsonb_agg(jsonb_build_object('sno', sno, 'name', borrower_name)), '[]') from (select * from cmp where kind = 'new' order by sno limit 10) x),
        'examples_changed', (select coalesce(jsonb_agg(jsonb_build_object('sno', sno, 'name', borrower_name)), '[]') from (select * from cmp where kind = 'changed' order by sno limit 10) x),
        'examples_moved', (select coalesce(jsonb_agg(jsonb_build_object('sno', sno, 'name', borrower_name, 'from', old_ledger, 'to', new_ledger)), '[]') from (select * from cmp where kind <> 'new' and new_ledger <> old_ledger order by sno limit 10) x),
        'examples_not_in_files', (select coalesce(jsonb_agg(jsonb_build_object('sno', sno, 'name', borrower_name, 'ledger', ledger)), '[]') from (select * from e where e.sno not in (select sno from s) order by sno limit 10) x)),
    'receipts', jsonb_build_object(
        'in_files', (select count(*) from sp),
        'now_for_these_accounts', (select count(*) from old_r),
        'added', (select count(*) from (select * from new_r except all select * from old_r) x),
        'removed', (select count(*) from (select * from old_r except all select * from new_r) x)),
    'double_entry_risk', (select coalesce(jsonb_agg(jsonb_build_object('sno', sno, 'name', borrower_name, 'app_first', app_first, 'file_receipts_after', file_receipts_after) order by sno), '[]') from risk)
  ) into v;
  update app_private.import_jobs set preview = v where id = p_job;
  return v;
end;
$$;

create or replace function public.admin_import_commit(p_job uuid, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j app_private.import_jobs := app_private.my_job(p_job);
  v_rp bigint; v_name text; b jsonb; k text; ids jsonb := '{}'; v_bid bigint;
  problems text[] := '{}'; r record; n_acc int; n_pay int;
begin
  if j.status <> 'staged' then raise exception 'this upload was already imported' using errcode = '22023'; end if;
  if p_confirm is distinct from 'IMPORT' then raise exception 'type IMPORT to confirm' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(j.preview -> 'duplicate_snos', '[]')) > 0 then
    raise exception 'the files contain the same SNO twice; fix the files first' using errcode = '22023';
  end if;

  v_rp := app_private.make_restore_point('Before import');
  select full_name into v_name from public.staff where user_id = (select auth.uid());

  -- one import batch per file, like the first import
  for k in select unnest(array['F_ACC','P_ACCOUNT','F_INSMENT','P_INSMENT']) loop
    b := j.batches -> k;
    insert into public.import_batches (source_file, imported_by, total_records, imported_records, skipped_records, flagged_records, status, notes)
    values (b ->> 'source_file', 'website: ' || coalesce(v_name, 'admin'), (b ->> 'total')::int, (b ->> 'imported')::int,
            (b ->> 'skipped')::int, (b ->> 'flagged')::int, 'completed', b -> 'notes')
    returning id into v_bid;
    ids := ids || jsonb_build_object(k, v_bid);
  end loop;

  -- accounts: update in place by SNO, add new ones
  insert into public.legacy_accounts (ledger, sno, fno, fcode, borrower_name, borrower_father, borrower_address, borrower_mobile,
      borrower_mobile2, guarantor_name, guarantor_father, guarantor_address, guarantor_mobile, guarantor_mobile2, finance_mode, zone,
      vehicle_condition, vehicle_model, vehicle_variant, chassis_no, engine_no, model_year, registration_no, agreement_date,
      tenure_months, interval_months, finance_amount, interest_amount, agreement_amount, hp_amount, total_amount, emi_amount,
      seized, data_flags, recovery, raw, import_batch_id)
  select (a).ledger, (a).sno, (a).fno, (a).fcode, (a).borrower_name, (a).borrower_father, (a).borrower_address, (a).borrower_mobile,
      (a).borrower_mobile2, (a).guarantor_name, (a).guarantor_father, (a).guarantor_address, (a).guarantor_mobile, (a).guarantor_mobile2,
      (a).finance_mode, (a).zone, (a).vehicle_condition, (a).vehicle_model, (a).vehicle_variant, (a).chassis_no, (a).engine_no,
      (a).model_year, (a).registration_no, (a).agreement_date, (a).tenure_months, (a).interval_months, (a).finance_amount,
      (a).interest_amount, (a).agreement_amount, (a).hp_amount, (a).total_amount, (a).emi_amount, (a).seized, (a).data_flags,
      (a).recovery, (a).raw, (ids ->> file)::bigint
    from app_private.staged_accounts(p_job)
  on conflict (sno) do update set
      ledger = excluded.ledger, fno = excluded.fno, fcode = excluded.fcode, borrower_name = excluded.borrower_name,
      borrower_father = excluded.borrower_father, borrower_address = excluded.borrower_address, borrower_mobile = excluded.borrower_mobile,
      borrower_mobile2 = excluded.borrower_mobile2, guarantor_name = excluded.guarantor_name, guarantor_father = excluded.guarantor_father,
      guarantor_address = excluded.guarantor_address, guarantor_mobile = excluded.guarantor_mobile, guarantor_mobile2 = excluded.guarantor_mobile2,
      finance_mode = excluded.finance_mode, zone = excluded.zone, vehicle_condition = excluded.vehicle_condition,
      vehicle_model = excluded.vehicle_model, vehicle_variant = excluded.vehicle_variant, chassis_no = excluded.chassis_no,
      engine_no = excluded.engine_no, model_year = excluded.model_year, registration_no = excluded.registration_no,
      agreement_date = excluded.agreement_date, tenure_months = excluded.tenure_months, interval_months = excluded.interval_months,
      finance_amount = excluded.finance_amount, interest_amount = excluded.interest_amount, agreement_amount = excluded.agreement_amount,
      hp_amount = excluded.hp_amount, total_amount = excluded.total_amount, emi_amount = excluded.emi_amount, seized = excluded.seized,
      data_flags = excluded.data_flags, recovery = excluded.recovery, raw = excluded.raw, import_batch_id = excluded.import_batch_id;
  get diagnostics n_acc = row_count;

  -- receipts: replace for the SNOs in the files only
  create temp table _snos on commit drop as
    select (a).sno from app_private.staged_accounts(p_job) union select (p).sno from app_private.staged_payments(p_job);
  delete from public.legacy_payments where sno in (select sno from _snos);
  insert into public.legacy_payments (ledger, sno, account_id, installment_no, due_amount, due_date, paid_amount, paid_date, balance_after,
      delay_days, payment_mode, cheque_no, receipt_no, data_flags, raw, import_batch_id)
  select (p).ledger, (p).sno, la.id, (p).installment_no, (p).due_amount, (p).due_date, (p).paid_amount, (p).paid_date, (p).balance_after,
      (p).delay_days, (p).payment_mode, (p).cheque_no, (p).receipt_no, (p).data_flags, (p).raw, (ids ->> file)::bigint
    from app_private.staged_payments(p_job) left join public.legacy_accounts la on la.sno = (p).sno;
  get diagnostics n_pay = row_count;

  -- stored per-account totals (same as the Python importer)
  update public.legacy_accounts a
     set legacy_paid = coalesce(t.paid, 0), legacy_payments_count = coalesce(t.cnt, 0), legacy_last_paid = t.last_paid
    from (select a2.id, sum(lp.paid_amount) paid, count(lp.id) cnt, max(lp.paid_date) last_paid
            from public.legacy_accounts a2
            left join public.legacy_payments lp on lp.account_id = a2.id and lp.ledger = a2.ledger
           where a2.sno in (select sno from _snos)
           group by a2.id) t
   where t.id = a.id;

  -- verify against the files (inside the transaction: any mismatch cancels everything)
  for r in select * from (values ('F_ACC','closed'), ('P_ACCOUNT','pending')) v(k, ledger) loop
    perform 1 from public.legacy_accounts
      where import_batch_id = (ids ->> r.k)::bigint and ledger = r.ledger
     having count(*) = (j.checks -> r.k ->> 'rows')::int and coalesce(sum(total_amount), 0) = (j.checks -> r.k ->> 'total')::numeric;
    if not found then problems := problems || (r.k || ': accounts or total payable do not match the file'); end if;
  end loop;
  for r in select * from (values ('F_INSMENT','closed'), ('P_INSMENT','pending')) v(k, ledger) loop
    perform 1 from public.legacy_payments
      where import_batch_id = (ids ->> r.k)::bigint and ledger = r.ledger
     having count(*) = (j.checks -> r.k ->> 'rows')::int and coalesce(sum(paid_amount), 0) = (j.checks -> r.k ->> 'total')::numeric;
    if not found then problems := problems || (r.k || ': receipts or total paid do not match the file'); end if;
  end loop;
  if cardinality(problems) > 0 then
    raise exception 'check failed, nothing was imported: %', array_to_string(problems, '; ') using errcode = '22023';
  end if;

  update app_private.import_jobs set status = 'imported' where id = p_job;
  delete from app_private.import_rows where job = p_job;
  perform app_private.audit('import', jsonb_build_object('restore_point', v_rp, 'batches', ids, 'accounts', n_acc, 'receipts', n_pay,
                                                         'preview', j.preview - 'files'));
  return jsonb_build_object('restore_point', v_rp, 'accounts', n_acc, 'receipts', n_pay);
end;
$$;

alter function public.admin_import_preview(uuid) set statement_timeout = '120s';
alter function public.admin_import_commit(uuid, text) set statement_timeout = '120s';

revoke execute on all functions in schema app_private from public, anon, authenticated;
revoke execute on function public.admin_import_begin(jsonb, jsonb), public.admin_import_stage(uuid, text, jsonb),
  public.admin_import_preview(uuid), public.admin_import_commit(uuid, text) from anon, public;
grant execute on function public.admin_import_begin(jsonb, jsonb), public.admin_import_stage(uuid, text, jsonb),
  public.admin_import_preview(uuid), public.admin_import_commit(uuid, text) to authenticated;
