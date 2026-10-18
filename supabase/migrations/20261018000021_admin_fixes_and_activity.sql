-- Phase 1: the admin can fix mistakes, and everything people do is in the activity log.
--   * edit / cancel a payment taken in this app (reason required; the account's later receipts are recalculated)
--   * edit a new loan + its borrower (amounts recalculated with loan_amounts(), receipts recalculated)
--   * delete a wrong new loan (only while it has no payments)
--   * activity log: payments, new loans, seize / release, user changes, settings, and the fixes above
-- Old-software accounts are not edited here: the next import would overwrite the change.

-- ---------------------------------------------------------------- activity log
alter table public.data_audit
  add column if not exists subject text,     -- "SNO 123 · NAME" / "Folio X · NAME" / person / "Settings"
  add column if not exists ref     jsonb;    -- {source: old|new, ref_id} for a link to the account
create index if not exists data_audit_at_idx     on public.data_audit (at desc);
create index if not exists data_audit_user_idx   on public.data_audit (by_user, at desc);
create index if not exists data_audit_action_idx on public.data_audit (action, at desc);

create or replace function app_private.log(p_action text, p_subject text, p_ref jsonb, p_details jsonb,
                                           p_user uuid default null, p_at timestamptz default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.data_audit (at, by_user, by_name, action, subject, ref, details)
  values (coalesce(p_at, now()), coalesce(p_user, (select auth.uid())),
          (select full_name from public.staff where user_id = coalesce(p_user, (select auth.uid()))),
          p_action, p_subject, p_ref, coalesce(p_details, '{}'));
$$;

-- {subject, source, ref_id} for an old account (legacy_accounts.id) or a new loan
create or replace function app_private.acct_ref(p_acct bigint, p_loan bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case
    when p_acct is not null then
      (select jsonb_build_object('subject', 'SNO ' || a.sno || ' · ' || a.borrower_name, 'source', 'old', 'ref_id', a.sno)
         from public.legacy_accounts a where a.id = p_acct)
    else
      (select jsonb_build_object('subject', 'Folio ' || l.folio_no || ' · ' || b.full_name, 'source', 'new', 'ref_id', l.id)
         from public.loans l join public.borrowers b on b.id = l.borrower_id where l.id = p_loan)
  end;
$$;

-- {key: {from, to}} for the keys whose value changed
create or replace function app_private.diff(a jsonb, b jsonb, keys text[])
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('from', a -> k, 'to', b -> k)), '{}')
    from unnest(keys) k where (a -> k) is distinct from (b -> k);
$$;

-- automatic entries
create or replace function app_private.audit_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r jsonb := app_private.acct_ref(new.legacy_account_id, new.loan_id);
begin
  perform app_private.log('payment', r ->> 'subject', r - 'subject',
    jsonb_build_object('amount', new.paid_amount, 'receipt_no', new.receipt_no, 'paid_date', new.paid_date,
                       'mode', new.payment_mode, 'emis', new.installments_covered), new.created_by);
  return null;
end;
$$;
create or replace function app_private.audit_loan()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r jsonb := app_private.acct_ref(null, new.id);
begin
  perform app_private.log('new_loan', r ->> 'subject', r - 'subject',
    jsonb_build_object('finance', new.finance_amount, 'total', new.total_amount, 'emi', new.emi_amount, 'emis', new.installments),
    new.created_by);
  return null;
end;
$$;
create or replace function app_private.audit_seizure()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r jsonb := app_private.acct_ref(new.legacy_account_id, new.loan_id);
begin
  perform app_private.log(new.action, r ->> 'subject', r - 'subject',
    jsonb_build_object('date', new.action_date, 'remarks', new.remarks), new.created_by);
  return null;
end;
$$;
create trigger payments_audit after insert on public.payments for each row
  when (coalesce(current_setting('app.restoring', true), '') <> 'on') execute function app_private.audit_payment();
create trigger loans_audit after insert on public.loans for each row
  when (coalesce(current_setting('app.restoring', true), '') <> 'on') execute function app_private.audit_loan();
create trigger seizures_audit after insert on public.seizures for each row
  when (coalesce(current_setting('app.restoring', true), '') <> 'on') execute function app_private.audit_seizure();

-- users: added / changed (role, on/off, permissions, name)
create or replace function app_private.audit_staff()
returns trigger language plpgsql security definer set search_path = '' as $$
declare d jsonb;
begin
  if tg_op = 'INSERT' then
    perform app_private.log('user_added', new.full_name, null,
      jsonb_build_object('role', new.role, 'permissions', new.permissions));
  else
    d := app_private.diff(to_jsonb(old), to_jsonb(new), array['full_name', 'role', 'active', 'permissions']);
    if d <> '{}' then perform app_private.log('user_changed', new.full_name, null, jsonb_build_object('changes', d)); end if;
  end if;
  return null;
end;
$$;
create trigger staff_audit after insert or update on public.staff for each row execute function app_private.audit_staff();

-- settings: which settings changed (keys are never written to the log)
create or replace function app_private.audit_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a jsonb := to_jsonb(old) - array['telegram_bot_token', 'whatsapp_api_key', 'updated_at'];
        b jsonb := to_jsonb(new) - array['telegram_bot_token', 'whatsapp_api_key', 'updated_at'];
        d jsonb;
begin
  d := app_private.diff(a, b, array(select jsonb_object_keys(b)));
  if old.telegram_bot_token is distinct from new.telegram_bot_token then d := d || '{"telegram_bot_token": "changed"}'; end if;
  if old.whatsapp_api_key is distinct from new.whatsapp_api_key then d := d || '{"whatsapp_api_key": "changed"}'; end if;
  if d <> '{}' then perform app_private.log('settings', 'Settings', null, jsonb_build_object('changes', d)); end if;
  return null;
end;
$$;
create trigger app_settings_audit after update on public.app_settings for each row execute function app_private.audit_settings();

-- password reset by the admin
create or replace function public.admin_set_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'password must be at least 8 characters' using errcode = '22023'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = p_user;
  if not found then raise exception 'user not found' using errcode = '22023'; end if;
  delete from auth.sessions where user_id = p_user;
  perform app_private.log('password_reset', (select full_name from public.staff where user_id = p_user), null, '{}');
end;
$$;

-- everything already entered in this app goes into the log too
insert into public.data_audit (at, by_user, by_name, action, subject, ref, details)
select p.created_at, p.created_by, app_private.staff_name(p.created_by), 'payment', r ->> 'subject', r - 'subject',
       jsonb_build_object('amount', p.paid_amount, 'receipt_no', p.receipt_no, 'paid_date', p.paid_date,
                          'mode', p.payment_mode, 'emis', p.installments_covered)
  from public.payments p cross join lateral (select app_private.acct_ref(p.legacy_account_id, p.loan_id) r) x;
insert into public.data_audit (at, by_user, by_name, action, subject, ref, details)
select l.created_at, l.created_by, app_private.staff_name(l.created_by), 'new_loan', r ->> 'subject', r - 'subject',
       jsonb_build_object('finance', l.finance_amount, 'total', l.total_amount, 'emi', l.emi_amount, 'emis', l.installments)
  from public.loans l cross join lateral (select app_private.acct_ref(null, l.id) r) x;
insert into public.data_audit (at, by_user, by_name, action, subject, ref, details)
select s.created_at, s.created_by, app_private.staff_name(s.created_by), s.action, r ->> 'subject', r - 'subject',
       jsonb_build_object('date', s.action_date, 'remarks', s.remarks)
  from public.seizures s cross join lateral (select app_private.acct_ref(s.legacy_account_id, s.loan_id) r) x;

-- the Data page keeps showing only data actions (backup / restore / delete / import)
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
                                  where action in ('restore_point', 'delete', 'restore', 'import')
                                  order by id desc limit 20) x), '[]'));
end;
$$;

-- ---------------------------------------------------------------- recalculate an account's receipts
-- After an edit / cancel / loan change: the receipts taken in this app are renumbered in the order they were taken and
-- get the same due date, balance and delay that record_payment() would give them now.
create or replace function app_private.reflow_payments(p_acct bigint, p_loan bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_total numeric; v_emi numeric; v_iv int; v_start date; v_ledger text;
  v_paid numeric := 0; v_used int := 0; v_n int := 0; v_last_due date; v_last_im int; v_due date; r record;
begin
  if p_acct is not null then
    select total_amount, emi_amount, greatest(coalesce(interval_months, 1), 1), agreement_date, ledger
      into v_total, v_emi, v_iv, v_start, v_ledger from public.legacy_accounts where id = p_acct;
    select coalesce(sum(paid_amount), 0), coalesce(max(installment_no), 0),
           coalesce(sum(case when v_emi > 0 then greatest(1, round(paid_amount / v_emi))::int else 1 end), 0)
      into v_paid, v_n, v_used
      from public.legacy_payments where account_id = p_acct and ledger = v_ledger;
    select due_date, case when v_emi > 0 then greatest(1, round(paid_amount / v_emi))::int else 1 end
      into v_last_due, v_last_im
      from public.legacy_payments where account_id = p_acct and ledger = v_ledger and due_date is not null
     order by installment_no desc limit 1;
  else
    select total_amount, emi_amount, greatest(interval_months, 1), agreement_date
      into v_total, v_emi, v_iv, v_start from public.loans where id = p_loan;
  end if;

  update public.payments set installment_no = installment_no + 100000
   where legacy_account_id = p_acct or loan_id = p_loan;
  for r in select id, paid_amount, paid_date, installments_covered as im from public.payments
            where legacy_account_id = p_acct or loan_id = p_loan order by installment_no, id loop
    v_n := v_n + 1;
    if v_last_due is not null then v_due := (v_last_due + make_interval(months => v_last_im * v_iv))::date;
    elsif v_start is not null then v_due := (v_start + make_interval(months => (v_used + 1) * v_iv))::date;
    else v_due := null;
    end if;
    v_paid := v_paid + r.paid_amount;
    update public.payments
       set installment_no = v_n, due_date = v_due, due_amount = v_emi, balance_after = v_total - v_paid, delay_days = r.paid_date - v_due
     where id = r.id;
    v_used := v_used + r.im;
    if v_due is not null then v_last_due := v_due; v_last_im := r.im; end if;
  end loop;
end;
$$;

create or replace function app_private.payment_lock(p public.payments)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- same lock as record_payment(), so a fix and a new payment on one account never run together
  if p.legacy_account_id is not null then
    perform pg_advisory_xact_lock(hashtext('payment:old:' || (select sno from public.legacy_accounts where id = p.legacy_account_id)));
  else
    perform pg_advisory_xact_lock(hashtext('payment:new:' || p.loan_id));
  end if;
end;
$$;

create or replace function app_private.need_reason(p_reason text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(p_reason), '');
begin
  if v is null then raise exception 'enter the reason' using errcode = '22023'; end if;
  if length(v) > 300 then raise exception 'reason is too long (300 characters at most)' using errcode = '22023'; end if;
  return v;
end;
$$;

create or replace function app_private.tg_quiet(p_on boolean, p_text text, p_event text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_on then perform app_private.tg_send(p_text, p_event); end if;
exception when others then
  raise warning 'notification failed: %', sqlerrm;   -- never block the fix
end;
$$;

-- ---------------------------------------------------------------- payments: edit / cancel (admin)
-- p = { paid_amount, paid_date, payment_mode, reference_no, bank_name, receipt_no, installments_covered }
create or replace function public.admin_edit_payment(p_id bigint, p jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := app_private.need_reason(p_reason);
  o public.payments; n public.payments; r jsonb; d jsonb;
  v_amount numeric := (p ->> 'paid_amount')::numeric;
  v_date date := (p ->> 'paid_date')::date;
  v_mode text := p ->> 'payment_mode';
  v_rno bigint := (p ->> 'receipt_no')::bigint;
  v_im int := coalesce((p ->> 'installments_covered')::int, 1);
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  select * into o from public.payments where id = p_id;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  perform app_private.payment_lock(o);
  select * into o from public.payments where id = p_id for update;

  if v_amount is null or v_amount <= 0 then raise exception 'amount must be more than 0' using errcode = '22023'; end if;
  if v_date is null or v_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'paid date cannot be in the future' using errcode = '22023'; end if;
  if v_mode is null or v_mode not in ('CASH', 'CHEQUE', 'SBI', 'BANK') then raise exception 'choose the payment mode' using errcode = '22023'; end if;
  if v_mode = 'BANK' and nullif(btrim(p ->> 'bank_name'), '') is null then raise exception 'enter the bank name' using errcode = '22023'; end if;
  if v_rno is null or v_rno <= 0 then raise exception 'enter the receipt number' using errcode = '22023'; end if;
  if v_im < 1 or v_im > 360 then raise exception 'EMIs covered must be 1 or more' using errcode = '22023'; end if;
  if v_rno <> o.receipt_no and exists (select 1 from public.legacy_payments where receipt_no = v_rno) then
    raise exception 'receipt no. % was already used in the old software', v_rno using errcode = '22023';
  end if;

  update public.payments
     set paid_amount = v_amount, paid_date = v_date, payment_mode = v_mode,
         reference_no = nullif(btrim(p ->> 'reference_no'), ''),
         bank_name = case when v_mode = 'BANK' then nullif(btrim(p ->> 'bank_name'), '') end,
         receipt_no = v_rno, installments_covered = v_im
   where id = p_id;
  perform app_private.reflow_payments(o.legacy_account_id, o.loan_id);
  select * into n from public.payments where id = p_id;

  d := app_private.diff(to_jsonb(o), to_jsonb(n),
         array['paid_amount', 'paid_date', 'payment_mode', 'reference_no', 'bank_name', 'receipt_no', 'installments_covered']);
  if d = '{}' then raise exception 'nothing was changed' using errcode = '22023'; end if;
  r := app_private.acct_ref(o.legacy_account_id, o.loan_id);
  perform app_private.log('payment_edited', r ->> 'subject', r - 'subject',
    jsonb_build_object('reason', v_reason, 'receipt_no', o.receipt_no, 'changes', d));
  perform app_private.tg_quiet((select tg_on_payment from public.app_settings where id = 1),
    '✏️ Payment edited' || chr(10) || coalesce(r ->> 'subject', '?') || chr(10) ||
    'Rcpt ' || o.receipt_no || ': ' || app_private.inr(o.paid_amount) || ' on ' || to_char(o.paid_date, 'DD-MM-YYYY') ||
    ' → Rcpt ' || n.receipt_no || ': ' || app_private.inr(n.paid_amount) || ' on ' || to_char(n.paid_date, 'DD-MM-YYYY') || chr(10) ||
    'Reason: ' || v_reason || chr(10) || 'By ' || app_private.staff_name((select auth.uid())),
    'payment_edited');
  return jsonb_build_object('id', n.id, 'receipt_no', n.receipt_no, 'balance_after', n.balance_after);
end;
$$;

create or replace function public.admin_cancel_payment(p_id bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_reason text := app_private.need_reason(p_reason); o public.payments; r jsonb;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  select * into o from public.payments where id = p_id;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  perform app_private.payment_lock(o);
  select * into o from public.payments where id = p_id for update;
  r := app_private.acct_ref(o.legacy_account_id, o.loan_id);

  delete from public.payments where id = p_id;
  perform app_private.reflow_payments(o.legacy_account_id, o.loan_id);

  perform app_private.log('payment_cancelled', r ->> 'subject', r - 'subject',
    jsonb_build_object('reason', v_reason, 'receipt_no', o.receipt_no, 'amount', o.paid_amount, 'paid_date', o.paid_date,
                       'payment', to_jsonb(o)));
  perform app_private.tg_quiet((select tg_on_payment from public.app_settings where id = 1),
    '❌ Payment cancelled' || chr(10) || coalesce(r ->> 'subject', '?') || chr(10) ||
    'Rcpt ' || o.receipt_no || ' · ' || app_private.inr(o.paid_amount) || ' on ' || to_char(o.paid_date, 'DD-MM-YYYY') || chr(10) ||
    'Reason: ' || v_reason || chr(10) || 'By ' || app_private.staff_name((select auth.uid())),
    'payment_cancelled');
  return jsonb_build_object('cancelled', p_id);
end;
$$;

-- ---------------------------------------------------------------- loans: edit / delete (admin)
-- p = the New Loan form fields (same keys as create_loan)
create or replace function public.admin_edit_loan(p_loan bigint, p jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := app_private.need_reason(p_reason);
  ol public.loans; nl public.loans; ob public.borrowers; nb public.borrowers; v_amt record; d jsonb; r jsonb;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('payment:new:' || p_loan));
  select * into ol from public.loans where id = p_loan for update;
  if not found then raise exception 'loan not found' using errcode = 'P0002'; end if;
  select * into ob from public.borrowers where id = ol.borrower_id for update;

  select * into v_amt from public.loan_amounts(
    (p ->> 'finance_amount')::numeric, (p ->> 'interest_rate')::numeric,
    (p ->> 'installments')::int, (p ->> 'interval_months')::int,
    coalesce((p ->> 'agreement_amount')::numeric, 0), coalesce((p ->> 'hp_amount')::numeric, 0));

  update public.borrowers
     set full_name = p ->> 'borrower_name', father_name = p ->> 'borrower_father', mobile = p ->> 'borrower_mobile',
         date_of_birth = (p ->> 'borrower_dob')::date, address = p ->> 'borrower_address'
   where id = ob.id returning * into nb;
  update public.loans
     set folio_no = btrim(p ->> 'folio_no'), zone = p ->> 'zone', dealer = p ->> 'dealer', loan_type = p ->> 'loan_type',
         guarantor_name = p ->> 'guarantor_name', guarantor_father = p ->> 'guarantor_father',
         guarantor_mobile = p ->> 'guarantor_mobile', guarantor_address = p ->> 'guarantor_address',
         vehicle_condition = p ->> 'vehicle_condition', sold_by = p ->> 'sold_by', vehicle_model = p ->> 'vehicle_model',
         vehicle_color = p ->> 'vehicle_color', chassis_no = p ->> 'chassis_no', engine_no = p ->> 'engine_no',
         make_year = (p ->> 'make_year')::int, vehicle_no = p ->> 'vehicle_no', insurance_expiry = (p ->> 'insurance_expiry')::date,
         agreement_date = (p ->> 'agreement_date')::date, installments = (p ->> 'installments')::int,
         interval_months = (p ->> 'interval_months')::int, finance_amount = (p ->> 'finance_amount')::numeric,
         interest_rate = (p ->> 'interest_rate')::numeric,
         agreement_amount = coalesce((p ->> 'agreement_amount')::numeric, 0), hp_amount = coalesce((p ->> 'hp_amount')::numeric, 0),
         interest_amount = v_amt.interest, total_amount = v_amt.total, emi_amount = v_amt.emi
   where id = p_loan returning * into nl;
  perform app_private.reflow_payments(null, p_loan);

  d := app_private.diff(to_jsonb(ob), to_jsonb(nb), array['full_name', 'father_name', 'mobile', 'date_of_birth', 'address'])
    || app_private.diff(to_jsonb(ol), to_jsonb(nl), array['folio_no', 'zone', 'dealer', 'loan_type', 'guarantor_name',
         'guarantor_father', 'guarantor_mobile', 'guarantor_address', 'vehicle_condition', 'sold_by', 'vehicle_model',
         'vehicle_color', 'chassis_no', 'engine_no', 'make_year', 'vehicle_no', 'insurance_expiry', 'agreement_date',
         'installments', 'interval_months', 'finance_amount', 'interest_rate', 'agreement_amount', 'hp_amount',
         'interest_amount', 'total_amount', 'emi_amount']);
  if d = '{}' then raise exception 'nothing was changed' using errcode = '22023'; end if;
  r := app_private.acct_ref(null, p_loan);
  perform app_private.log('loan_edited', r ->> 'subject', r - 'subject', jsonb_build_object('reason', v_reason, 'changes', d));
  perform app_private.tg_quiet((select tg_on_new_loan from public.app_settings where id = 1),
    '✏️ Loan edited' || chr(10) || coalesce(r ->> 'subject', '?') || chr(10) ||
    'Changed: ' || (select string_agg(replace(k, '_', ' '), ', ') from jsonb_object_keys(d) k) || chr(10) ||
    case when ol.total_amount <> nl.total_amount or ol.emi_amount <> nl.emi_amount
         then 'Total ' || app_private.inr(nl.total_amount) || ' · EMI ' || app_private.inr(nl.emi_amount) || chr(10) else '' end ||
    'Reason: ' || v_reason || chr(10) || 'By ' || app_private.staff_name((select auth.uid())),
    'loan_edited');
  return jsonb_build_object('id', p_loan, 'total_amount', nl.total_amount, 'emi_amount', nl.emi_amount);
end;
$$;

create or replace function public.admin_delete_loan(p_loan bigint, p_reason text, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_reason text := app_private.need_reason(p_reason); l public.loans; b public.borrowers; r jsonb; s jsonb;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if p_confirm is distinct from 'DELETE' then raise exception 'type DELETE to confirm' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('payment:new:' || p_loan));
  select * into l from public.loans where id = p_loan for update;
  if not found then raise exception 'loan not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.payments where loan_id = p_loan) then
    raise exception 'this loan has payments; cancel them first' using errcode = '22023';
  end if;
  select * into b from public.borrowers where id = l.borrower_id;
  r := app_private.acct_ref(null, p_loan);
  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into s from public.seizures x where x.loan_id = p_loan;

  delete from public.seizures where loan_id = p_loan;
  delete from public.loans where id = p_loan;
  if not exists (select 1 from public.loans where borrower_id = b.id) then delete from public.borrowers where id = b.id; end if;

  -- the full copy stays in the log
  perform app_private.log('loan_deleted', r ->> 'subject', null,
    jsonb_build_object('reason', v_reason, 'loan', to_jsonb(l), 'borrower', to_jsonb(b), 'seizures', s));
  perform app_private.tg_quiet((select tg_on_new_loan from public.app_settings where id = 1),
    '🗑 Loan deleted' || chr(10) || coalesce(r ->> 'subject', '?') || chr(10) ||
    'Total ' || app_private.inr(l.total_amount) || chr(10) ||
    'Reason: ' || v_reason || chr(10) || 'By ' || app_private.staff_name((select auth.uid())),
    'loan_deleted');
  return jsonb_build_object('deleted', p_loan);
end;
$$;

revoke execute on all functions in schema app_private from public, anon, authenticated;
revoke execute on function public.admin_edit_payment(bigint, jsonb, text), public.admin_cancel_payment(bigint, text),
  public.admin_edit_loan(bigint, jsonb, text), public.admin_delete_loan(bigint, text, text) from anon, public;
grant execute on function public.admin_edit_payment(bigint, jsonb, text), public.admin_cancel_payment(bigint, text),
  public.admin_edit_loan(bigint, jsonb, text), public.admin_delete_loan(bigint, text, text) to authenticated;
