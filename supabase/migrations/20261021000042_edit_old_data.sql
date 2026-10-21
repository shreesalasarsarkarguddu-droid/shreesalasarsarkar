-- Admin can edit data that came from the old software: an old account (customer, guarantor, vehicle, loan amounts)
-- and its receipts (amount, date, mode, receipt no.), or cancel a receipt. A reason is required and every change goes
-- to the activity log. What was changed in the app is kept if the old-software files are ever imported again.

alter table public.legacy_accounts add column if not exists edited_in_app boolean not null default false;
alter table public.legacy_payments add column if not exists edited_in_app boolean not null default false;

-- receipts cancelled in the app: a later import does not bring them back
create table if not exists public.legacy_receipts_removed (
  ledger         text not null,
  sno            integer not null,
  installment_no integer not null,
  removed_at     timestamptz not null default now(),
  removed_by     uuid,
  primary key (ledger, sno, installment_no)
);
alter table public.legacy_receipts_removed enable row level security;

-- After an old account or one of its receipts changed: its stored totals, the running balance on its receipts
-- (total payable minus everything paid so far, like the old software) and the payments taken in this app.
create or replace function app_private.legacy_refresh(p_acct bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare a public.legacy_accounts;
begin
  select * into a from public.legacy_accounts where id = p_acct;
  update public.legacy_payments lp
     set balance_after = a.total_amount - x.paid_so_far
    from (select id, sum(paid_amount) over (order by installment_no, id) as paid_so_far
            from public.legacy_payments where account_id = p_acct and ledger = a.ledger) x
   where lp.id = x.id;
  update public.legacy_accounts
     set legacy_paid = coalesce(t.paid, 0), legacy_payments_count = coalesce(t.cnt, 0), legacy_last_paid = t.last_paid
    from (select sum(paid_amount) paid, count(*) cnt, max(paid_date) last_paid
            from public.legacy_payments where account_id = p_acct and ledger = a.ledger) t
   where id = p_acct;
  perform app_private.reflow_payments(p_acct, null);
end;
$$;

-- p = { fno, borrower_*, guarantor_*, finance_mode, vehicle_*, chassis_no, engine_no, model_year, registration_no,
--       agreement_date, tenure_months, interval_months, finance_amount, interest_amount, agreement_amount, hp_amount,
--       total_amount, emi_amount }
create or replace function public.admin_edit_legacy_account(p_sno integer, p jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := app_private.need_reason(p_reason);
  o public.legacy_accounts; n public.legacy_accounts; d jsonb; r jsonb;
  v_mob text;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('payment:old:' || p_sno));
  select * into o from public.legacy_accounts where sno = p_sno for update;
  if not found then raise exception 'account not found' using errcode = 'P0002'; end if;

  if nullif(btrim(p ->> 'borrower_name'), '') is null then raise exception 'enter the customer''s name' using errcode = '22023'; end if;
  foreach v_mob in array array['borrower_mobile', 'borrower_mobile2', 'guarantor_mobile', 'guarantor_mobile2'] loop
    if coalesce(btrim(p ->> v_mob), '') !~ '^(\d{10})?$' then raise exception 'a mobile number must be 10 digits' using errcode = '22023'; end if;
  end loop;
  if coalesce(p ->> 'fno', '') !~ '^\d{1,9}$' then raise exception 'enter the folio number' using errcode = '22023'; end if;
  if coalesce(p ->> 'tenure_months', '') !~ '^\d{1,3}$' or (p ->> 'tenure_months')::int not between 1 and 360 then
    raise exception 'EMIs must be between 1 and 360' using errcode = '22023';
  end if;
  if coalesce(p ->> 'interval_months', '') !~ '^\d{1,2}$' or (p ->> 'interval_months')::int not between 1 and 12 then
    raise exception 'months between EMIs must be 1 to 12' using errcode = '22023';
  end if;
  foreach v_mob in array array['finance_amount', 'interest_amount', 'agreement_amount', 'hp_amount', 'total_amount', 'emi_amount'] loop
    if coalesce(p ->> v_mob, '') !~ '^\d{1,9}(\.\d{1,2})?$' then raise exception 'enter % (0 or more)', replace(v_mob, '_', ' ') using errcode = '22023'; end if;
  end loop;
  if (p ->> 'total_amount')::numeric <= 0 then raise exception 'total payable must be more than 0' using errcode = '22023'; end if;
  if coalesce(p ->> 'model_year', '') !~ '^(\d{4})?$' then raise exception 'model year must be 4 digits' using errcode = '22023'; end if;
  if (p ->> 'agreement_date') is not null and (p ->> 'agreement_date') <> ''
     and (p ->> 'agreement_date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'enter the agreement date' using errcode = '22023'; end if;

  update public.legacy_accounts
     set fno = (p ->> 'fno')::int,
         borrower_name = btrim(p ->> 'borrower_name'),
         borrower_father = nullif(btrim(p ->> 'borrower_father'), ''), borrower_address = nullif(btrim(p ->> 'borrower_address'), ''),
         borrower_mobile = nullif(btrim(p ->> 'borrower_mobile'), ''), borrower_mobile2 = nullif(btrim(p ->> 'borrower_mobile2'), ''),
         guarantor_name = nullif(btrim(p ->> 'guarantor_name'), ''), guarantor_father = nullif(btrim(p ->> 'guarantor_father'), ''),
         guarantor_address = nullif(btrim(p ->> 'guarantor_address'), ''),
         guarantor_mobile = nullif(btrim(p ->> 'guarantor_mobile'), ''), guarantor_mobile2 = nullif(btrim(p ->> 'guarantor_mobile2'), ''),
         finance_mode = nullif(upper(btrim(p ->> 'finance_mode')), ''),
         vehicle_condition = nullif(btrim(p ->> 'vehicle_condition'), ''), vehicle_model = nullif(btrim(p ->> 'vehicle_model'), ''),
         vehicle_variant = nullif(btrim(p ->> 'vehicle_variant'), ''), chassis_no = nullif(btrim(p ->> 'chassis_no'), ''),
         engine_no = nullif(btrim(p ->> 'engine_no'), ''), model_year = nullif(p ->> 'model_year', '')::int,
         registration_no = nullif(upper(btrim(p ->> 'registration_no')), ''),
         agreement_date = nullif(p ->> 'agreement_date', '')::date,
         tenure_months = (p ->> 'tenure_months')::int, interval_months = (p ->> 'interval_months')::int,
         finance_amount = (p ->> 'finance_amount')::numeric, interest_amount = (p ->> 'interest_amount')::numeric,
         agreement_amount = (p ->> 'agreement_amount')::numeric, hp_amount = (p ->> 'hp_amount')::numeric,
         total_amount = (p ->> 'total_amount')::numeric, emi_amount = (p ->> 'emi_amount')::numeric
   where id = o.id
  returning * into n;

  d := app_private.diff(to_jsonb(o), to_jsonb(n), array['fno', 'borrower_name', 'borrower_father', 'borrower_address', 'borrower_mobile',
         'borrower_mobile2', 'guarantor_name', 'guarantor_father', 'guarantor_address', 'guarantor_mobile', 'guarantor_mobile2',
         'finance_mode', 'vehicle_condition', 'vehicle_model', 'vehicle_variant', 'chassis_no', 'engine_no', 'model_year',
         'registration_no', 'agreement_date', 'tenure_months', 'interval_months', 'finance_amount', 'interest_amount',
         'agreement_amount', 'hp_amount', 'total_amount', 'emi_amount']);
  if d = '{}' then raise exception 'nothing was changed' using errcode = '22023'; end if;
  update public.legacy_accounts set edited_in_app = true where id = o.id;
  perform app_private.legacy_refresh(o.id);

  r := app_private.acct_ref(o.id, null);
  perform app_private.log('old_account_edited', r ->> 'subject', r - 'subject', jsonb_build_object('reason', v_reason, 'changes', d));
  return jsonb_build_object('sno', p_sno, 'owed', app_private.owed(o.id, null));
end;
$$;

-- p = { paid_amount, paid_date, payment_mode, receipt_no, cheque_no }
create or replace function public.admin_edit_legacy_payment(p_id bigint, p jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := app_private.need_reason(p_reason);
  o public.legacy_payments; n public.legacy_payments; d jsonb; r jsonb;
  v_amount numeric; v_date date; v_mode text := nullif(upper(btrim(p ->> 'payment_mode')), ''); v_rno bigint;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  select * into o from public.legacy_payments where id = p_id;
  if not found then raise exception 'receipt not found' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtext('payment:old:' || o.sno));
  select * into o from public.legacy_payments where id = p_id for update;

  if coalesce(p ->> 'paid_amount', '') !~ '^\d{1,9}(\.\d{1,2})?$' or (p ->> 'paid_amount')::numeric <= 0 then
    raise exception 'amount must be more than 0' using errcode = '22023';
  end if;
  v_amount := (p ->> 'paid_amount')::numeric;
  if coalesce(p ->> 'paid_date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'enter the paid date' using errcode = '22023'; end if;
  v_date := (p ->> 'paid_date')::date;
  if v_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'paid date cannot be in the future' using errcode = '22023'; end if;
  if v_mode is null or length(v_mode) > 20 then raise exception 'choose the payment mode' using errcode = '22023'; end if;
  if coalesce(p ->> 'receipt_no', '') !~ '^\d{0,12}$' then raise exception 'receipt number must be digits' using errcode = '22023'; end if;
  v_rno := nullif(p ->> 'receipt_no', '')::bigint;
  if v_rno is distinct from o.receipt_no and v_rno is not null then
    if exists (select 1 from public.legacy_payments where series_id = o.series_id and receipt_no = v_rno and id <> p_id)
       or exists (select 1 from public.payments where series_id = o.series_id and receipt_no = v_rno)
       or exists (select 1 from public.pending_payments where series_id = o.series_id and receipt_no = v_rno) then
      raise exception 'receipt no. % is already used in this book', v_rno using errcode = '22023';
    end if;
  end if;

  update public.legacy_payments
     set paid_amount = v_amount, paid_date = v_date, payment_mode = v_mode, receipt_no = v_rno,
         cheque_no = nullif(btrim(p ->> 'cheque_no'), ''),
         delay_days = case when due_date is not null then v_date - due_date else delay_days end
   where id = p_id
  returning * into n;
  d := app_private.diff(to_jsonb(o), to_jsonb(n), array['paid_amount', 'paid_date', 'payment_mode', 'receipt_no', 'cheque_no']);
  if d = '{}' then raise exception 'nothing was changed' using errcode = '22023'; end if;
  update public.legacy_payments set edited_in_app = true where id = p_id;
  if o.account_id is not null then perform app_private.legacy_refresh(o.account_id); end if;

  r := app_private.acct_ref(o.account_id, null);
  perform app_private.log('old_receipt_edited', r ->> 'subject', r - 'subject',
    jsonb_build_object('reason', v_reason, 'installment_no', o.installment_no, 'receipt_no', o.receipt_no, 'changes', d));
  return jsonb_build_object('id', p_id, 'owed', case when o.account_id is not null then app_private.owed(o.account_id, null) end);
end;
$$;

create or replace function public.admin_cancel_legacy_payment(p_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_reason text := app_private.need_reason(p_reason); o public.legacy_payments; r jsonb;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  select * into o from public.legacy_payments where id = p_id;
  if not found then raise exception 'receipt not found' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtext('payment:old:' || o.sno));
  select * into o from public.legacy_payments where id = p_id for update;

  delete from public.legacy_payments where id = p_id;
  insert into public.legacy_receipts_removed (ledger, sno, installment_no, removed_by)
  values (o.ledger, o.sno, o.installment_no, (select auth.uid())) on conflict do nothing;
  if o.account_id is not null then perform app_private.legacy_refresh(o.account_id); end if;

  r := app_private.acct_ref(o.account_id, null);
  perform app_private.log('old_receipt_cancelled', r ->> 'subject', r - 'subject',
    jsonb_build_object('reason', v_reason, 'installment_no', o.installment_no, 'receipt_no', o.receipt_no, 'amount', o.paid_amount,
                       'paid_date', o.paid_date, 'receipt', to_jsonb(o) - 'raw'));
  return jsonb_build_object('cancelled', p_id, 'owed', case when o.account_id is not null then app_private.owed(o.account_id, null) end);
end;
$$;

revoke execute on function public.admin_edit_legacy_account(integer, jsonb, text) from anon, public;
revoke execute on function public.admin_edit_legacy_payment(bigint, jsonb, text) from anon, public;
revoke execute on function public.admin_cancel_legacy_payment(bigint, text) from anon, public;
grant execute on function public.admin_edit_legacy_account(integer, jsonb, text) to authenticated;
grant execute on function public.admin_edit_legacy_payment(bigint, jsonb, text) to authenticated;
grant execute on function public.admin_cancel_legacy_payment(bigint, text) to authenticated;
revoke execute on function app_private.legacy_refresh(bigint) from anon, public, authenticated;

-- ---------------------------------------------------------------- import again: what was changed in the app stays
CREATE OR REPLACE FUNCTION public.admin_import_preview(p_job uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '120s'
AS $function$
declare j app_private.import_jobs := app_private.my_job(p_job); v jsonb;
begin
  with s as (select file, (a).* from app_private.staged_accounts(p_job)),
       sa as (select x.a from app_private.staged_accounts(p_job) x),
       e as (select la.* from public.legacy_accounts la),
       dup as (select sno from s group by sno having count(*) > 1),
       cmp as (
         select s.sno, s.ledger as new_ledger, e.ledger as old_ledger, s.borrower_name,
                case when e.id is null then 'new'
                     when e.edited_in_app then 'kept'
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
          group by e.sno, e.borrower_name),
       likely as ( -- a receipt in the files that matches an app payment: same receipt no., or same date + amount
         select e.sno, e.borrower_name,
                ap.receipt_no as app_receipt, ap.paid_date as app_date, ap.paid_amount as app_amount,
                f.receipt_no as file_receipt, f.paid_date as file_date, f.paid_amount as file_amount,
                case when f.receipt_no = ap.receipt_no then 'same receipt no.' else 'same date and amount' end as why
           from public.legacy_accounts e
           join public.payments ap on ap.legacy_account_id = e.id
           join sp f on f.sno = e.sno
                    and (f.receipt_no = ap.receipt_no or (f.paid_date = ap.paid_date and f.paid_amount = ap.paid_amount)))
  select jsonb_build_object(
    'files', j.batches,
    'checks', j.checks,
    'duplicate_snos', (select coalesce(jsonb_agg(sno), '[]') from dup),
    'accounts', jsonb_build_object(
        'in_files', (select count(*) from s),
        'new', (select count(*) from cmp where kind = 'new'),
        'changed', (select count(*) from cmp where kind = 'changed'),
        'same', (select count(*) from cmp where kind = 'same'),
        'kept', (select count(*) from cmp where kind = 'kept'),
        'moved', (select count(*) from cmp where kind not in ('new', 'kept') and new_ledger <> old_ledger),
        'not_in_files', (select count(*) from e where e.sno not in (select sno from s)),
        'examples_new', (select coalesce(jsonb_agg(jsonb_build_object('sno', sno, 'name', borrower_name)), '[]') from (select * from cmp where kind = 'new' order by sno limit 10) x),
        'examples_changed', (select coalesce(jsonb_agg(jsonb_build_object('sno', sno, 'name', borrower_name)), '[]') from (select * from cmp where kind = 'changed' order by sno limit 10) x),
        'examples_moved', (select coalesce(jsonb_agg(jsonb_build_object('sno', sno, 'name', borrower_name, 'from', old_ledger, 'to', new_ledger)), '[]') from (select * from cmp where kind not in ('new', 'kept') and new_ledger <> old_ledger order by sno limit 10) x),
        'examples_not_in_files', (select coalesce(jsonb_agg(jsonb_build_object('sno', sno, 'name', borrower_name, 'ledger', ledger)), '[]') from (select * from e where e.sno not in (select sno from s) order by sno limit 10) x)),
    'receipts', jsonb_build_object(
        'in_files', (select count(*) from sp),
        'now_for_these_accounts', (select count(*) from old_r),
        'added', (select count(*) from (select * from new_r except all select * from old_r) x),
        'removed', (select count(*) from (select * from old_r except all select * from new_r) x),
        'kept_edited', (select count(*) from sp join public.legacy_payments x
                          on x.ledger = sp.ledger and x.sno = sp.sno and x.installment_no = sp.installment_no and x.edited_in_app),
        'kept_cancelled', (select count(*) from sp join public.legacy_receipts_removed x
                             on x.ledger = sp.ledger and x.sno = sp.sno and x.installment_no = sp.installment_no)),
    'double_entry_risk', (select coalesce(jsonb_agg(jsonb_build_object('sno', sno, 'name', borrower_name, 'app_first', app_first, 'file_receipts_after', file_receipts_after) order by sno), '[]') from risk),
    'double_entry_likely', (select coalesce(jsonb_agg(to_jsonb(l) order by l.sno, l.app_date), '[]') from likely l)
  ) into v;
  update app_private.import_jobs set preview = v where id = p_job;
  return v;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_import_commit(p_job uuid, p_confirm text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '120s'
AS $function$
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

  -- what was changed in this app stays: edited accounts, edited receipts, cancelled receipts (left out of the totals check too)
  create temp table _kept_acc on commit drop as
    select s.file, (s.a).sno, (s.a).total_amount from app_private.staged_accounts(p_job) s
     where exists (select 1 from public.legacy_accounts x where x.sno = (s.a).sno and x.edited_in_app);
  create temp table _kept_pay on commit drop as
    select s.file, (s.p).ledger, (s.p).sno, (s.p).installment_no, (s.p).paid_amount from app_private.staged_payments(p_job) s
     where exists (select 1 from public.legacy_payments x where x.ledger = (s.p).ledger and x.sno = (s.p).sno
                     and x.installment_no = (s.p).installment_no and x.edited_in_app)
        or exists (select 1 from public.legacy_receipts_removed x where x.ledger = (s.p).ledger and x.sno = (s.p).sno
                     and x.installment_no = (s.p).installment_no);

  -- one import batch per file, like the first import
  for k in select unnest(array['F_ACC','P_ACCOUNT','F_INSMENT','P_INSMENT']) loop
    b := j.batches -> k;
    insert into public.import_batches (source_file, imported_by, total_records, imported_records, skipped_records, flagged_records, status, notes)
    values (b ->> 'source_file', 'website: ' || coalesce(v_name, 'admin'), (b ->> 'total')::int, (b ->> 'imported')::int,
            (b ->> 'skipped')::int, (b ->> 'flagged')::int, 'completed', b -> 'notes')
    returning id into v_bid;
    ids := ids || jsonb_build_object(k, v_bid);
  end loop;

  -- accounts: update in place by SNO (not the ones edited in this app), add new ones
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
      finance_mode = excluded.finance_mode, zone = case when public.legacy_accounts.zone_set_in_app then public.legacy_accounts.zone else excluded.zone end, vehicle_condition = excluded.vehicle_condition,
      vehicle_model = excluded.vehicle_model, vehicle_variant = excluded.vehicle_variant, chassis_no = excluded.chassis_no,
      engine_no = excluded.engine_no, model_year = excluded.model_year, registration_no = excluded.registration_no,
      agreement_date = excluded.agreement_date, tenure_months = excluded.tenure_months, interval_months = excluded.interval_months,
      finance_amount = excluded.finance_amount, interest_amount = excluded.interest_amount, agreement_amount = excluded.agreement_amount,
      hp_amount = excluded.hp_amount, total_amount = excluded.total_amount, emi_amount = excluded.emi_amount, seized = excluded.seized,
      data_flags = excluded.data_flags, recovery = excluded.recovery, raw = excluded.raw, import_batch_id = excluded.import_batch_id
    where not public.legacy_accounts.edited_in_app;
  get diagnostics n_acc = row_count;

  -- receipts: replace for the SNOs in the files only (not the ones edited or cancelled in this app)
  create temp table _snos on commit drop as
    select (a).sno from app_private.staged_accounts(p_job) union select (p).sno from app_private.staged_payments(p_job);
  delete from public.legacy_payments where sno in (select sno from _snos) and not edited_in_app;
  insert into public.legacy_payments (ledger, sno, account_id, installment_no, due_amount, due_date, paid_amount, paid_date, balance_after,
      delay_days, payment_mode, cheque_no, receipt_no, data_flags, raw, import_batch_id)
  select (p).ledger, (p).sno, la.id, (p).installment_no, (p).due_amount, (p).due_date, (p).paid_amount, (p).paid_date, (p).balance_after,
      (p).delay_days, (p).payment_mode, (p).cheque_no, (p).receipt_no, (p).data_flags, (p).raw, (ids ->> file)::bigint
    from app_private.staged_payments(p_job) left join public.legacy_accounts la on la.sno = (p).sno
   where not exists (select 1 from _kept_pay k where k.ledger = (p).ledger and k.sno = (p).sno and k.installment_no = (p).installment_no);
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

  -- verify against the files, less what was kept (inside the transaction: any mismatch cancels everything)
  for r in select * from (values ('F_ACC','closed'), ('P_ACCOUNT','pending')) v(k, ledger) loop
    perform 1 from public.legacy_accounts
      where import_batch_id = (ids ->> r.k)::bigint and ledger = r.ledger
     having count(*) = (j.checks -> r.k ->> 'rows')::int - (select count(*) from _kept_acc where file = r.k)
        and coalesce(sum(total_amount), 0) = (j.checks -> r.k ->> 'total')::numeric
                                             - (select coalesce(sum(total_amount), 0) from _kept_acc where file = r.k);
    if not found then problems := problems || (r.k || ': accounts or total payable do not match the file'); end if;
  end loop;
  for r in select * from (values ('F_INSMENT','closed'), ('P_INSMENT','pending')) v(k, ledger) loop
    perform 1 from public.legacy_payments
      where import_batch_id = (ids ->> r.k)::bigint and ledger = r.ledger
     having count(*) = (j.checks -> r.k ->> 'rows')::int - (select count(*) from _kept_pay where file = r.k)
        and coalesce(sum(paid_amount), 0) = (j.checks -> r.k ->> 'total')::numeric
                                            - (select coalesce(sum(paid_amount), 0) from _kept_pay where file = r.k);
    if not found then problems := problems || (r.k || ': receipts or total paid do not match the file'); end if;
  end loop;
  if cardinality(problems) > 0 then
    raise exception 'check failed, nothing was imported: %', array_to_string(problems, '; ') using errcode = '22023';
  end if;

  update app_private.import_jobs set status = 'imported' where id = p_job;
  delete from app_private.import_rows where job = p_job;
  perform app_private.audit('import', jsonb_build_object('restore_point', v_rp, 'batches', ids, 'accounts', n_acc, 'receipts', n_pay,
                                                         'kept_accounts', (select count(*) from _kept_acc), 'kept_receipts', (select count(*) from _kept_pay),
                                                         'preview', j.preview - 'files'));
  return jsonb_build_object('restore_point', v_rp, 'accounts', n_acc, 'receipts', n_pay,
                            'kept_accounts', (select count(*) from _kept_acc), 'kept_receipts', (select count(*) from _kept_pay));
end;
$function$;
