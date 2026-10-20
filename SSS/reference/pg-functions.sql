-- ===== app_private.acc_business
CREATE OR REPLACE FUNCTION app_private.acc_business(a legacy_accounts)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select to_jsonb(a) - array['id','import_batch_id','raw','search_text','legacy_paid','legacy_payments_count','legacy_last_paid','recovery'];
$function$
;

-- ===== app_private.acct_ref
CREATE OR REPLACE FUNCTION app_private.acct_ref(p_acct bigint, p_loan bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when p_acct is not null then
      (select jsonb_build_object('subject', 'SNO ' || a.sno || ' · ' || a.borrower_name, 'source', 'old', 'ref_id', a.sno)
         from public.legacy_accounts a where a.id = p_acct)
    else
      (select jsonb_build_object('subject', 'Folio ' || l.folio_no || ' · ' || b.full_name, 'source', 'new', 'ref_id', l.id)
         from public.loans l join public.borrowers b on b.id = l.borrower_id where l.id = p_loan)
  end;
$function$
;

-- ===== app_private.acct_zone
CREATE OR REPLACE FUNCTION app_private.acct_zone(p_acct bigint, p_loan bigint)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select zone from public.legacy_accounts where id = p_acct), (select zone from public.loans where id = p_loan));
$function$
;

-- ===== app_private.active_reschedule
CREATE OR REPLACE FUNCTION app_private.active_reschedule(p_acct bigint, p_loan bigint)
 RETURNS adjustments
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select * from public.adjustments
   where kind = 'reschedule' and cancelled_at is null and (legacy_account_id = p_acct or loan_id = p_loan)
   order by created_at desc, id desc limit 1;
$function$
;

-- ===== app_private.array_text
CREATE OR REPLACE FUNCTION app_private.array_text(v text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when v is null or v = '' then null
              when left(btrim(v), 1) = '[' then (select coalesce(array_agg(x), '{}')::text from jsonb_array_elements_text(v::jsonb) x)
              else v end;
$function$
;

-- ===== app_private.audit
CREATE OR REPLACE FUNCTION app_private.audit(p_action text, p_details jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.data_audit (by_user, by_name, action, details)
  values ((select auth.uid()), (select full_name from public.staff where user_id = (select auth.uid())), p_action, p_details);
$function$
;

-- ===== app_private.audit_loan
CREATE OR REPLACE FUNCTION app_private.audit_loan()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb := app_private.acct_ref(null, new.id);
begin
  perform app_private.log('new_loan', r ->> 'subject', r - 'subject',
    jsonb_build_object('finance', new.finance_amount, 'total', new.total_amount, 'emi', new.emi_amount, 'emis', new.installments),
    new.created_by);
  return null;
end;
$function$
;

-- ===== app_private.audit_payment
CREATE OR REPLACE FUNCTION app_private.audit_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb := app_private.acct_ref(new.legacy_account_id, new.loan_id);
begin
  perform app_private.log('payment', r ->> 'subject', r - 'subject',
    jsonb_build_object('amount', new.paid_amount, 'receipt_no', new.receipt_no, 'paid_date', new.paid_date,
                       'mode', new.payment_mode, 'emis', new.installments_covered), new.created_by);
  return null;
end;
$function$
;

-- ===== app_private.audit_seizure
CREATE OR REPLACE FUNCTION app_private.audit_seizure()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb := app_private.acct_ref(new.legacy_account_id, new.loan_id);
begin
  perform app_private.log(new.action, r ->> 'subject', r - 'subject',
    jsonb_build_object('date', new.action_date, 'remarks', new.remarks), new.created_by);
  return null;
end;
$function$
;

-- ===== app_private.audit_settings
CREATE OR REPLACE FUNCTION app_private.audit_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

-- ===== app_private.audit_staff
CREATE OR REPLACE FUNCTION app_private.audit_staff()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

-- ===== app_private.books_series
CREATE OR REPLACE FUNCTION app_private.books_series()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.series_id is null then new.series_id := coalesce(app_private.open_series(null), app_private.ensure_main()); end if;
  return new;
end;
$function$
;

-- ===== app_private.cancel_payment_core
CREATE OR REPLACE FUNCTION app_private.cancel_payment_core(p_id bigint, p_reason text, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.payments; r jsonb;
begin
  select * into o from public.payments where id = p_id;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  perform app_private.payment_lock(o);
  select * into o from public.payments where id = p_id for update;
  r := app_private.acct_ref(o.legacy_account_id, o.loan_id);
  delete from public.payments where id = p_id;
  perform app_private.reflow_payments(o.legacy_account_id, o.loan_id);
  perform app_private.log(p_action, r ->> 'subject', r - 'subject',
    jsonb_build_object('reason', p_reason, 'receipt_no', o.receipt_no, 'amount', o.paid_amount, 'paid_date', o.paid_date,
                       'payment', to_jsonb(o)));
  perform app_private.tg_quiet((select tg_on_payment from public.app_settings where id = 1),
    case when p_action = 'payment_rejected' then '⛔ Payment rejected' else '❌ Payment cancelled' end || chr(10) ||
    coalesce(r ->> 'subject', '?') || chr(10) ||
    'Rcpt ' || o.receipt_no || ' · ' || app_private.inr(o.paid_amount) || ' on ' || to_char(o.paid_date, 'DD/MM/YYYY') || chr(10) ||
    'Reason: ' || p_reason || chr(10) || 'By ' || app_private.staff_name((select auth.uid())),
    p_action);
end;
$function$
;

-- ===== app_private.check_parts
CREATE OR REPLACE FUNCTION app_private.check_parts(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare x jsonb; out jsonb := '[]'; v_mode text; v_amt numeric;
begin
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) < 2 or jsonb_array_length(p) > 4 then
    raise exception 'a split payment needs 2 to 4 parts' using errcode = '22023';
  end if;
  for x in select * from jsonb_array_elements(p) loop
    v_mode := x ->> 'mode';
    v_amt := (x ->> 'amount')::numeric;
    if v_mode is null or v_mode not in ('CASH', 'CHEQUE', 'SBI', 'BANK') then raise exception 'choose the mode of each part' using errcode = '22023'; end if;
    if v_amt is null or v_amt <= 0 then raise exception 'each part needs an amount more than 0' using errcode = '22023'; end if;
    if v_mode = 'BANK' and nullif(btrim(x ->> 'bank_name'), '') is null then raise exception 'enter the bank name for the bank part' using errcode = '22023'; end if;
    if v_mode = 'CHEQUE' and nullif(btrim(x ->> 'reference_no'), '') is null then raise exception 'enter the cheque number for the cheque part' using errcode = '22023'; end if;
    out := out || jsonb_build_object('mode', v_mode, 'amount', round(v_amt, 2),
                                     'bank_name', nullif(btrim(x ->> 'bank_name'), ''), 'reference_no', nullif(btrim(x ->> 'reference_no'), ''));
  end loop;
  return out;
end;
$function$
;

-- ===== app_private.clean_perms
CREATE OR REPLACE FUNCTION app_private.clean_perms(p text[])
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when cardinality(x) = 0 then x else (select array_agg(distinct k order by k) from unnest(x || array['view_accounts']) k) end
  from (select coalesce(array(select k from unnest(p) k where k = any (array[
          'view_accounts','collect','new_loan','seize','reports','backdate','fix_entries','money','cash','approve','backup','activity','assign'])), '{}') as x) q;
$function$
;

-- ===== app_private.daily_summary
CREATE OR REPLACE FUNCTION app_private.daily_summary(p_day date, p_dedupe text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_cnt int; v_sum numeric; v_modes text; v_loans int; v_loan_sum numeric; v_seized int; v_released int;
        v_due_cnt int; v_due_sum numeric; v_arr numeric; v_name text;
begin
  select count(*), coalesce(sum(paid_amount), 0) into v_cnt, v_sum from public.payments where paid_date = p_day;
  select string_agg(payment_mode || ' ' || app_private.inr(t), ' · ' order by payment_mode) into v_modes
    from (select m.mode as payment_mode, sum(public.mode_part(pm.payment_mode, pm.paid_amount, pm.parts, m.mode)) t
                           from public.payments pm cross join (values ('CASH'), ('CHEQUE'), ('SBI'), ('BANK')) m(mode)
                          where pm.paid_date = p_day group by 1 having sum(public.mode_part(pm.payment_mode, pm.paid_amount, pm.parts, m.mode)) > 0) x;
  select count(*), coalesce(sum(finance_amount), 0) into v_loans, v_loan_sum from public.loans where agreement_date = p_day;
  select count(*) filter (where action = 'seize'), count(*) filter (where action = 'release') into v_seized, v_released
    from public.seizures where action_date = p_day;
  select count(*), coalesce(sum(emi), 0), coalesce(sum(arrears), 0) into v_due_cnt, v_due_sum, v_arr
    from public.due_report(p_day) where next_due = p_day and not seized;
  select business_name into v_name from public.app_settings where id = 1;
  return app_private.tg_send(
    '📊 ' || v_name || ' — ' || to_char(p_day, 'DD/MM/YYYY') || chr(10) || chr(10) ||
    '💰 Collected: ' || app_private.inr(v_sum) || ' (' || v_cnt || ' receipts)' ||
      coalesce(chr(10) || '    ' || v_modes, '') || chr(10) ||
    '🆕 New loans: ' || v_loans || coalesce(' · ' || app_private.inr(nullif(v_loan_sum, 0)), '') || chr(10) ||
    '🚨 Seized: ' || v_seized || ' · ✅ Released: ' || v_released || chr(10) ||
    '📅 EMIs due today: ' || v_due_cnt || ' · ' || app_private.inr(v_due_sum),
    'daily_summary', p_dedupe);
end;
$function$
;

-- ===== app_private.data_counts
CREATE OR REPLACE FUNCTION app_private.data_counts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t text; n bigint; out jsonb := '{}';
begin
  foreach t in array app_private.data_tables() loop
    execute format('select count(*) from public.%I', t) into n;
    out := out || jsonb_build_object(t, n);
  end loop;
  return out;
end;
$function$
;

-- ===== app_private.data_tables
CREATE OR REPLACE FUNCTION app_private.data_tables()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select array['zones','receipt_series','import_batches','legacy_accounts','legacy_payments','borrowers','loans','payments','seizures',
               'adjustments','receipt_books','cash_closings','collection_assignments','pending_payments','visit_remarks'];
$function$
;

-- ===== app_private.diff
CREATE OR REPLACE FUNCTION app_private.diff(a jsonb, b jsonb, keys text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('from', a -> k, 'to', b -> k)), '{}')
    from unnest(keys) k where (a -> k) is distinct from (b -> k);
$function$
;

-- ===== app_private.due_reminders
CREATE OR REPLACE FUNCTION app_private.due_reminders(p_day date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.app_settings; r record; n int := 0; v_target date;
begin
  select * into s from public.app_settings where id = 1;
  v_target := p_day + s.wa_reminder_days_before;
  for r in
    select * from public.due_report(p_day)
     where next_due = v_target and not seized and app_private.wa_number(mobile) is not null
     limit 300
  loop
    if app_private.wa_send(r.mobile,
         app_private.fill(s.wa_reminder_template, jsonb_build_object(
           'name', r.borrower_name, 'folio', r.folio, 'emi', app_private.inr(r.emi), 'due_date', to_char(r.next_due, 'DD/MM/YYYY'),
           'balance', app_private.inr(r.balance), 'arrears', app_private.inr(r.arrears), 'business', s.business_name)),
         'due_reminder', 'wa-due-' || r.source || '-' || r.ref_id || '-' || r.next_due) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$function$
;

-- ===== app_private.ensure_main
CREATE OR REPLACE FUNCTION app_private.ensure_main()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v bigint;
begin
  select id into v from public.receipt_series where zone_id is null and closed_at is null;
  if v is null then
    insert into public.receipt_series (zone_id, book_no, code, start_no, opened_by)
    values (null, coalesce((select max(book_no) from public.receipt_series where zone_id is null), 0) + 1, 'MAIN', 1, null)
    on conflict do nothing returning id into v;
    if v is null then select id into v from public.receipt_series where code = 'MAIN'; end if;
  end if;
  return v;
end;
$function$
;

-- ===== app_private.fill
CREATE OR REPLACE FUNCTION app_private.fill(tpl text, vals jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare k text; out text := tpl;
begin
  for k in select jsonb_object_keys(vals) loop
    out := replace(out, '{' || k || '}', coalesce(vals ->> k, ''));
  end loop;
  return out;
end;
$function$
;

-- ===== app_private.history_series
CREATE OR REPLACE FUNCTION app_private.history_series(p_zone text)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select s.id from public.receipt_series s join public.zones z on z.id = s.zone_id
      where upper(z.name) = upper(btrim(p_zone)) order by s.book_no limit 1),
    (select id from public.receipt_series where zone_id is null order by book_no limit 1));
$function$
;

-- ===== app_private.inr
CREATE OR REPLACE FUNCTION app_private.inr(v numeric)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  neg boolean := v < 0;
  a numeric := abs(round(v, 2));
  r text := trunc(a)::bigint::text;
  p int := ((a - trunc(a)) * 100)::int;
  last3 text; rest text;
begin
  if length(r) > 3 then
    last3 := right(r, 3);
    rest := left(r, length(r) - 3);
    rest := regexp_replace(rest, '(\d)(?=(\d{2})+$)', '\1,', 'g');
    r := rest || ',' || last3;
  end if;
  return (case when neg then '-' else '' end) || '₹' || r || case when p > 0 then '.' || lpad(p::text, 2, '0') else '' end;
end;
$function$
;

-- ===== app_private.known_user
CREATE OR REPLACE FUNCTION app_private.known_user(v text, p_admin uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when nullif(v, '') is null then null
              when exists (select 1 from public.staff s where s.user_id::text = v) then v::uuid
              else p_admin end;
$function$
;

-- ===== app_private.legacy_series
CREATE OR REPLACE FUNCTION app_private.legacy_series()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.series_id is null then
    new.series_id := coalesce(app_private.history_series((select zone from public.legacy_accounts where id = new.account_id)), app_private.ensure_main());
  end if;
  new.receipt_book := app_private.series_code(new.series_id);
  return new;
end;
$function$
;

-- ===== app_private.log
CREATE OR REPLACE FUNCTION app_private.log(p_action text, p_subject text, p_ref jsonb, p_details jsonb, p_user uuid DEFAULT NULL::uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.data_audit (at, by_user, by_name, action, subject, ref, details)
  values (coalesce(p_at, now()), coalesce(p_user, (select auth.uid())),
          (select full_name from public.staff where user_id = coalesce(p_user, (select auth.uid()))),
          p_action, p_subject, p_ref, coalesce(p_details, '{}'));
$function$
;

-- ===== app_private.make_restore_point
CREATE OR REPLACE FUNCTION app_private.make_restore_point(p_reason text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

-- ===== app_private.my_backup_job
CREATE OR REPLACE FUNCTION app_private.my_backup_job(p_job uuid)
 RETURNS app_private.backup_jobs
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j app_private.backup_jobs;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  select * into j from app_private.backup_jobs where id = p_job and created_by = (select auth.uid());
  if not found then raise exception 'this upload has expired; choose the file again' using errcode = '22023'; end if;
  if j.status <> 'staged' then raise exception 'this backup was already restored' using errcode = '22023'; end if;
  return j;
end;
$function$
;

-- ===== app_private.my_job
CREATE OR REPLACE FUNCTION app_private.my_job(p_job uuid)
 RETURNS app_private.import_jobs
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j app_private.import_jobs;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  select * into j from app_private.import_jobs where id = p_job and created_by = (select auth.uid());
  if not found then raise exception 'this upload has expired; choose the files again' using errcode = '22023'; end if;
  return j;
end;
$function$
;

-- ===== app_private.need_reason
CREATE OR REPLACE FUNCTION app_private.need_reason(p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare v text := nullif(btrim(p_reason), '');
begin
  if v is null then raise exception 'enter the reason' using errcode = '22023'; end if;
  if length(v) > 300 then raise exception 'reason is too long (300 characters at most)' using errcode = '22023'; end if;
  return v;
end;
$function$
;

-- ===== app_private.next_due_date
CREATE OR REPLACE FUNCTION app_private.next_due_date(p_acct bigint, p_loan bigint, p_iv integer, p_start date, p_used integer, p_last_due date, p_last_im integer, p_paid_after numeric)
 RETURNS date
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare rs public.adjustments := app_private.active_reschedule(p_acct, p_loan);
begin
  if rs.id is not null then
    return (rs.next_due + make_interval(months => greatest(0, floor(p_paid_after / rs.new_emi))::int * p_iv))::date;
  elsif p_last_due is not null then
    return (p_last_due + make_interval(months => p_last_im * p_iv))::date;
  elsif p_start is not null then
    return (p_start + make_interval(months => (p_used + 1) * p_iv))::date;
  end if;
  return null;
end;
$function$
;

-- ===== app_private.on_new_loan
CREATE OR REPLACE FUNCTION app_private.on_new_loan()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.app_settings; v_name text; v_mobile text;
begin
  begin
    select * into s from public.app_settings where id = 1;
    if s.tg_on_new_loan then
      select full_name, mobile into v_name, v_mobile from public.borrowers where id = new.borrower_id;
      perform app_private.tg_send(
        '🆕 New loan' || chr(10) ||
        coalesce(v_name, '?') || ' · Folio ' || new.folio_no || coalesce(' · ' || v_mobile, '') || chr(10) ||
        'Finance ' || app_private.inr(new.finance_amount) || ' · Total ' || app_private.inr(new.total_amount) || chr(10) ||
        'EMI ' || app_private.inr(new.emi_amount) || ' × ' || new.installments || chr(10) ||
        coalesce(new.vehicle_model, '') || coalesce(' · ' || new.vehicle_no, '') || chr(10) ||
        'By ' || app_private.staff_name(new.created_by),
        'new_loan', 'tg-loan-' || new.id);
    end if;
  exception when others then
    raise warning 'loan notification failed: %', sqlerrm;
  end;
  return null;
end;
$function$
;

-- ===== app_private.on_payment
CREATE OR REPLACE FUNCTION app_private.on_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.app_settings; v_name text; v_folio text; v_mobile text; v_txt text;
begin
  begin
    select * into s from public.app_settings where id = 1;
    if new.legacy_account_id is not null then
      select borrower_name, fno::text, borrower_mobile into v_name, v_folio, v_mobile from public.legacy_accounts where id = new.legacy_account_id;
    else
      select b.full_name, l.folio_no, b.mobile into v_name, v_folio, v_mobile
        from public.loans l join public.borrowers b on b.id = l.borrower_id where l.id = new.loan_id;
    end if;

    if s.tg_on_payment then
      perform app_private.tg_send(
        '💰 Payment received' || chr(10) ||
        coalesce(v_name, '?') || ' · Folio ' || coalesce(v_folio, '?') || chr(10) ||
        app_private.inr(new.paid_amount) || ' · ' || public.payment_mode_text(new.payment_mode, new.bank_name, new.parts) ||
          coalesce(' · Rcpt ' || coalesce(new.receipt_book || '/', '') || new.receipt_no, '') || case when new.installments_covered > 1 then ' · ' || new.installments_covered || ' EMIs' else '' end || chr(10) ||
        'Balance ' || app_private.inr(new.balance_after) || chr(10) ||
        'By ' || app_private.staff_name(new.created_by),
        'payment', 'tg-pay-' || new.id);
    end if;

    if s.wa_receipt then
      v_txt := app_private.fill(s.wa_receipt_template, jsonb_build_object(
        'name', v_name, 'folio', v_folio, 'amount', app_private.inr(new.paid_amount), 'date', to_char(new.paid_date, 'DD/MM/YYYY'),
        'receipt', coalesce(new.receipt_book || '/', '') || new.receipt_no::text, 'balance', app_private.inr(new.balance_after), 'business', s.business_name));
      perform app_private.wa_send(v_mobile, v_txt, 'receipt', 'wa-pay-' || new.id);
    end if;
  exception when others then
    raise warning 'payment notification failed: %', sqlerrm;   -- never block the payment
  end;
  return null;
end;
$function$
;

-- ===== app_private.on_seizure
CREATE OR REPLACE FUNCTION app_private.on_seizure()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.app_settings; v_name text; v_folio text;
begin
  begin
    select * into s from public.app_settings where id = 1;
    if s.tg_on_seizure then
      if new.legacy_account_id is not null then
        select borrower_name, fno::text into v_name, v_folio from public.legacy_accounts where id = new.legacy_account_id;
      else
        select b.full_name, l.folio_no into v_name, v_folio from public.loans l join public.borrowers b on b.id = l.borrower_id where l.id = new.loan_id;
      end if;
      perform app_private.tg_send(
        case when new.action = 'seize' then '🚨 Vehicle seized' else '✅ Vehicle released' end || chr(10) ||
        coalesce(v_name, '?') || ' · Folio ' || coalesce(v_folio, '?') || chr(10) ||
        'Date ' || to_char(new.action_date, 'DD/MM/YYYY') || coalesce(chr(10) || new.remarks, '') || chr(10) ||
        'By ' || app_private.staff_name(new.created_by),
        new.action, 'tg-seize-' || new.id);
    end if;
  exception when others then
    raise warning 'seizure notification failed: %', sqlerrm;
  end;
  return null;
end;
$function$
;

-- ===== app_private.open_series
CREATE OR REPLACE FUNCTION app_private.open_series(p_zone text)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select s.id from public.receipt_series s join public.zones z on z.id = s.zone_id
      where upper(z.name) = upper(btrim(p_zone)) and s.closed_at is null),
    (select id from public.receipt_series where zone_id is null and closed_at is null));
$function$
;

-- ===== app_private.owed
CREATE OR REPLACE FUNCTION app_private.owed(p_acct bigint, p_loan bigint)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when p_acct is not null then
           (select a.total_amount + public.adj_total(a.id, null) - a.legacy_paid
                   - coalesce((select sum(paid_amount) from public.payments where legacy_account_id = a.id), 0)
              from public.legacy_accounts a where a.id = p_acct)
         else
           (select l.total_amount + public.adj_total(null, l.id)
                   - coalesce((select sum(paid_amount) from public.payments where loan_id = l.id), 0)
              from public.loans l where l.id = p_loan)
         end;
$function$
;

-- ===== app_private.paid_after
CREATE OR REPLACE FUNCTION app_private.paid_after(p_source text, p_ref bigint, p_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.payments p
                  where p.created_at > p_at
                    and (case when p_source = 'old' then p.legacy_account_id = (select id from public.legacy_accounts where sno = p_ref)
                              else p.loan_id = p_ref end))
      or exists (select 1 from public.pending_payments w where w.source = p_source and w.ref_id = p_ref and w.created_at > p_at);
$function$
;

-- ===== app_private.paid_since_reschedule
CREATE OR REPLACE FUNCTION app_private.paid_since_reschedule(p_acct bigint, p_loan bigint)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare rs public.adjustments := app_private.active_reschedule(p_acct, p_loan); v numeric := 0;
begin
  if rs.id is null then return 0; end if;
  if p_acct is not null then
    select coalesce(sum(lp.paid_amount), 0) into v from public.legacy_payments lp
      join public.legacy_accounts a on a.id = lp.account_id and a.ledger = lp.ledger
     where lp.account_id = p_acct and lp.paid_date >= rs.entry_date;
  end if;
  return v + coalesce((select sum(paid_amount) from public.payments
                        where (legacy_account_id = p_acct or loan_id = p_loan) and created_at > rs.created_at), 0);
end;
$function$
;

-- ===== app_private.payment_lock
CREATE OR REPLACE FUNCTION app_private.payment_lock(p payments)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- same lock as record_payment(), so a fix and a new payment on one account never run together
  if p.legacy_account_id is not null then
    perform pg_advisory_xact_lock(hashtext('payment:old:' || (select sno from public.legacy_accounts where id = p.legacy_account_id)));
  else
    perform pg_advisory_xact_lock(hashtext('payment:new:' || p.loan_id));
  end if;
end;
$function$
;

-- ===== app_private.payments_series
CREATE OR REPLACE FUNCTION app_private.payments_series()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.series_id is null then
    new.series_id := coalesce(app_private.open_series(app_private.acct_zone(new.legacy_account_id, new.loan_id)), app_private.ensure_main());
  end if;
  new.receipt_book := app_private.series_code(new.series_id);
  return new;
end;
$function$
;

-- ===== app_private.pending_series
CREATE OR REPLACE FUNCTION app_private.pending_series()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.series_id is null then
    new.series_id := coalesce(app_private.open_series(app_private.ref_zone(new.source, new.ref_id)), app_private.ensure_main());
  end if;
  new.receipt_book := app_private.series_code(new.series_id);
  return new;
end;
$function$
;

-- ===== app_private.post_payment
CREATE OR REPLACE FUNCTION app_private.post_payment(p jsonb, p_by uuid, p_at timestamp with time zone)
 RETURNS payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_source text := p ->> 'source'; v_ref bigint := (p ->> 'ref_id')::bigint;
  v_amount numeric := (p ->> 'paid_amount')::numeric; v_date date := (p ->> 'paid_date')::date;
  v_im int := coalesce((p ->> 'installments_covered')::int, 1);
  v_acct bigint; v_loan bigint; v_total numeric; v_emi numeric; v_interval int; v_start date;
  v_paid numeric; v_next int; v_used int; v_last_due date; v_last_im int; v_due date; v_row public.payments;
begin
  perform pg_advisory_xact_lock(hashtext('payment:' || v_source || ':' || v_ref));
  if v_source = 'old' then
    select id, total_amount, emi_amount, greatest(coalesce(interval_months, 1), 1), agreement_date
      into v_acct, v_total, v_emi, v_interval, v_start
      from public.legacy_accounts where sno = v_ref and ledger = 'pending';
    if not found or public.legacy_settled(v_acct) then raise exception 'account not found or not pending' using errcode = 'P0002'; end if;
    select coalesce(sum(amt), 0), coalesce(max(n), 0), coalesce(sum(im), 0) into v_paid, v_next, v_used from (
      select installment_no n, paid_amount amt, case when v_emi > 0 then greatest(1, round(paid_amount / v_emi))::int else 1 end im
        from public.legacy_payments where account_id = v_acct and ledger = 'pending'
      union all
      select installment_no, paid_amount, installments_covered from public.payments where legacy_account_id = v_acct) r;
    select d, im into v_last_due, v_last_im from (
      select installment_no n, due_date d, case when v_emi > 0 then greatest(1, round(paid_amount / v_emi))::int else 1 end im
        from public.legacy_payments where account_id = v_acct and ledger = 'pending'
      union all
      select installment_no, due_date, installments_covered from public.payments where legacy_account_id = v_acct) r
     where d is not null order by n desc limit 1;
  elsif v_source = 'new' then
    select id, total_amount, emi_amount, interval_months, agreement_date
      into v_loan, v_total, v_emi, v_interval, v_start
      from public.loans where id = v_ref and status in ('active', 'seized');
    if not found then raise exception 'loan not found or closed' using errcode = 'P0002'; end if;
    select coalesce(sum(paid_amount), 0), coalesce(max(installment_no), 0), coalesce(sum(installments_covered), 0)
      into v_paid, v_next, v_used from public.payments where loan_id = v_loan;
    select due_date, installments_covered into v_last_due, v_last_im
      from public.payments where loan_id = v_loan and due_date is not null order by installment_no desc limit 1;
  else
    raise exception 'bad source' using errcode = '22023';
  end if;

  v_next := v_next + 1;
  v_total := v_total + public.adj_total(v_acct, v_loan);
  v_due := app_private.next_due_date(v_acct, v_loan, v_interval, v_start, v_used, v_last_due, v_last_im,
                                     app_private.paid_since_reschedule(v_acct, v_loan));
  if (app_private.active_reschedule(v_acct, v_loan)).id is not null then v_emi := (app_private.active_reschedule(v_acct, v_loan)).new_emi; end if;

  insert into public.payments (legacy_account_id, loan_id, installment_no, due_date, due_amount, paid_amount, paid_date,
                               payment_mode, reference_no, bank_name, receipt_no, balance_after, delay_days,
                               installments_covered, idempotency_key, created_by, created_at, parts, series_id)
  values (v_acct, v_loan, v_next, v_due, v_emi, v_amount, v_date,
          p ->> 'payment_mode', nullif(btrim(p ->> 'reference_no'), ''), nullif(btrim(p ->> 'bank_name'), ''),
          (p ->> 'receipt_no')::bigint, v_total - v_paid - v_amount, v_date - v_due, v_im, (p ->> 'idempotency_key')::uuid,
          p_by, p_at, case when p ->> 'payment_mode' = 'SPLIT' then p -> 'parts' end, (p ->> 'series_id')::bigint)
  returning * into v_row;
  return v_row;
end;
$function$
;

-- ===== app_private.ref_zone
CREATE OR REPLACE FUNCTION app_private.ref_zone(p_source text, p_ref bigint)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case p_source when 'old' then (select zone from public.legacy_accounts where sno = p_ref)
                       when 'new' then (select zone from public.loans where id = p_ref) end;
$function$
;

-- ===== app_private.reflow_payments
CREATE OR REPLACE FUNCTION app_private.reflow_payments(p_acct bigint, p_loan bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_total numeric; v_emi numeric; v_iv int; v_start date; v_ledger text;
  v_paid numeric := 0; v_used int := 0; v_n int := 0; v_last_due date; v_last_im int; v_due date; r record;
  rs public.adjustments := app_private.active_reschedule(p_acct, p_loan); v_after numeric := 0;
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
    if rs.id is not null then
      select coalesce(sum(paid_amount), 0) into v_after from public.legacy_payments
       where account_id = p_acct and ledger = v_ledger and paid_date >= rs.entry_date;
    end if;
  else
    select total_amount, emi_amount, greatest(interval_months, 1), agreement_date
      into v_total, v_emi, v_iv, v_start from public.loans where id = p_loan;
  end if;
  v_total := v_total + public.adj_total(p_acct, p_loan);

  update public.payments set installment_no = installment_no + 100000
   where legacy_account_id = p_acct or loan_id = p_loan;
  for r in select id, paid_amount, paid_date, installments_covered as im, created_at from public.payments
            where legacy_account_id = p_acct or loan_id = p_loan order by installment_no, id loop
    v_n := v_n + 1;
    if rs.id is not null and r.created_at > rs.created_at then
      v_due := (rs.next_due + make_interval(months => greatest(0, floor(v_after / rs.new_emi))::int * v_iv))::date;
      v_after := v_after + r.paid_amount;
    elsif v_last_due is not null then v_due := (v_last_due + make_interval(months => v_last_im * v_iv))::date;
    elsif v_start is not null then v_due := (v_start + make_interval(months => (v_used + 1) * v_iv))::date;
    else v_due := null;
    end if;
    v_paid := v_paid + r.paid_amount;
    update public.payments
       set installment_no = v_n, due_date = v_due,
           due_amount = case when rs.id is not null and r.created_at > rs.created_at then rs.new_emi else v_emi end,
           balance_after = v_total - v_paid, delay_days = r.paid_date - v_due
     where id = r.id;
    v_used := v_used + r.im;
    if v_due is not null then v_last_due := v_due; v_last_im := r.im; end if;
  end loop;
end;
$function$
;

-- ===== app_private.refresh_log
CREATE OR REPLACE FUNCTION app_private.refresh_log()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  update public.notification_log l
     set status = case
                    when r.timed_out or r.error_msg is not null then 'failed'
                    when r.status_code between 200 and 299 and (
                         (l.channel = 'telegram' and coalesce(r.content::jsonb ->> 'ok', 'false') = 'true')
                      or (l.channel = 'whatsapp' and lower(coalesce(r.content::jsonb ->> 'status', '')) in ('success', 'ok'))) then 'sent'
                    else 'failed' end,
         detail = left(coalesce(r.error_msg, r.content), 300)
    from net._http_response r
   where r.id = l.request_id and l.status = 'queued';
$function$
;

-- ===== app_private.restore_cols
CREATE OR REPLACE FUNCTION app_private.restore_cols(p_job uuid, t text)
 RETURNS TABLE(col text, expr text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select a.attname::text,
         app_private.restore_expr(t, a.attname, format_type(a.atttypid, a.atttypmod), ty.typcategory = 'A')
    from pg_attribute a
    join pg_type ty on ty.oid = a.atttypid
   where a.attrelid = ('public.' || quote_ident(t))::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
     and exists (select 1 from app_private.backup_rows b where b.job = p_job and b.tbl = t and b.n = 1 and b.row ? a.attname)
   order by a.attnum;
$function$
;

-- ===== app_private.restore_expr
CREATE OR REPLACE FUNCTION app_private.restore_expr(t text, c text, typ text, is_array boolean)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when typ = 'uuid' and c in ('created_by', 'cancelled_by', 'received_by', 'reviewed_by', 'user_id', 'by_user', 'updated_by')
      then format('app_private.known_user(r.row ->> %L, %L::uuid)', c, '00000000-0000-0000-0000-000000000000')  -- admin id filled in at run time
    when is_array then format('app_private.array_text(r.row ->> %L)::%s', c, typ)
    else format('nullif(r.row ->> %L, %L)::%s', c, '', typ)
  end;
$function$
;

-- ===== app_private.run_hourly
CREATE OR REPLACE FUNCTION app_private.run_hourly()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.app_settings; v_now timestamp := now() at time zone 'Asia/Kolkata'; v_day date := v_now::date; v_hour int := extract(hour from v_now);
begin
  perform app_private.refresh_log();
  select * into s from public.app_settings where id = 1;
  if s.telegram_enabled and s.tg_daily_summary and v_hour = s.tg_summary_hour then
    perform app_private.daily_summary(v_day, 'tg-summary-' || v_day);
  end if;
  if s.whatsapp_enabled and s.wa_due_reminder and v_hour = s.wa_reminder_hour then
    perform app_private.due_reminders(v_day);
  end if;
end;
$function$
;

-- ===== app_private.sees_all_remarks
CREATE OR REPLACE FUNCTION app_private.sees_all_remarks()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.is_admin() or public.has_perm('assign') or public.has_perm('approve');
$function$
;

-- ===== app_private.series_code
CREATE OR REPLACE FUNCTION app_private.series_code(p_series bigint)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when zone_id is null and book_no = 1 then null else code end from public.receipt_series where id = p_series;
$function$
;

-- ===== app_private.series_last
CREATE OR REPLACE FUNCTION app_private.series_last(p_series bigint)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select max(n) from (
    select max(receipt_no) n from public.payments where series_id = p_series and receipt_no >= (select start_no from public.receipt_series where id = p_series)
    union all
    select max(receipt_no) from public.pending_payments where series_id = p_series and receipt_no >= (select start_no from public.receipt_series where id = p_series)
    union all
    select max(receipt_no) from public.legacy_payments where series_id = p_series and receipt_no >= (select start_no from public.receipt_series where id = p_series)) x;
$function$
;

-- ===== app_private.session_ok
CREATE OR REPLACE FUNCTION app_private.session_ok(f timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select f is null or coalesce((auth.jwt() ->> 'iat')::bigint, 0) >= floor(extract(epoch from f))::bigint;
$function$
;

-- ===== app_private.staff_name
CREATE OR REPLACE FUNCTION app_private.staff_name(p uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select full_name from public.staff where user_id = p), '—');
$function$
;

-- ===== app_private.staged_accounts
CREATE OR REPLACE FUNCTION app_private.staged_accounts(p_job uuid)
 RETURNS TABLE(file text, a legacy_accounts)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select r.row ->> '_file', jsonb_populate_record(null::public.legacy_accounts, r.row - '_file')
    from app_private.import_rows r where r.job = p_job and r.kind = 'acc';
$function$
;

-- ===== app_private.staged_payments
CREATE OR REPLACE FUNCTION app_private.staged_payments(p_job uuid)
 RETURNS TABLE(file text, p legacy_payments)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select r.row ->> '_file', jsonb_populate_record(null::public.legacy_payments, r.row - '_file')
    from app_private.import_rows r where r.job = p_job and r.kind = 'pay';
$function$
;

-- ===== app_private.table_signature
CREATE OR REPLACE FUNCTION app_private.table_signature(t text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select string_agg(column_name || ':' || data_type, ',' order by ordinal_position)
    from information_schema.columns where table_schema = 'public' and table_name = t;
$function$
;

-- ===== app_private.tg_quiet
CREATE OR REPLACE FUNCTION app_private.tg_quiet(p_on boolean, p_text text, p_event text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_on then perform app_private.tg_send(p_text, p_event); end if;
exception when others then
  raise warning 'notification failed: %', sqlerrm;   -- never block the fix
end;
$function$
;

-- ===== app_private.tg_send
CREATE OR REPLACE FUNCTION app_private.tg_send(p_text text, p_event text, p_dedupe text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.app_settings; v_req bigint; v_id bigint;
begin
  select * into s from public.app_settings where id = 1;
  if not s.telegram_enabled or s.telegram_bot_token is null or s.telegram_group_id is null then return null; end if;
  if p_dedupe is not null and exists (select 1 from public.notification_log where dedupe_key = p_dedupe) then return null; end if;
  v_req := net.http_post(
    url := 'https://api.telegram.org/bot' || s.telegram_bot_token || '/sendMessage',
    body := jsonb_build_object('chat_id', s.telegram_group_id, 'text', left(p_text, 4000), 'disable_web_page_preview', true),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 15000);
  insert into public.notification_log (channel, event, recipient, message, request_id, dedupe_key)
  values ('telegram', p_event, 'staff group', p_text, v_req, p_dedupe) returning id into v_id;
  return v_id;
end;
$function$
;

-- ===== app_private.tg_send_force
CREATE OR REPLACE FUNCTION app_private.tg_send_force(p_text text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.app_settings; v_req bigint; v_id bigint;
begin
  select * into s from public.app_settings where id = 1;
  v_req := net.http_post(
    url := 'https://api.telegram.org/bot' || s.telegram_bot_token || '/sendMessage',
    body := jsonb_build_object('chat_id', s.telegram_group_id, 'text', p_text),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 15000);
  insert into public.notification_log (channel, event, recipient, message, request_id)
  values ('telegram', 'test', 'staff group', p_text, v_req) returning id into v_id;
  return v_id;
end;
$function$
;

-- ===== app_private.wa_number
CREATE OR REPLACE FUNCTION app_private.wa_number(m text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when d ~ '^[6-9][0-9]{9}$' then '91' || d
    when d ~ '^0[6-9][0-9]{9}$' then '91' || substr(d, 2)
    when d ~ '^91[6-9][0-9]{9}$' then d
  end
  from (select regexp_replace(coalesce(split_part(m, ',', 1), ''), '[^0-9]', '', 'g') as d) x;
$function$
;

-- ===== app_private.wa_send
CREATE OR REPLACE FUNCTION app_private.wa_send(p_mobile text, p_text text, p_event text, p_dedupe text DEFAULT NULL::text, p_force boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.app_settings; v_num text := app_private.wa_number(p_mobile); v_req bigint; v_id bigint;
begin
  select * into s from public.app_settings where id = 1;
  if (not s.whatsapp_enabled and not p_force) or s.whatsapp_host is null or s.whatsapp_api_key is null or v_num is null then return null; end if;
  if p_dedupe is not null and exists (select 1 from public.notification_log where dedupe_key = p_dedupe) then return null; end if;
  v_req := net.http_post(
    url := 'https://' || regexp_replace(s.whatsapp_host, '^https?://|/+$', '', 'g') || '/wapp/api/send/json',
    body := jsonb_build_object('mobile', v_num, 'msg', p_text),
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-API-KEY', s.whatsapp_api_key),
    timeout_milliseconds := 15000);
  insert into public.notification_log (channel, event, recipient, message, request_id, dedupe_key)
  values ('whatsapp', p_event, v_num, p_text, v_req, p_dedupe) returning id into v_id;
  return v_id;
end;
$function$
;

-- ===== public.account_remarks
CREATE OR REPLACE FUNCTION public.account_remarks(p_source text, p_ref bigint)
 RETURNS TABLE(id bigint, installment_no integer, remark text, promise_date date, created_at timestamp with time zone, by_name text, mine boolean, paid_after boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select r.id, r.installment_no, r.remark, r.promise_date, r.created_at, app_private.staff_name(r.created_by), r.created_by = auth.uid(),
         app_private.paid_after(r.source, r.ref_id, r.created_at)
    from public.visit_remarks r
   where r.source = p_source and r.ref_id = p_ref
     and (public.has_perm('view_accounts') or public.has_perm('collect'))
   order by r.created_at desc;
$function$
;

-- ===== public.account_zone_info
CREATE OR REPLACE FUNCTION public.account_zone_info(p_source text, p_ref bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with cur as (select app_private.ref_zone(p_source, p_ref) as zone),
  known as (select z.name from public.zones z, cur where z.name = upper(btrim(cur.zone)))
  select jsonb_build_object(
    'zone', (select case when (select name from known) is not null then (select name from known) else nullif(btrim(zone), '') end from cur),
    'in_list', exists (select 1 from known),
    'zones', coalesce((select jsonb_agg(name order by name) from public.zones where active), '[]'),
    'can_change', case when exists (select 1 from known) then public.has_perm('fix_entries')
                       else public.has_perm('collect') or public.has_perm('fix_entries') end)
  where public.has_perm('view_accounts') or public.has_perm('collect');
$function$
;

-- ===== public.add_remark
CREATE OR REPLACE FUNCTION public.add_remark(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- p = { source, ref_id, installment_no, remark, promise_date }
declare v_today date := (now() at time zone 'Asia/Kolkata')::date; v_promise date := nullif(p ->> 'promise_date', '')::date; r public.visit_remarks;
begin
  if not public.has_perm('collect') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p ->> 'source' = 'old' then
    if not exists (select 1 from public.legacy_accounts where sno = (p ->> 'ref_id')::bigint) then raise exception 'account not found' using errcode = 'P0002'; end if;
  elsif p ->> 'source' = 'new' then
    if not exists (select 1 from public.loans where id = (p ->> 'ref_id')::bigint) then raise exception 'loan not found' using errcode = 'P0002'; end if;
  else
    raise exception 'bad source' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p ->> 'remark', ''))) < 2 then raise exception 'write what the customer said' using errcode = '22023'; end if;
  if length(btrim(p ->> 'remark')) > 300 then raise exception 'the remark is too long (300 letters at most)' using errcode = '22023'; end if;
  if v_promise is not null and (v_promise < v_today or v_promise > v_today + 400) then
    raise exception 'the pay-on date must be today or later' using errcode = '22023';
  end if;
  insert into public.visit_remarks (source, ref_id, installment_no, remark, promise_date)
  values (p ->> 'source', (p ->> 'ref_id')::bigint, nullif(p ->> 'installment_no', '')::int, btrim(p ->> 'remark'), v_promise)
  returning * into r;
  return jsonb_build_object('id', r.id);
end;
$function$
;

-- ===== public.adj_total
CREATE OR REPLACE FUNCTION public.adj_total(p_acct bigint, p_loan bigint)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(sum(amount), 0) from public.adjustments
   where cancelled_at is null and (legacy_account_id = p_acct or loan_id = p_loan);
$function$
;

-- ===== public.admin_adjust
CREATE OR REPLACE FUNCTION public.admin_adjust(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_kind text := p ->> 'kind';
  v_reason text := app_private.need_reason(p ->> 'reason');
  v_amount numeric := (p ->> 'amount')::numeric;
  v_acct bigint; v_loan bigint; v_status text; v_owed numeric; v_id bigint; r jsonb; v_msg text;
begin
  if not public.has_perm('money') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p ->> 'source' = 'old' then
    select id into v_acct from public.legacy_accounts where sno = (p ->> 'ref_id')::int;
    if not found then raise exception 'account not found' using errcode = 'P0002'; end if;
    perform pg_advisory_xact_lock(hashtext('payment:old:' || (p ->> 'ref_id')));
    if (select ledger from public.legacy_accounts where id = v_acct) = 'closed' then
      raise exception 'this account is already fully paid in the old software' using errcode = '22023';
    end if;
    if public.legacy_settled(v_acct) then raise exception 'this account is closed; reopen it first' using errcode = '22023'; end if;
  elsif p ->> 'source' = 'new' then
    v_loan := (p ->> 'ref_id')::bigint;
    perform pg_advisory_xact_lock(hashtext('payment:new:' || v_loan));
    select status into v_status from public.loans where id = v_loan for update;
    if not found then raise exception 'loan not found' using errcode = 'P0002'; end if;
    if v_status = 'closed' then raise exception 'this loan is closed; reopen it first' using errcode = '22023'; end if;
  else
    raise exception 'bad source' using errcode = '22023';
  end if;
  v_owed := app_private.owed(v_acct, v_loan);
  r := app_private.acct_ref(v_acct, v_loan);

  if v_kind = 'penalty' then
    if v_amount is null or v_amount <= 0 then raise exception 'enter the charge amount' using errcode = '22023'; end if;
    insert into public.adjustments (legacy_account_id, loan_id, kind, amount, reason) values (v_acct, v_loan, 'penalty', v_amount, v_reason) returning id into v_id;
    v_msg := '➕ Late fee / charge ' || app_private.inr(v_amount);
  elsif v_kind = 'discount' then
    if v_amount is null or v_amount <= 0 then raise exception 'enter the discount amount' using errcode = '22023'; end if;
    if v_amount > v_owed then raise exception 'discount is more than the balance (%)', app_private.inr(v_owed) using errcode = '22023'; end if;
    insert into public.adjustments (legacy_account_id, loan_id, kind, amount, reason) values (v_acct, v_loan, 'discount', -v_amount, v_reason) returning id into v_id;
    v_msg := '➖ Discount ' || app_private.inr(v_amount);
  elsif v_kind = 'settle' then
    -- whatever is still owed is written off; the account closes
    insert into public.adjustments (legacy_account_id, loan_id, kind, amount, reason)
    values (v_acct, v_loan, 'settle', -greatest(v_owed, 0), v_reason) returning id into v_id;
    if v_loan is not null then update public.loans set status = 'closed' where id = v_loan; end if;
    v_msg := '✅ Account closed' || case when v_owed > 0 then ' · written off ' || app_private.inr(v_owed) else '' end;
  elsif v_kind = 'reschedule' then
    if (p ->> 'new_emi')::numeric is null or (p ->> 'new_emi')::numeric <= 0 then raise exception 'enter the new EMI amount' using errcode = '22023'; end if;
    if (p ->> 'next_due')::date is null then raise exception 'enter the next due date' using errcode = '22023'; end if;
    if v_owed <= 0 then raise exception 'nothing is left to pay' using errcode = '22023'; end if;
    insert into public.adjustments (legacy_account_id, loan_id, kind, amount, reason, new_emi, next_due)
    values (v_acct, v_loan, 'reschedule', 0, v_reason, (p ->> 'new_emi')::numeric, (p ->> 'next_due')::date) returning id into v_id;
    v_msg := '📅 Rescheduled: EMI ' || app_private.inr((p ->> 'new_emi')::numeric) || ' from ' || to_char((p ->> 'next_due')::date, 'DD/MM/YYYY')
             || ' · ' || ceil(v_owed / (p ->> 'new_emi')::numeric) || ' EMIs';
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;

  perform app_private.reflow_payments(v_acct, v_loan);
  perform app_private.log('adjust_' || v_kind, r ->> 'subject', r - 'subject',
    jsonb_build_object('reason', v_reason, 'amount', (select amount from public.adjustments where id = v_id),
                       'new_emi', p ->> 'new_emi', 'next_due', p ->> 'next_due', 'owed_before', v_owed, 'owed_after', app_private.owed(v_acct, v_loan)));
  perform app_private.tg_quiet((select tg_on_payment from public.app_settings where id = 1),
    v_msg || chr(10) || coalesce(r ->> 'subject', '?') || chr(10) ||
    'Balance now ' || app_private.inr(app_private.owed(v_acct, v_loan)) || chr(10) ||
    'Reason: ' || v_reason || chr(10) || 'By ' || app_private.staff_name((select auth.uid())),
    'adjust_' || v_kind);
  return jsonb_build_object('id', v_id, 'owed', app_private.owed(v_acct, v_loan));
end;
$function$
;

-- ===== public.admin_archive_user
CREATE OR REPLACE FUNCTION public.admin_archive_user(p_user uuid, p_archive boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

-- ===== public.admin_backup_begin
CREATE OR REPLACE FUNCTION public.admin_backup_begin(p_file text, p_taken text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v uuid;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  delete from app_private.backup_jobs where created_at < now() - interval '3 hours' or created_by = (select auth.uid());
  insert into app_private.backup_jobs (created_by, file_name, taken) values ((select auth.uid()), left(p_file, 200), left(p_taken, 300))
  returning id into v;
  return v;
end;
$function$
;

-- ===== public.admin_backup_commit
CREATE OR REPLACE FUNCTION public.admin_backup_commit(p_job uuid, p_confirm text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '180s'
AS $function$
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
$function$
;

-- ===== public.admin_backup_preview
CREATE OR REPLACE FUNCTION public.admin_backup_preview(p_job uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '60s'
AS $function$
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
$function$
;

-- ===== public.admin_backup_stage
CREATE OR REPLACE FUNCTION public.admin_backup_stage(p_job uuid, p_tbl text, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j app_private.backup_jobs := app_private.my_backup_job(p_job); v_from int;
begin
  if not (p_tbl = any (app_private.data_tables())) then raise exception 'unknown table %', p_tbl using errcode = '22023'; end if;
  select coalesce(max(n), 0) into v_from from app_private.backup_rows where job = p_job and tbl = p_tbl;
  insert into app_private.backup_rows (job, tbl, n, row)
  select p_job, p_tbl, v_from + o::int, e from jsonb_array_elements(p_rows) with ordinality as t(e, o);
  return v_from + jsonb_array_length(p_rows);
end;
$function$
;

-- ===== public.admin_cancel_adjustment
CREATE OR REPLACE FUNCTION public.admin_cancel_adjustment(p_id bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_reason text := app_private.need_reason(p_reason); x public.adjustments; r jsonb; v_last text;
begin
  if not public.has_perm('money') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into x from public.adjustments where id = p_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if x.legacy_account_id is not null then
    perform pg_advisory_xact_lock(hashtext('payment:old:' || (select sno from public.legacy_accounts where id = x.legacy_account_id)));
  else
    perform pg_advisory_xact_lock(hashtext('payment:new:' || x.loan_id));
  end if;
  select * into x from public.adjustments where id = p_id for update;
  if x.cancelled_at is not null then raise exception 'already cancelled' using errcode = '22023'; end if;
  if x.kind <> 'settle' and exists (select 1 from public.adjustments where kind = 'settle' and cancelled_at is null
                                      and (legacy_account_id = x.legacy_account_id or loan_id = x.loan_id)) then
    raise exception 'the account is closed; reopen it first' using errcode = '22023';
  end if;

  update public.adjustments set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason where id = p_id;
  if x.kind = 'settle' and x.loan_id is not null then
    select action into v_last from public.seizures where loan_id = x.loan_id order by created_at desc, id desc limit 1;
    update public.loans set status = case when v_last = 'seize' then 'seized' else 'active' end where id = x.loan_id;
  end if;
  perform app_private.reflow_payments(x.legacy_account_id, x.loan_id);

  r := app_private.acct_ref(x.legacy_account_id, x.loan_id);
  perform app_private.log(case when x.kind = 'settle' then 'reopened' else 'adjust_cancelled' end, r ->> 'subject', r - 'subject',
    jsonb_build_object('reason', v_reason, 'kind', x.kind, 'amount', x.amount, 'original_reason', x.reason,
                       'owed_after', app_private.owed(x.legacy_account_id, x.loan_id)));
  perform app_private.tg_quiet((select tg_on_payment from public.app_settings where id = 1),
    case when x.kind = 'settle' then '↩️ Account reopened' else '↩️ Cancelled ' || x.kind end || chr(10) ||
    coalesce(r ->> 'subject', '?') || chr(10) ||
    'Balance now ' || app_private.inr(app_private.owed(x.legacy_account_id, x.loan_id)) || chr(10) ||
    'Reason: ' || v_reason || chr(10) || 'By ' || app_private.staff_name((select auth.uid())),
    'adjust_cancelled');
  return jsonb_build_object('cancelled', p_id);
end;
$function$
;

-- ===== public.admin_cancel_payment
CREATE OR REPLACE FUNCTION public.admin_cancel_payment(p_id bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_reason text := app_private.need_reason(p_reason);
begin
  if not public.has_perm('fix_entries') then raise exception 'not allowed' using errcode = '42501'; end if;
  perform app_private.cancel_payment_core(p_id, v_reason, 'payment_cancelled');
  return jsonb_build_object('cancelled', p_id);
end;
$function$
;

-- ===== public.admin_create_restore_point
CREATE OR REPLACE FUNCTION public.admin_create_restore_point(p_reason text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '120s'
AS $function$
declare v_id bigint;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  v_id := app_private.make_restore_point(coalesce(nullif(btrim(p_reason), ''), 'Manual'));
  perform app_private.audit('restore_point', jsonb_build_object('restore_point', v_id));
  return v_id;
end;
$function$
;

-- ===== public.admin_create_user
CREATE OR REPLACE FUNCTION public.admin_create_user(p_email text, p_name text, p_password text, p_role text, p_perms text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

-- ===== public.admin_data_overview
CREATE OR REPLACE FUNCTION public.admin_data_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

-- ===== public.admin_delete_data
CREATE OR REPLACE FUNCTION public.admin_delete_data(p_scope text, p_confirm text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '120s'
AS $function$
declare v_rp bigint; before jsonb; after jsonb;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if p_scope not in ('old', 'new', 'all') then raise exception 'bad scope' using errcode = '22023'; end if;
  if p_confirm is distinct from 'DELETE' then raise exception 'type DELETE to confirm' using errcode = '22023'; end if;

  v_rp := app_private.make_restore_point('Before delete (' || p_scope || ')');
  before := app_private.data_counts();

  if p_scope in ('new', 'all') then
    delete from public.adjustments where loan_id is not null;
    delete from public.seizures where loan_id is not null;
    delete from public.payments where loan_id is not null;
    delete from public.loans where true;
    delete from public.borrowers where true;
  end if;
  if p_scope in ('old', 'all') then
    delete from public.adjustments where legacy_account_id is not null;
    delete from public.seizures where legacy_account_id is not null;
    delete from public.payments where legacy_account_id is not null;
    delete from public.legacy_payments where true;
    delete from public.legacy_accounts where true;
    delete from public.import_batches where true;
  end if;

  after := app_private.data_counts();
  perform app_private.audit('delete', jsonb_build_object('scope', p_scope, 'restore_point', v_rp, 'before', before, 'after', after));
  return jsonb_build_object('restore_point', v_rp, 'before', before, 'after', after);
end;
$function$
;

-- ===== public.admin_delete_loan
CREATE OR REPLACE FUNCTION public.admin_delete_loan(p_loan bigint, p_reason text, p_confirm text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_reason text := app_private.need_reason(p_reason); l public.loans; b public.borrowers; r jsonb; s jsonb; j jsonb;
begin
  if not public.has_perm('fix_entries') then raise exception 'not allowed' using errcode = '42501'; end if;
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
  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into j from public.adjustments x where x.loan_id = p_loan;

  delete from public.adjustments where loan_id = p_loan;
  delete from public.seizures where loan_id = p_loan;
  delete from public.loans where id = p_loan;
  if not exists (select 1 from public.loans where borrower_id = b.id) then delete from public.borrowers where id = b.id; end if;

  perform app_private.log('loan_deleted', r ->> 'subject', null,
    jsonb_build_object('reason', v_reason, 'loan', to_jsonb(l), 'borrower', to_jsonb(b), 'seizures', s, 'adjustments', j));
  perform app_private.tg_quiet((select tg_on_new_loan from public.app_settings where id = 1),
    '🗑 Loan deleted' || chr(10) || coalesce(r ->> 'subject', '?') || chr(10) ||
    'Total ' || app_private.inr(l.total_amount) || chr(10) ||
    'Reason: ' || v_reason || chr(10) || 'By ' || app_private.staff_name((select auth.uid())),
    'loan_deleted');
  return jsonb_build_object('deleted', p_loan);
end;
$function$
;

-- ===== public.admin_edit_loan
CREATE OR REPLACE FUNCTION public.admin_edit_loan(p_loan bigint, p jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reason text := app_private.need_reason(p_reason);
  ol public.loans; nl public.loans; ob public.borrowers; nb public.borrowers; v_amt record; d jsonb; r jsonb;
begin
  if not public.has_perm('fix_entries') then raise exception 'not allowed' using errcode = '42501'; end if;
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
$function$
;

-- ===== public.admin_edit_payment
CREATE OR REPLACE FUNCTION public.admin_edit_payment(p_id bigint, p jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reason text := app_private.need_reason(p_reason);
  o public.payments; n public.payments; r jsonb; d jsonb; v_parts jsonb;
  v_amount numeric := (p ->> 'paid_amount')::numeric;
  v_date date := (p ->> 'paid_date')::date;
  v_mode text := p ->> 'payment_mode';
  v_rno bigint := (p ->> 'receipt_no')::bigint;
  v_im int := coalesce((p ->> 'installments_covered')::int, 1);
begin
  if not public.has_perm('fix_entries') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into o from public.payments where id = p_id;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  perform app_private.payment_lock(o);
  select * into o from public.payments where id = p_id for update;

  if v_amount is null or v_amount <= 0 then raise exception 'amount must be more than 0' using errcode = '22023'; end if;
  if v_date is null or v_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'paid date cannot be in the future' using errcode = '22023'; end if;
  if v_mode = 'SPLIT' then
    v_parts := app_private.check_parts(p -> 'parts');
    if (select sum((x ->> 'amount')::numeric) from jsonb_array_elements(v_parts) x) <> round(v_amount, 2) then
      raise exception 'the parts must add up to the amount' using errcode = '22023';
    end if;
  end if;
  if v_mode is null or v_mode not in ('CASH', 'CHEQUE', 'SBI', 'BANK', 'SPLIT') then raise exception 'choose the payment mode' using errcode = '22023'; end if;
  if v_mode = 'BANK' and nullif(btrim(p ->> 'bank_name'), '') is null then raise exception 'enter the bank name' using errcode = '22023'; end if;
  if v_rno is null or v_rno <= 0 then raise exception 'enter the receipt number' using errcode = '22023'; end if;
  if v_im < 1 or v_im > 360 then raise exception 'EMIs covered must be 1 or more' using errcode = '22023'; end if;
  if v_rno <> o.receipt_no and exists (select 1 from public.pending_payments where series_id = o.series_id and receipt_no = v_rno) then
    raise exception 'receipt no. % is already used by a payment waiting for approval', v_rno using errcode = '22023';
  end if;
  if v_rno <> o.receipt_no and exists (select 1 from public.legacy_payments where series_id = o.series_id and receipt_no = v_rno) then
    raise exception 'receipt no. % was already used in the old software', v_rno using errcode = '22023';
  end if;

  update public.payments
     set paid_amount = v_amount, paid_date = v_date, payment_mode = v_mode,
         reference_no = case when v_mode = 'SPLIT' then null else nullif(btrim(p ->> 'reference_no'), '') end,
         bank_name = case when v_mode = 'BANK' then nullif(btrim(p ->> 'bank_name'), '') end,
         receipt_no = v_rno, installments_covered = v_im, parts = v_parts
   where id = p_id;
  perform app_private.reflow_payments(o.legacy_account_id, o.loan_id);
  select * into n from public.payments where id = p_id;

  d := app_private.diff(to_jsonb(o), to_jsonb(n),
         array['paid_amount', 'paid_date', 'payment_mode', 'reference_no', 'bank_name', 'receipt_no', 'installments_covered', 'parts']);
  if d = '{}' then raise exception 'nothing was changed' using errcode = '22023'; end if;
  r := app_private.acct_ref(o.legacy_account_id, o.loan_id);
  perform app_private.log('payment_edited', r ->> 'subject', r - 'subject',
    jsonb_build_object('reason', v_reason, 'receipt_no', o.receipt_no, 'changes', d));
  perform app_private.tg_quiet((select tg_on_payment from public.app_settings where id = 1),
    '✏️ Payment edited' || chr(10) || coalesce(r ->> 'subject', '?') || chr(10) ||
    'Rcpt ' || o.receipt_no || ': ' || app_private.inr(o.paid_amount) || ' on ' || to_char(o.paid_date, 'DD/MM/YYYY') ||
    ' → Rcpt ' || n.receipt_no || ': ' || app_private.inr(n.paid_amount) || ' on ' || to_char(n.paid_date, 'DD/MM/YYYY') || chr(10) ||
    'Reason: ' || v_reason || chr(10) || 'By ' || app_private.staff_name((select auth.uid())),
    'payment_edited');
  return jsonb_build_object('id', n.id, 'receipt_no', n.receipt_no, 'balance_after', n.balance_after);
end;
$function$
;

-- ===== public.admin_import_begin
CREATE OR REPLACE FUNCTION public.admin_import_begin(p_batches jsonb, p_checks jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  delete from app_private.import_jobs where created_at < now() - interval '1 day' or (status = 'staged' and created_at < now() - interval '2 hours');
  insert into app_private.import_jobs (created_by, batches, checks) values ((select auth.uid()), p_batches, p_checks) returning id into v_id;
  return v_id;
end;
$function$
;

-- ===== public.admin_import_commit
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
      finance_mode = excluded.finance_mode, zone = case when public.legacy_accounts.zone_set_in_app then public.legacy_accounts.zone else excluded.zone end, vehicle_condition = excluded.vehicle_condition,
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
$function$
;

-- ===== public.admin_import_preview
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
    'double_entry_risk', (select coalesce(jsonb_agg(jsonb_build_object('sno', sno, 'name', borrower_name, 'app_first', app_first, 'file_receipts_after', file_receipts_after) order by sno), '[]') from risk),
    'double_entry_likely', (select coalesce(jsonb_agg(to_jsonb(l) order by l.sno, l.app_date), '[]') from likely l)
  ) into v;
  update app_private.import_jobs set preview = v where id = p_job;
  return v;
end;
$function$
;

-- ===== public.admin_import_stage
CREATE OR REPLACE FUNCTION public.admin_import_stage(p_job uuid, p_kind text, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j app_private.import_jobs := app_private.my_job(p_job); v_from int;
begin
  if j.status <> 'staged' then raise exception 'this upload was already imported' using errcode = '22023'; end if;
  select coalesce(max(n), 0) into v_from from app_private.import_rows where job = p_job and kind = p_kind;
  insert into app_private.import_rows (job, kind, n, row)
  select p_job, p_kind, v_from + o::int, e from jsonb_array_elements(p_rows) with ordinality as t(e, o);
  return v_from + jsonb_array_length(p_rows);
end;
$function$
;

-- ===== public.admin_list_users
CREATE OR REPLACE FUNCTION public.admin_list_users()
 RETURNS TABLE(user_id uuid, email text, full_name text, role text, active boolean, permissions text[], last_sign_in_at timestamp with time zone, created_at timestamp with time zone, archived_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  return query
    select s.user_id, u.email::text, s.full_name, s.role, s.active, s.permissions, u.last_sign_in_at, s.created_at, s.archived_at
      from public.staff s join auth.users u on u.id = s.user_id
     order by s.archived_at is not null, s.active desc, (s.role = 'admin') desc, s.full_name;
end;
$function$
;

-- ===== public.admin_main_book
CREATE OR REPLACE FUNCTION public.admin_main_book(p_start bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.receipt_series; v_book int; v_code text;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if p_start is null or p_start <= 0 then raise exception 'enter the first receipt number of the book' using errcode = '22023'; end if;
  select * into cur from public.receipt_series where zone_id is null and closed_at is null for update;
  select coalesce(max(book_no), 0) + 1 into v_book from public.receipt_series where zone_id is null;
  v_code := 'DHAMTARI-' || v_book;
  if exists (select 1 from public.receipt_series where code = v_code) then raise exception 'a book named % already exists', v_code using errcode = '22023'; end if;
  update public.receipt_series set closed_at = now() where id = cur.id;
  update public.receipt_books set closed_at = now() where series_id = cur.id and closed_at is null;
  insert into public.receipt_series (zone_id, book_no, code, start_no) values (null, v_book, v_code, p_start);
  perform app_private.log('zone_book', 'DHAMTARI', null,
    jsonb_build_object('book', v_code, 'start_no', p_start, 'closed', case when cur.book_no = 1 then 'MAIN' else cur.code end));
  return jsonb_build_object('book', v_code);
end;
$function$
;

-- ===== public.admin_receipt_book
CREATE OR REPLACE FUNCTION public.admin_receipt_book(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- p = { action: add | close | reopen | delete, id, user_id, from_no, to_no, note, series_id }
declare b public.receipt_books; v_id bigint; v_name text; v_series bigint;
begin
  if not public.has_perm('cash') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p ->> 'action' = 'add' then
    if not exists (select 1 from public.staff where user_id = (p ->> 'user_id')::uuid) then raise exception 'choose the person' using errcode = '22023'; end if;
    if (p ->> 'from_no')::bigint is null or (p ->> 'to_no')::bigint is null or (p ->> 'to_no')::bigint < (p ->> 'from_no')::bigint then
      raise exception 'enter the first and last receipt number' using errcode = '22023';
    end if;
    if (p ->> 'to_no')::bigint - (p ->> 'from_no')::bigint >= 10000 then raise exception 'a book can have at most 10,000 receipts' using errcode = '22023'; end if;
    v_series := coalesce((p ->> 'series_id')::bigint, app_private.open_series(null));
    if not exists (select 1 from public.receipt_series where id = v_series and closed_at is null) then
      raise exception 'choose an open zone book' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtext('receipt_books:' || v_series));
    if exists (select 1 from public.receipt_books where series_id = v_series
                  and int8range(from_no, to_no, '[]') && int8range((p ->> 'from_no')::bigint, (p ->> 'to_no')::bigint, '[]')) then
      raise exception 'these numbers overlap another receipt book' using errcode = '22023';
    end if;
    insert into public.receipt_books (user_id, from_no, to_no, note, series_id)
    values ((p ->> 'user_id')::uuid, (p ->> 'from_no')::bigint, (p ->> 'to_no')::bigint, nullif(btrim(p ->> 'note'), ''), v_series)
    returning * into b;
    v_id := b.id;
  else
    select * into b from public.receipt_books where id = (p ->> 'id')::bigint for update;
    if not found then raise exception 'receipt book not found' using errcode = 'P0002'; end if;
    v_id := b.id;
    if p ->> 'action' = 'close' then update public.receipt_books set closed_at = now() where id = b.id;
    elsif p ->> 'action' = 'reopen' then update public.receipt_books set closed_at = null where id = b.id;
    elsif p ->> 'action' = 'delete' then
      if exists (select 1 from public.payments where series_id = b.series_id and receipt_no between b.from_no and b.to_no) then
        raise exception 'receipts from this book are already used; close it instead' using errcode = '22023';
      end if;
      delete from public.receipt_books where id = b.id;
    else raise exception 'bad action' using errcode = '22023';
    end if;
  end if;
  select full_name into v_name from public.staff where user_id = b.user_id;
  perform app_private.log('book_' || (p ->> 'action'), v_name, null,
    jsonb_build_object('from_no', b.from_no, 'to_no', b.to_no, 'note', b.note, 'book', (select code from public.receipt_series where id = b.series_id)));
  return jsonb_build_object('id', v_id);
end;
$function$
;

-- ===== public.admin_restore
CREATE OR REPLACE FUNCTION public.admin_restore(p_point bigint, p_confirm text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '120s'
AS $function$
declare rp app_private.restore_points; v_new bigint; t text; tables text[] := app_private.data_tables(); seq text; cols text; missing text;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if p_confirm is distinct from 'RESTORE' then raise exception 'type RESTORE to confirm' using errcode = '22023'; end if;
  select * into rp from app_private.restore_points where id = p_point;
  if not found then raise exception 'restore point not found' using errcode = '22023'; end if;
  foreach t in array tables loop
    if to_regclass('app_private.' || quote_ident('rp' || p_point || '_' || t)) is null then continue; end if;
    select string_agg(c.column_name, ', ') into missing
      from information_schema.columns c
     where c.table_schema = 'app_private' and c.table_name = 'rp' || p_point || '_' || t
       and not exists (select 1 from information_schema.columns x
                        where x.table_schema = 'public' and x.table_name = t and x.column_name = c.column_name);
    if missing is not null then
      raise exception 'table % no longer has column(s) %; this restore point cannot be restored automatically', t, missing using errcode = '22023';
    end if;
  end loop;

  v_new := app_private.make_restore_point('Before restoring #' || p_point);
  perform set_config('app.restoring', 'on', true);

  execute 'truncate ' || (select string_agg(format('public.%I', x), ', ') from unnest(tables) x);
  foreach t in array tables loop
    if to_regclass('app_private.' || quote_ident('rp' || p_point || '_' || t)) is null then continue; end if;
    -- columns in both (generated ones such as search_text are recalculated)
    select string_agg(quote_ident(x.column_name), ', ' order by x.ordinal_position) into cols
      from information_schema.columns x
     where x.table_schema = 'public' and x.table_name = t and x.is_generated = 'NEVER'
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'app_private' and c.table_name = 'rp' || p_point || '_' || t and c.column_name = x.column_name);
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
$function$
;

-- ===== public.admin_set_password
CREATE OR REPLACE FUNCTION public.admin_set_password(p_user uuid, p_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'password must be at least 8 characters' using errcode = '22023'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = p_user;
  if not found then raise exception 'user not found' using errcode = '22023'; end if;
  if p_user <> (select auth.uid()) then
    update public.staff set force_logout_at = now() where user_id = p_user;
    delete from auth.refresh_tokens where user_id = p_user::text;
    delete from auth.sessions where user_id = p_user;
  end if;
  perform app_private.log('password_reset', (select full_name from public.staff where user_id = p_user), null, '{}');
end;
$function$
;

-- ===== public.admin_sign_out_user
CREATE OR REPLACE FUNCTION public.admin_sign_out_user(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if p_user = (select auth.uid()) then raise exception 'use Sign out to sign yourself out' using errcode = '22023'; end if;
  update public.staff set force_logout_at = now() where user_id = p_user;
  if not found then raise exception 'user not found' using errcode = '22023'; end if;
  delete from auth.refresh_tokens where user_id = p_user::text;
  delete from auth.sessions where user_id = p_user;
  perform app_private.log('signed_out', (select full_name from public.staff where user_id = p_user), null, '{}');
end;
$function$
;

-- ===== public.admin_update_user
CREATE OR REPLACE FUNCTION public.admin_update_user(p_user uuid, p_name text, p_role text, p_active boolean, p_perms text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if nullif(btrim(p_name), '') is null then raise exception 'enter the person''s name' using errcode = '22023'; end if;
  if p_role not in ('admin', 'staff') then raise exception 'bad role' using errcode = '22023'; end if;
  if p_user = (select auth.uid()) and (p_role <> 'admin' or not p_active) then
    raise exception 'you cannot remove your own admin access or switch yourself off' using errcode = '22023';
  end if;
  if p_active and exists (select 1 from public.staff where user_id = p_user and archived_at is not null) then
    raise exception 'this user is removed; restore them first' using errcode = '22023';
  end if;
  update public.staff
     set full_name = btrim(p_name), role = p_role, active = p_active,
         permissions = case when p_role = 'admin' then '{}' else app_private.clean_perms(p_perms) end
   where user_id = p_user;
  if not found then raise exception 'user not found' using errcode = '22023'; end if;
  if not p_active then delete from auth.sessions where user_id = p_user; end if;   -- sign them out everywhere
end;
$function$
;

-- ===== public.admin_zone
CREATE OR REPLACE FUNCTION public.admin_zone(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- p = { action: add | rename | new_book | hide | show | delete, id, name, receipt_start }
declare z public.zones; v_start bigint; v_name text := upper(btrim(p ->> 'name')); cur public.receipt_series; v_book int;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if p ->> 'action' in ('add', 'rename') and nullif(v_name, '') is null then raise exception 'enter the zone name' using errcode = '22023'; end if;
  if p ->> 'action' in ('add', 'new_book') then
    v_start := (p ->> 'receipt_start')::bigint;
    if v_start is null or v_start <= 0 then raise exception 'enter the first receipt number of the book' using errcode = '22023'; end if;
  end if;

  if p ->> 'action' = 'add' then
    if exists (select 1 from public.zones where name = v_name) then raise exception 'a zone with this name already exists' using errcode = '22023'; end if;
    if exists (select 1 from public.receipt_series where code = v_name || '-1') then raise exception 'a book named %-1 already exists', v_name using errcode = '22023'; end if;
    insert into public.zones (name, receipt_start) values (v_name, v_start) returning * into z;
    insert into public.receipt_series (zone_id, book_no, code, start_no) values (z.id, 1, v_name || '-1', v_start);
    perform app_private.log('zone_add', z.name, null, jsonb_build_object('book', v_name || '-1', 'start_no', v_start));
    return jsonb_build_object('id', z.id);
  end if;

  select * into z from public.zones where id = (p ->> 'id')::bigint for update;
  if not found then raise exception 'zone not found' using errcode = 'P0002'; end if;

  if p ->> 'action' = 'new_book' then
    select * into cur from public.receipt_series where zone_id = z.id and closed_at is null for update;
    select coalesce(max(book_no), 0) + 1 into v_book from public.receipt_series where zone_id = z.id;
    update public.receipt_series set closed_at = now() where id = cur.id;
    -- people's receipt books in the closed book close with it
    update public.receipt_books set closed_at = now() where series_id = cur.id and closed_at is null;
    insert into public.receipt_series (zone_id, book_no, code, start_no) values (z.id, v_book, z.name || '-' || v_book, v_start);
    update public.zones set receipt_start = v_start where id = z.id;
    perform app_private.log('zone_book', z.name, null, jsonb_build_object('book', z.name || '-' || v_book, 'start_no', v_start, 'closed', cur.code));
  elsif p ->> 'action' = 'rename' then
    if v_name <> z.name and exists (select 1 from public.zones where name = v_name) then raise exception 'a zone with this name already exists' using errcode = '22023'; end if;
    update public.zones set name = v_name where id = z.id;
    update public.loans set zone = v_name where upper(btrim(zone)) = z.name;
    update public.legacy_accounts set zone = v_name where upper(btrim(zone)) = z.name;
    perform app_private.log('zone_edit', v_name, null, jsonb_build_object('changes', jsonb_build_object('name', jsonb_build_object('from', z.name, 'to', v_name))));
  elsif p ->> 'action' in ('hide', 'show') then
    update public.zones set active = (p ->> 'action' = 'show') where id = z.id;
    perform app_private.log('zone_' || (p ->> 'action'), z.name, null, '{}'::jsonb);
  elsif p ->> 'action' = 'delete' then
    if exists (select 1 from public.loans where upper(btrim(zone)) = z.name)
       or exists (select 1 from public.legacy_accounts where upper(btrim(zone)) = z.name) then
      raise exception 'accounts are in this zone; hide it instead' using errcode = '22023';
    end if;
    if exists (select 1 from public.receipt_series s where s.zone_id = z.id and (
                 exists (select 1 from public.payments where series_id = s.id) or exists (select 1 from public.pending_payments where series_id = s.id)
                 or exists (select 1 from public.legacy_payments where series_id = s.id) or exists (select 1 from public.receipt_books where series_id = s.id))) then
      raise exception 'receipts were written in this zone''s books; hide it instead' using errcode = '22023';
    end if;
    delete from public.receipt_series where zone_id = z.id;
    delete from public.zones where id = z.id;
    perform app_private.log('zone_delete', z.name, null, '{}'::jsonb);
  else
    raise exception 'bad action' using errcode = '22023';
  end if;
  return jsonb_build_object('id', z.id);
end;
$function$
;

-- ===== public.assign_candidates
CREATE OR REPLACE FUNCTION public.assign_candidates(p_day date, p_q text, p_filter text)
 RETURNS TABLE(source text, ref_id bigint, folio text, borrower_name text, mobile text, address text, emi numeric, balance numeric, arrears numeric, overdue_emis integer, next_due date, seized boolean, assigned_to text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
declare v_q text := lower(btrim(coalesce(p_q, '')));
begin
  if not public.has_perm('assign') then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select d.source, d.ref_id, d.folio, d.borrower_name, d.mobile, coalesce(la.borrower_address, b.address),
         d.emi, d.balance, d.arrears, d.overdue_emis, d.next_due, d.seized, app_private.staff_name(c.user_id)
    from public.due_report(p_day) d
    left join public.legacy_accounts la on d.source = 'old' and la.sno = d.ref_id
    left join public.loans l on d.source = 'new' and l.id = d.ref_id
    left join public.borrowers b on b.id = l.borrower_id
    left join public.collection_assignments c on c.day = p_day and c.source = d.source and c.ref_id = d.ref_id
   where d.balance > 0
     and (v_q = '' or d.search_text like '%' || v_q || '%' or lower(coalesce(la.borrower_address, b.address, '')) like '%' || v_q || '%')
     and case p_filter
           when 'due_day' then d.next_due = p_day
           when 'overdue' then d.arrears > 0
           when 'overdue3' then d.overdue_emis >= 3
           when 'week' then d.next_due between p_day and p_day + 6
           when 'unassigned' then c.id is null
           else true end
     and (p_filter = 'all' or not d.seized)
   order by d.arrears desc, d.next_due nulls last
   limit 300;
end;
$function$
;

-- ===== public.assign_collections
CREATE OR REPLACE FUNCTION public.assign_collections(p_day date, p_user uuid, p_items jsonb, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_n int; v_moved int; v_name text;
begin
  if not public.has_perm('assign') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_day is null or p_day < (now() at time zone 'Asia/Kolkata')::date - 1 then raise exception 'choose today or a later day' using errcode = '22023'; end if;
  if not exists (select 1 from public.staff where user_id = p_user and active and (role = 'admin' or 'collect' = any (permissions))) then
    raise exception 'this person cannot collect payments (give them "Collect payments" first)' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'choose at least one account' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'at most 500 accounts at once' using errcode = '22023'; end if;

  select count(*) into v_moved
    from public.collection_assignments c
    join jsonb_to_recordset(p_items) as i(source text, ref_id bigint) on i.source = c.source and i.ref_id = c.ref_id
   where c.day = p_day and c.user_id <> p_user;

  insert into public.collection_assignments (day, user_id, source, ref_id, note)
  select p_day, p_user, i.source, i.ref_id, nullif(btrim(p_note), '')
    from jsonb_to_recordset(p_items) as i(source text, ref_id bigint)
   where i.source in ('old', 'new') and i.ref_id is not null
  on conflict (day, source, ref_id) do update
     set user_id = excluded.user_id, note = coalesce(excluded.note, public.collection_assignments.note),
         created_by = auth.uid(), created_at = now();
  get diagnostics v_n = row_count;

  v_name := app_private.staff_name(p_user);
  perform app_private.log('assigned', v_name, null, jsonb_build_object('day', p_day, 'accounts', v_n, 'moved_from_others', v_moved));
  return jsonb_build_object('assigned', v_n, 'moved', v_moved);
end;
$function$
;

-- ===== public.cash_day
CREATE OR REPLACE FUNCTION public.cash_day(p_day date)
 RETURNS TABLE(user_id uuid, full_name text, receipts integer, cash numeric, cheque numeric, sbi numeric, bank numeric, total numeric, closed boolean, received_amount numeric, expected_at_close numeric, note text, received_by text, received_at timestamp with time zone, pending_count integer, pending_amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with allp as (
    select created_by, paid_amount, payment_mode, parts, false as waiting from public.payments
     where (created_at at time zone 'Asia/Kolkata')::date = p_day
    union all
    select created_by, paid_amount, payment_mode, parts, true from public.pending_payments
     where (created_at at time zone 'Asia/Kolkata')::date = p_day
  ),
  pay as (
    select created_by as uid, count(*)::int as n,
           sum(public.mode_part(payment_mode, paid_amount, parts, 'CASH'))   as cash,
           sum(public.mode_part(payment_mode, paid_amount, parts, 'CHEQUE')) as cheque,
           sum(public.mode_part(payment_mode, paid_amount, parts, 'SBI'))    as sbi,
           sum(public.mode_part(payment_mode, paid_amount, parts, 'BANK'))   as bank,
           sum(paid_amount) as total,
           count(*) filter (where waiting)::int as pc, coalesce(sum(paid_amount) filter (where waiting), 0) as pa
      from allp group by created_by
  ),
  people as (select uid from pay union select c.user_id from public.cash_closings c where c.day = p_day)
  select s.user_id, s.full_name, coalesce(pay.n, 0), coalesce(pay.cash, 0), coalesce(pay.cheque, 0), coalesce(pay.sbi, 0),
         coalesce(pay.bank, 0), coalesce(pay.total, 0),
         c.id is not null, c.received_amount, c.expected_cash, c.note, app_private.staff_name(c.received_by), c.received_at,
         coalesce(pay.pc, 0), coalesce(pay.pa, 0)
    from people
    join public.staff s on s.user_id = people.uid
    left join pay on pay.uid = people.uid
    left join public.cash_closings c on c.user_id = people.uid and c.day = p_day
   where public.has_perm('cash') or (public.has_perm('collect') and s.user_id = (select auth.uid()))
   order by s.full_name;
$function$
;

-- ===== public.cash_receive
CREATE OR REPLACE FUNCTION public.cash_receive(p_user uuid, p_day date, p_amount numeric, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_n int; v_cash numeric; v_other numeric; v_name text; v_short numeric;
begin
  if not public.has_perm('cash') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'enter the cash received' using errcode = '22023'; end if;
  if p_day > (now() at time zone 'Asia/Kolkata')::date then raise exception 'the day cannot be in the future' using errcode = '22023'; end if;
  select count(*), coalesce(sum(public.mode_part(mode, amt, parts, 'CASH')), 0), coalesce(sum(amt - public.mode_part(mode, amt, parts, 'CASH')), 0)
    into v_n, v_cash, v_other
    from (select paid_amount amt, payment_mode mode, parts from public.payments
           where created_by = p_user and (created_at at time zone 'Asia/Kolkata')::date = p_day
          union all
          select paid_amount, payment_mode, parts from public.pending_payments
           where created_by = p_user and (created_at at time zone 'Asia/Kolkata')::date = p_day) x;
  insert into public.cash_closings (user_id, day, receipts, expected_cash, expected_other, received_amount, note)
  values (p_user, p_day, v_n, v_cash, v_other, p_amount, nullif(btrim(p_note), ''))
  on conflict (user_id, day) do update
     set receipts = excluded.receipts, expected_cash = excluded.expected_cash, expected_other = excluded.expected_other,
         received_amount = excluded.received_amount, note = excluded.note, received_by = auth.uid(), received_at = now();
  v_name := app_private.staff_name(p_user);
  v_short := v_cash - p_amount;
  perform app_private.log('cash_received', v_name, null,
    jsonb_build_object('day', p_day, 'expected_cash', v_cash, 'received', p_amount, 'short', v_short, 'receipts', v_n, 'note', nullif(btrim(p_note), '')));
  perform app_private.tg_quiet((select tg_on_payment from public.app_settings where id = 1),
    '💵 Cash handed in · ' || v_name || ' · ' || to_char(p_day, 'DD/MM/YYYY') || chr(10) ||
    'Collected in cash ' || app_private.inr(v_cash) || ' (' || v_n || ' receipts)' || chr(10) ||
    'Received ' || app_private.inr(p_amount) ||
    case when v_short > 0 then ' · SHORT ' || app_private.inr(v_short) when v_short < 0 then ' · extra ' || app_private.inr(-v_short) else ' · matches' end || chr(10) ||
    'By ' || app_private.staff_name(auth.uid()),
    'cash_received');
  return jsonb_build_object('short', v_short);
end;
$function$
;

-- ===== public.collection_list
CREATE OR REPLACE FUNCTION public.collection_list(p_day date, p_user uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id bigint, user_id uuid, collector text, source text, ref_id bigint, folio text, borrower_name text, mobile text, address text, vehicle text, emi numeric, balance numeric, arrears numeric, overdue_emis integer, next_due date, seized boolean, closed boolean, collected numeric, receipts integer, note text, waiting numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
begin
  if not public.has_perm('collect') and not public.has_perm('assign') then raise exception 'not allowed' using errcode = '42501'; end if;
  if (p_user is null or p_user <> auth.uid()) and not public.has_perm('assign') then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  with a as (
    select c.* from public.collection_assignments c where c.day = p_day and (p_user is null or c.user_id = p_user)
  ),
  due as (select d.* from public.due_report(p_day) d where (d.source, d.ref_id) in (select a.source, a.ref_id from a)),
  paid as (
    select x.src, x.ref, sum(x.amt) as amt, count(*)::int as n, coalesce(sum(x.amt) filter (where x.waiting), 0) as wait
      from (
        select case when p.loan_id is null then 'old' else 'new' end as src,
               coalesce((select la.sno::bigint from public.legacy_accounts la where la.id = p.legacy_account_id), p.loan_id) as ref,
               p.paid_amount as amt, false as waiting
          from public.payments p where (p.created_at at time zone 'Asia/Kolkata')::date = p_day
        union all
        select pp.source, pp.ref_id, pp.paid_amount, true
          from public.pending_payments pp where (pp.created_at at time zone 'Asia/Kolkata')::date = p_day
      ) x
     group by x.src, x.ref
  )
  select a.id, a.user_id, app_private.staff_name(a.user_id), a.source, a.ref_id,
         coalesce(d.folio, la.fno::text, l.folio_no),
         coalesce(d.borrower_name, la.borrower_name, b.full_name),
         coalesce(d.mobile, nullif(concat_ws(', ', la.borrower_mobile, la.borrower_mobile2), ''), b.mobile),
         coalesce(la.borrower_address, b.address),
         coalesce(nullif(concat_ws(' · ', coalesce(la.vehicle_model, l.vehicle_model), coalesce(la.registration_no, l.vehicle_no)), ''), null),
         d.emi, d.balance, d.arrears, d.overdue_emis, d.next_due, coalesce(d.seized, false), d.source is null,
         coalesce(pd.amt, 0), coalesce(pd.n, 0), a.note, coalesce(pd.wait, 0)
    from a
    left join due d on d.source = a.source and d.ref_id = a.ref_id
    left join public.legacy_accounts la on a.source = 'old' and la.sno = a.ref_id
    left join public.loans l on a.source = 'new' and l.id = a.ref_id
    left join public.borrowers b on b.id = l.borrower_id
    left join paid pd on pd.src = a.source and pd.ref = a.ref_id
   order by app_private.staff_name(a.user_id), coalesce(d.arrears, 0) desc, a.id;
end;
$function$
;

-- ===== public.create_loan
CREATE OR REPLACE FUNCTION public.create_loan(p jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_key  uuid := (p->>'idempotency_key')::uuid;
  v_id   bigint;
  v_bid  bigint;
  v_amt  record;
begin
  if not public.has_perm('new_loan') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select id into v_id from public.loans where idempotency_key = v_key;
  if found then
    return v_id;
  end if;

  select * into v_amt from public.loan_amounts(
    (p->>'finance_amount')::numeric, (p->>'interest_rate')::numeric,
    (p->>'installments')::int, (p->>'interval_months')::int,
    coalesce((p->>'agreement_amount')::numeric, 0), coalesce((p->>'hp_amount')::numeric, 0));

  insert into public.borrowers (full_name, father_name, mobile, date_of_birth, address)
  values (p->>'borrower_name', p->>'borrower_father', p->>'borrower_mobile',
          (p->>'borrower_dob')::date, p->>'borrower_address')
  returning id into v_bid;

  insert into public.loans (
    folio_no, zone, dealer, loan_type, borrower_id,
    guarantor_name, guarantor_father, guarantor_mobile, guarantor_address,
    vehicle_condition, sold_by, vehicle_model, vehicle_color, chassis_no, engine_no,
    make_year, vehicle_no, insurance_expiry,
    agreement_date, installments, interval_months, finance_amount, interest_rate,
    agreement_amount, hp_amount, interest_amount, total_amount, emi_amount, idempotency_key)
  values (
    btrim(p->>'folio_no'), p->>'zone', p->>'dealer', p->>'loan_type', v_bid,
    p->>'guarantor_name', p->>'guarantor_father', p->>'guarantor_mobile', p->>'guarantor_address',
    p->>'vehicle_condition', p->>'sold_by', p->>'vehicle_model', p->>'vehicle_color', p->>'chassis_no', p->>'engine_no',
    (p->>'make_year')::int, p->>'vehicle_no', (p->>'insurance_expiry')::date,
    (p->>'agreement_date')::date, (p->>'installments')::int, (p->>'interval_months')::int,
    (p->>'finance_amount')::numeric, (p->>'interest_rate')::numeric,
    coalesce((p->>'agreement_amount')::numeric, 0), coalesce((p->>'hp_amount')::numeric, 0),
    v_amt.interest, v_amt.total, v_amt.emi, v_key)
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    -- A concurrent retry with the same key won the race: return its loan.
    select id into v_id from public.loans where idempotency_key = v_key;
    if found then
      return v_id;
    end if;
    raise;  -- otherwise it is a duplicate folio number
end;
$function$
;

-- ===== public.dashboard
CREATE OR REPLACE FUNCTION public.dashboard(p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
declare
  m0 date := date_trunc('month', p_day)::date;            -- first day of this month
  y0 date := (date_trunc('month', p_day) - interval '11 months')::date;
  pm_to date := (p_day - interval '1 month')::date;      -- same day last month
  v jsonb;
begin
  if not (public.has_perm('reports') and public.has_perm('view_accounts')) then raise exception 'not allowed' using errcode = '42501'; end if;

  -- the same numbers for everyone for up to a minute: the full calculation (all accounts' dues) runs at most once a minute
  select c.data into v from app_private.dashboard_cache c where c.day = p_day and c.computed_at > now() - interval '60 seconds';
  if found then return v; end if;

  create temp table _due on commit drop as select * from public.due_report(p_day);
  create temp table _rec on commit drop as
    select entry_date, debit, mode from public.day_book_entries where kind = 'receipt' and entry_date between y0 - 31 and p_day;
  create temp table _lent on commit drop as
    select entry_date, credit from public.day_book_entries where kind = 'loan' and entry_date between y0 and p_day;

  select jsonb_build_object(
    'day', p_day,
    'today', (select jsonb_build_object('amount', coalesce(sum(debit), 0), 'count', count(*)) from _rec where entry_date = p_day),
    'today_modes', (select coalesce(jsonb_object_agg(mode, s), '{}') from (select mode, sum(debit) s from _rec where entry_date = p_day group by mode) x),
    'yesterday', (select coalesce(sum(debit), 0) from _rec where entry_date = p_day - 1),
    'month', (select jsonb_build_object('amount', coalesce(sum(debit), 0), 'count', count(*)) from _rec where entry_date between m0 and p_day),
    'last_month_same_days', (select coalesce(sum(debit), 0) from _rec
                               where entry_date between (m0 - interval '1 month')::date and pm_to),
    'months', (select jsonb_agg(jsonb_build_object('month', to_char(mm, 'YYYY-MM'),
                         'collected', coalesce((select sum(debit) from _rec where date_trunc('month', entry_date) = mm), 0),
                         'lent', coalesce((select sum(credit) from _lent where date_trunc('month', entry_date) = mm), 0)) order by mm)
                 from generate_series(y0::timestamp, m0::timestamp, interval '1 month') mm),
    'new_loans_month', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(credit), 0)) from _lent where entry_date between m0 and p_day),
    'outstanding', (select jsonb_build_object(
                        'balance', coalesce(sum(greatest(balance, 0)), 0),
                        'accounts', count(*) filter (where balance > 0),
                        'arrears', coalesce(sum(arrears), 0),
                        'overdue_accounts', count(*) filter (where arrears > 0),
                        'overdue_3', count(*) filter (where overdue_emis >= 3)) from _due),
    'due_today', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(emi), 0)) from _due where next_due = p_day and not seized),
    'due_week', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(emi), 0)) from _due where next_due between p_day and p_day + 6 and not seized),
    'seized', (select jsonb_build_object('count', count(*), 'balance', coalesce(sum(balance), 0)) from public.seized_accounts),
    'top_overdue', (select coalesce(jsonb_agg(to_jsonb(t) order by t.arrears desc), '[]') from (
                      select source, ref_id, folio, borrower_name, mobile, arrears, overdue_emis, balance
                        from _due where arrears > 0 and not seized order by arrears desc limit 10) t),
    'pending_approvals', (select count(*) from public.pending_payments),
    'cash_open', (select count(distinct p.created_by) from public.payments p
                   where (p.created_at at time zone 'Asia/Kolkata')::date between p_day - 6 and p_day
                     and public.mode_part(p.payment_mode, p.paid_amount, p.parts, 'CASH') > 0
                     and not exists (select 1 from public.cash_closings c
                                      where c.user_id = p.created_by and c.day = (p.created_at at time zone 'Asia/Kolkata')::date))
  ) into v;
  insert into app_private.dashboard_cache (day, data, computed_at) values (p_day, v, now())
  on conflict (day) do update set data = excluded.data, computed_at = excluded.computed_at;
  delete from app_private.dashboard_cache where day < p_day - 7;
  return v;
end;
$function$
;

-- ===== public.day_book_opening
CREATE OR REPLACE FUNCTION public.day_book_opening(p_from date)
 RETURNS TABLE(debit numeric, credit numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(sum(e.debit), 0), coalesce(sum(e.credit), 0)
  from public.day_book_entries e
  where e.entry_date < p_from;
$function$
;

-- ===== public.delete_remark
CREATE OR REPLACE FUNCTION public.delete_remark(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.visit_remarks;
begin
  select * into r from public.visit_remarks where id = p_id for update;
  if not found then raise exception 'remark not found' using errcode = 'P0002'; end if;
  if not (public.has_perm('fix_entries')
          or (r.created_by = auth.uid() and (r.created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date)) then
    raise exception 'only admin can delete an older remark' using errcode = '42501';
  end if;
  delete from public.visit_remarks where id = p_id;
  perform app_private.log('remark_deleted', (select x ->> 'subject' from (select app_private.acct_ref(
            (select id from public.legacy_accounts where r.source = 'old' and sno = r.ref_id),
            case when r.source = 'new' then r.ref_id end) x) y),
          jsonb_build_object('source', r.source, 'ref_id', r.ref_id),
          jsonb_build_object('remark', r.remark, 'promise_date', r.promise_date, 'written_by', app_private.staff_name(r.created_by),
                             'written_on', (r.created_at at time zone 'Asia/Kolkata')::date));
end;
$function$
;

-- ===== public.due_report
CREATE OR REPLACE FUNCTION public.due_report(p_asof date)
 RETURNS TABLE(source text, ref_id bigint, folio text, borrower_name text, vehicle_model text, mobile text, vehicle_no text, seized boolean, search_text text, emi numeric, balance numeric, arrears numeric, overdue_emis integer, due_emis numeric, next_due date, agreement_date date, tenure integer, finance_amount numeric, interest_amount numeric, other_charges numeric, total_amount numeric, total_paid numeric, last_paid date, late_days integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with acct0 as (
  select 'old'::text as src, a.sno::bigint as ref, a.id as acct_id, null::bigint as loan_id,
         case when nullif(a.fcode, '') is not null then a.fcode || '-' || a.fno else a.fno::text end as folio,
         a.borrower_name as nm, a.vehicle_model as model,
         nullif(concat_ws(', ', a.borrower_mobile, a.borrower_mobile2), '') as mob,
         a.registration_no as vno, public.legacy_is_seized(a.id, a.seized) as sz,
         lower(concat_ws(' ', a.search_text, a.chassis_no, a.engine_no,
               case when nullif(a.fcode, '') is not null then a.fcode || '-' || a.fno end)) as st,
         a.emi_amount as emi, a.total_amount as total, a.tenure_months as tenure,
         greatest(coalesce(a.interval_months, 1), 1) as iv, a.agreement_date as start,
         a.finance_amount as fin, a.interest_amount as intr, a.agreement_amount + a.hp_amount as other
    from public.legacy_accounts a
   where a.ledger = 'pending' and not public.legacy_settled(a.id)
  union all
  select 'new', l.id, null, l.id, l.folio_no, b.full_name, l.vehicle_model, b.mobile, l.vehicle_no, l.status = 'seized',
         lower(concat_ws(' ', l.folio_no, b.full_name, b.father_name, b.mobile, l.vehicle_no, l.chassis_no, l.engine_no)),
         l.emi_amount, l.total_amount, l.installments, greatest(l.interval_months, 1), l.agreement_date,
         l.finance_amount, l.interest_amount, l.agreement_amount + l.hp_amount
    from public.loans l
    join public.borrowers b on b.id = l.borrower_id
   where l.status in ('active', 'seized')
),
acct as (
  select a.*, public.adj_total(a.acct_id, a.loan_id) as adj,
         rs.created_at as r_at, rs.entry_date as r_date, rs.new_emi as r_emi, rs.next_due as r_due
    from acct0 a
    left join lateral (
      select x.created_at, x.entry_date, x.new_emi, x.next_due from public.adjustments x
       where x.kind = 'reschedule' and x.cancelled_at is null and (x.legacy_account_id = a.acct_id or x.loan_id = a.loan_id)
       order by x.created_at desc, x.id desc limit 1
    ) rs on true
),
rcpt0 as (
  select a.src, a.ref, a.iv, a.emi, lp.installment_no as n, lp.paid_date as pd, lp.due_date as d, lp.paid_amount as amt,
         null::int as stored_im, lp.delay_days as dd, null::timestamptz as ca
    from acct a
    join public.legacy_payments lp on lp.account_id = a.acct_id and lp.ledger = 'pending'
  union all
  select a.src, a.ref, a.iv, a.emi, p.installment_no, p.paid_date, p.due_date, p.paid_amount, p.installments_covered, p.delay_days, p.created_at
    from acct a
    join public.payments p on p.legacy_account_id = a.acct_id
  union all
  select a.src, a.ref, a.iv, a.emi, p.installment_no, p.paid_date, p.due_date, p.paid_amount, p.installments_covered, p.delay_days, p.created_at
    from acct a
    join public.payments p on p.loan_id = a.loan_id
),
rcpt_gap as (
  select r.*,
         ((extract(year from lead(r.d) over w) - extract(year from r.d)) * 12
          + (extract(month from lead(r.d) over w) - extract(month from r.d)))::int as gap
    from rcpt0 r
  window w as (partition by r.src, r.ref order by r.n, r.pd nulls first)
),
rcpt as (
  select g.src, g.ref, g.n, g.pd, g.d, g.amt, g.dd, g.ca,
         case when g.stored_im is not null and g.stored_im > 0 then g.stored_im
              when g.gap is not null and g.gap > 0 and g.gap % g.iv = 0 and g.gap / g.iv between 1 and 60 then g.gap / g.iv
              when g.emi > 0 then greatest(1, round(g.amt / g.emi))::int
              else 1 end as im
    from rcpt_gap g
),
agg as (
  select src, ref, sum(amt) as paid, sum(im)::int as used, max(pd) as last_paid, coalesce(sum(dd), 0)::int as late
    from rcpt group by src, ref
),
lastr as (
  select distinct on (src, ref) src, ref, d as last_due, im as last_im
    from rcpt
   where d is not null
   order by src, ref, n desc, pd desc nulls last
),
rslots as (  -- EMI slots covered by receipts that fall on or before the as-of date
  select r.src, r.ref, count(*)::int as c
    from rcpt r
    join acct a on a.src = r.src and a.ref = r.ref
    cross join lateral generate_series(0, r.im - 1) j
   where r.d is not null and (r.d + make_interval(months => j * a.iv))::date <= p_asof
   group by r.src, r.ref
),
calc as (
  select a.*, coalesce(g.paid, 0) as paid, coalesce(g.used, 0) as used, g.last_paid, coalesce(g.late, 0) as late, l.last_due, l.last_im, coalesce(rs.c, 0) as rdue,
         a.total + a.adj - coalesce(g.paid, 0) as bal
    from acct a
    left join agg g on g.src = a.src and g.ref = a.ref
    left join lastr l on l.src = a.src and l.ref = a.ref
    left join rslots rs on rs.src = a.src and rs.ref = a.ref
),
calc2 as (
  select c.*,
         case when c.bal <= 0 then 0 else greatest(0, greatest(coalesce(c.tenure, 0), c.used) - c.used) end as remaining
    from calc c
),
slots as (  -- remaining (uncovered) EMI slots with their due dates
  select c.src, c.ref, k,
         case when c.last_due is not null then (c.last_due + make_interval(months => (c.last_im + k - 1) * c.iv))::date
              when c.start is not null then (c.start + make_interval(months => (c.used + k) * c.iv))::date end as due
    from calc2 c
    cross join lateral generate_series(1, c.remaining) k
   where c.r_at is null
),
slot_stats as (
  select src, ref,
         min(due) filter (where k = 1) as next_due,
         count(*) filter (where due <= p_asof)::int as due_le,
         count(*) filter (where due < p_asof)::int as overdue
    from slots
   group by src, ref
),
-- rescheduled accounts
rs1 as (
  select c.src, c.ref, c.r_emi, c.r_due, c.iv, c.bal,
         coalesce((select sum(r.amt) from rcpt r
                    where r.src = c.src and r.ref = c.ref
                      and ((r.ca is not null and r.ca < c.r_at) or (r.ca is null and (r.pd is null or r.pd < c.r_date)))), 0) as p_before,
         c.paid, c.total + c.adj as owed
    from calc2 c
   where c.r_at is not null
),
rs2 as (
  select x.*, x.paid - x.p_before as p_after, greatest(0, ceil((x.owed - x.p_before) / x.r_emi))::int as n from rs1 x
),
rs3 as (
  select y.*, least(y.n, greatest(0, floor(y.p_after / y.r_emi)))::int as cov,
         (select count(*) from generate_series(1, y.n) k where (y.r_due + make_interval(months => (k - 1) * y.iv))::date <= p_asof)::int as dle,
         (select count(*) from generate_series(1, y.n) k where (y.r_due + make_interval(months => (k - 1) * y.iv))::date < p_asof)::int as dlt
    from rs2 y
),
fin as (
  select c.*,
         coalesce(r.r_emi, c.emi) as emi_now,
         case when r.src is not null then
                case when c.bal > 0 and r.cov < r.n then (r.r_due + make_interval(months => r.cov * r.iv))::date end
              else s.next_due end as nd,
         case when r.src is not null then greatest(0, r.dlt - r.cov) else coalesce(s.overdue, 0) end as overdue,
         case when c.bal <= 0 then 0
              when r.src is not null then greatest(0, least(c.bal, r.r_emi * r.dle - r.p_after))
              else greatest(0, least(c.bal, c.emi * (c.rdue + coalesce(s.due_le, 0)) - c.paid)) end as arr
    from calc2 c
    left join slot_stats s on s.src = c.src and s.ref = c.ref
    left join rs3 r on r.src = c.src and r.ref = c.ref
)
select f.src, f.ref, f.folio, f.nm, f.model, f.mob, f.vno, f.sz, f.st, f.emi_now, f.bal, f.arr, f.overdue,
       case when f.emi_now > 0 then floor((f.arr * 100 * 10 + floor(f.emi_now * 100 / 2)) / (f.emi_now * 100)) / 10 else 0 end,
       f.nd,
       f.start, f.tenure, f.fin, f.intr, f.other + f.adj, f.total + f.adj, f.paid, f.last_paid, f.late
  from fin f;
$function$
;

-- ===== public.get_notification_settings
CREATE OR REPLACE FUNCTION public.get_notification_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.app_settings;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  select * into s from public.app_settings where id = 1;
  return to_jsonb(s) - 'telegram_bot_token' - 'whatsapp_api_key' || jsonb_build_object(
    'telegram_bot_token', case when s.telegram_bot_token is null then '' else '••••' || right(s.telegram_bot_token, 4) end,
    'whatsapp_api_key',   case when s.whatsapp_api_key   is null then '' else '••••' || right(s.whatsapp_api_key, 4) end);
end;
$function$
;

-- ===== public.has_perm
CREATE OR REPLACE FUNCTION public.has_perm(p text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.staff s
                  where s.user_id = (select auth.uid()) and s.active and app_private.session_ok(s.force_logout_at)
                    and (s.role = 'admin' or p = any (s.permissions)));
$function$
;

-- ===== public.is_admin
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.active and s.role = 'admin'
                  and app_private.session_ok(s.force_logout_at));
$function$
;

-- ===== public.is_staff
CREATE OR REPLACE FUNCTION public.is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.active and app_private.session_ok(s.force_logout_at));
$function$
;

-- ===== public.legacy_is_seized
CREATE OR REPLACE FUNCTION public.legacy_is_seized(p_id bigint, p_legacy boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    (select s.action = 'seize' from public.seizures s where s.legacy_account_id = p_id order by s.created_at desc, s.id desc limit 1),
    p_legacy, false);
$function$
;

-- ===== public.legacy_settled
CREATE OR REPLACE FUNCTION public.legacy_settled(p_acct bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.adjustments where legacy_account_id = p_acct and kind = 'settle' and cancelled_at is null);
$function$
;

-- ===== public.loan_amounts
CREATE OR REPLACE FUNCTION public.loan_amounts(p_principal numeric, p_rate numeric, p_installments integer, p_interval integer, p_agreement numeric, p_hp numeric, OUT interest numeric, OUT total numeric, OUT emi numeric)
 RETURNS record
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select i, t, ceil(t / p_installments)
  from (select round(p_principal * p_rate * (p_installments * p_interval) / 1200, 0) as i) a,
       lateral (select p_principal + a.i + p_agreement + p_hp as t) b;
$function$
;

-- ===== public.main_book_status
CREATE OR REPLACE FUNCTION public.main_book_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with s as (select * from public.receipt_series where zone_id is null and closed_at is null),
  last_app as (
    select max(n) as n from (
      select max(receipt_no) n from public.payments where series_id = (select id from s)
      union all
      select max(receipt_no) from public.pending_payments where series_id = (select id from s)) x
  )
  select jsonb_build_object(
    'book_no', s.book_no,
    'book_code', case when s.book_no = 1 then 'MAIN' else s.code end,
    'book_start', s.start_no,
    'book_opened', s.opened_at,
    'last_used', (select n from last_app),
    'next_no', case when s.book_no = 1 then (select n + 1 from last_app) else coalesce((select n + 1 from last_app), s.start_no) end,
    'receipts', (select count(*) from public.payments where series_id = s.id) + (select count(*) from public.pending_payments where series_id = s.id),
    'accounts', (select count(*) from public.legacy_accounts a
                  where not exists (select 1 from public.zones z where z.name = upper(btrim(a.zone))))
              + (select count(*) from public.loans l
                  where not exists (select 1 from public.zones z where z.name = upper(btrim(l.zone)))),
    'books', coalesce((select jsonb_agg(jsonb_build_object('code', case when o.book_no = 1 then 'MAIN' else o.code end, 'book_no', o.book_no,
                                                            'start', o.start_no, 'opened', o.opened_at, 'closed', o.closed_at,
                                                            'last', (select max(receipt_no) from public.payments where series_id = o.id),
                                                            'receipts', (select count(*) from public.payments where series_id = o.id)
                                                                        + (select count(*) from public.legacy_payments where series_id = o.id))
                                         order by o.book_no desc)
                         from public.receipt_series o where o.zone_id is null and o.closed_at is not null), '[]'))
  from s
  where public.is_staff();
$function$
;

-- ===== public.mode_part
CREATE OR REPLACE FUNCTION public.mode_part(p_mode text, p_amount numeric, p_parts jsonb, p_want text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when p_mode = 'SPLIT'
              then coalesce((select sum((x ->> 'amount')::numeric) from jsonb_array_elements(p_parts) x where x ->> 'mode' = p_want), 0)
              when p_mode = p_want then p_amount else 0 end;
$function$
;

-- ===== public.notification_result
CREATE OR REPLACE FUNCTION public.notification_result(p_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.notification_log;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  perform app_private.refresh_log();
  select * into r from public.notification_log where id = p_id;
  return jsonb_build_object('status', r.status, 'detail', r.detail);
end;
$function$
;

-- ===== public.payment_mode_text
CREATE OR REPLACE FUNCTION public.payment_mode_text(p_mode text, p_bank text, p_parts jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when p_mode = 'SPLIT'
              then (select string_agg((x ->> 'mode') || coalesce(' ' || nullif(x ->> 'bank_name', ''), '') || ' ' || app_private.inr((x ->> 'amount')::numeric), ' + ' order by o)
                      from jsonb_array_elements(p_parts) with ordinality t(x, o))
              else p_mode || coalesce(' ' || nullif(p_bank, ''), '') end;
$function$
;

-- ===== public.pending_approvals
CREATE OR REPLACE FUNCTION public.pending_approvals()
 RETURNS TABLE(id bigint, user_id uuid, subject text, source text, ref_id bigint, paid_amount numeric, paid_date date, receipt_no bigint, payment_mode text, reason text, by_name text, created_at timestamp with time zone, cash_part numeric, receipt_book text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.id, p.created_by,
         case when p.source = 'old' then (select 'SNO ' || a.sno || ' · ' || a.borrower_name from public.legacy_accounts a where a.sno = p.ref_id)
              else (select 'Folio ' || l.folio_no || ' · ' || b.full_name from public.loans l join public.borrowers b on b.id = l.borrower_id where l.id = p.ref_id) end,
         p.source, p.ref_id, p.paid_amount, p.paid_date, p.receipt_no,
         public.payment_mode_text(p.payment_mode, p.bank_name, p.parts), p.note, app_private.staff_name(p.created_by), p.created_at,
         public.mode_part(p.payment_mode, p.paid_amount, p.parts, 'CASH'), p.receipt_book
    from public.pending_payments p
   where public.has_perm('approve')
   order by p.created_by, p.created_at;
$function$
;

-- ===== public.receipt_book_status
CREATE OR REPLACE FUNCTION public.receipt_book_status()
 RETURNS TABLE(id bigint, user_id uuid, full_name text, from_no bigint, to_no bigint, issued_on date, note text, closed boolean, used integer, last_used bigint, skipped bigint[], skipped_count integer, book text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select b.id, b.user_id, s.full_name, b.from_no, b.to_no, b.issued_on, b.note, b.closed_at is not null,
         u.used, u.last_used,
         (select array_agg(n order by n) from (select n from generate_series(b.from_no, coalesce(u.last_used, b.from_no - 1)) n
                                               where not exists (select 1 from public.payments p where p.series_id = b.series_id and p.receipt_no = n) limit 50) z),
         (select count(*)::int from generate_series(b.from_no, coalesce(u.last_used, b.from_no - 1)) n
           where not exists (select 1 from public.payments p where p.series_id = b.series_id and p.receipt_no = n)),
         rs.code
    from public.receipt_books b
    join public.staff s on s.user_id = b.user_id
    join public.receipt_series rs on rs.id = b.series_id
    cross join lateral (select count(*)::int as used, max(p.receipt_no) as last_used
                          from public.payments p where p.series_id = b.series_id and p.receipt_no between b.from_no and b.to_no) u
   where public.has_perm('cash') or b.user_id = (select auth.uid())
   order by b.closed_at is not null, s.full_name, b.from_no;
$function$
;

-- ===== public.receipt_hint
CREATE OR REPLACE FUNCTION public.receipt_hint(p_source text DEFAULT NULL::text, p_ref bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with s as (select * from public.receipt_series where id = app_private.open_series(app_private.ref_zone(p_source, p_ref)))
  select jsonb_build_object(
    'last_app', (select max(n) from (select max(receipt_no) n from public.payments where series_id = s.id
                                     union all select max(receipt_no) from public.pending_payments where series_id = s.id) x),
    'last_mine', (select max(n) from (select max(receipt_no) n from public.payments where series_id = s.id and created_by = auth.uid()
                                      union all select max(receipt_no) from public.pending_payments where series_id = s.id and created_by = auth.uid()) x),
    'last_old', (select max(receipt_no) from public.legacy_payments where series_id = s.id),
    'books', coalesce((select jsonb_agg(jsonb_build_object('from', b.from_no, 'to', b.to_no,
                 'next', (select min(n) from generate_series(b.from_no, b.to_no) n
                           where not exists (select 1 from public.payments where series_id = s.id and receipt_no = n)
                             and not exists (select 1 from public.pending_payments where series_id = s.id and receipt_no = n))) order by b.from_no)
               from public.receipt_books b where b.user_id = auth.uid() and b.closed_at is null and b.series_id = s.id), '[]'),
    'series', case when s.zone_id is not null or s.book_no > 1 then jsonb_build_object(
                'code', s.code, 'zone', coalesce((select name from public.zones where id = s.zone_id), 'DHAMTARI'), 'book_no', s.book_no,
                'start', s.start_no, 'last', app_private.series_last(s.id), 'next', coalesce(app_private.series_last(s.id) + 1, s.start_no)) end
  )
  from s
  where public.has_perm('collect');
$function$
;

-- ===== public.record_payment
CREATE OR REPLACE FUNCTION public.record_payment(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_key    uuid    := (p->>'idempotency_key')::uuid;
  v_source text    := p->>'source';
  v_ref    bigint  := (p->>'ref_id')::bigint;
  v_amount numeric := (p->>'paid_amount')::numeric;
  v_date   date    := (p->>'paid_date')::date;
  v_im     int     := coalesce((p->>'installments_covered')::int, 1);
  v_rno    bigint  := (p->>'receipt_no')::bigint;
  v_today  date    := (now() at time zone 'Asia/Kolkata')::date;
  s        public.app_settings;
  v_book   public.receipt_books;
  v_note   text;
  v_row    public.payments;
  v_pend   public.pending_payments;
  v_series bigint;
begin
  if not public.has_perm('collect') then raise exception 'not allowed' using errcode = '42501'; end if;

  -- the same save sent twice (double tap / retry): return the first one
  select * into v_row from public.payments where idempotency_key = v_key;
  if found then
    return jsonb_build_object('id', v_row.id, 'receipt_no', v_row.receipt_no, 'installment_no', v_row.installment_no,
                              'balance_after', v_row.balance_after, 'pending', false, 'replayed', true);
  end if;
  select * into v_pend from public.pending_payments where idempotency_key = v_key;
  if found then
    return jsonb_build_object('id', v_pend.id, 'receipt_no', v_pend.receipt_no, 'pending', true, 'review', v_pend.note, 'replayed', true);
  end if;

  if p->>'payment_mode' = 'SPLIT' then
    p := jsonb_set(p, '{parts}', app_private.check_parts(p->'parts'));
    if v_amount is not null and round(v_amount, 2) <> (select sum((x->>'amount')::numeric) from jsonb_array_elements(p->'parts') x) then
      raise exception 'the parts must add up to the amount' using errcode = '22023';
    end if;
    v_amount := (select sum((x->>'amount')::numeric) from jsonb_array_elements(p->'parts') x);
    p := jsonb_set(p, '{paid_amount}', to_jsonb(v_amount)) - 'reference_no' - 'bank_name';
  elsif p->>'payment_mode' not in ('CASH', 'CHEQUE', 'SBI', 'BANK') or p->>'payment_mode' is null then
    raise exception 'choose payment mode' using errcode = '22023';
  end if;
  if v_amount is null or v_amount <= 0 then raise exception 'amount must be more than 0' using errcode = '22023'; end if;
  if v_date is null or v_date > v_today then raise exception 'paid date cannot be in the future' using errcode = '22023'; end if;
  if v_im < 1 or v_im > 360 then raise exception 'EMIs covered must be 1 or more' using errcode = '22023'; end if;
  if v_rno is null or v_rno <= 0 then raise exception 'enter the receipt number' using errcode = '22023'; end if;
  if v_source not in ('old', 'new') then raise exception 'bad source' using errcode = '22023'; end if;

  -- receipt number: never twice (app payments, waiting payments, old software)
  -- the account's zone book
  v_series := app_private.open_series(app_private.ref_zone(v_source, v_ref));
  p := p || jsonb_build_object('series_id', v_series);
  perform pg_advisory_xact_lock(hashtext('receipt:' || v_series || ':' || v_rno));
  if exists (select 1 from public.payments where series_id = v_series and receipt_no = v_rno)
     or exists (select 1 from public.pending_payments where series_id = v_series and receipt_no = v_rno)
     or exists (select 1 from public.legacy_payments where series_id = v_series and receipt_no = v_rno) then
    raise exception 'receipt no. % is already used in book %', v_rno, (select code from public.receipt_series where id = v_series) using errcode = '23505';
  end if;

  -- receipt books
  select * into s from public.app_settings where id = 1;
  select * into v_book from public.receipt_books where closed_at is null and series_id = v_series and int8range(from_no, to_no, '[]') @> v_rno;
  if found and v_book.user_id <> auth.uid() then
    raise exception 'receipt no. % belongs to %''s receipt book', v_rno, app_private.staff_name(v_book.user_id) using errcode = '22023';
  elsif not found and exists (select 1 from public.receipt_books where user_id = auth.uid() and closed_at is null and series_id = v_series) then
    raise exception 'receipt no. % is not in your receipt book (%)', v_rno,
      (select string_agg(from_no || '–' || to_no, ', ' order by from_no) from public.receipt_books where user_id = auth.uid() and closed_at is null and series_id = v_series)
      using errcode = '22023';
  elsif not found and s.require_receipt_books and not public.is_admin() then
    raise exception 'you have no receipt book; ask the admin to give you one' using errcode = '22023';
  end if;

  -- only accounts assigned to you today?
  if s.restrict_to_assigned and not public.has_perm('assign')
     and not exists (select 1 from public.collection_assignments ca
                      where ca.day = v_today and ca.user_id = auth.uid() and ca.source = v_source and ca.ref_id = v_ref) then
    raise exception 'this account is not in your collection list for today; ask the admin to assign it' using errcode = '22023';
  end if;

  -- the account must be open
  if v_source = 'old' then
    if not exists (select 1 from public.legacy_accounts a where a.sno = v_ref and a.ledger = 'pending' and not public.legacy_settled(a.id)) then
      raise exception 'account not found or not pending' using errcode = 'P0002';
    end if;
  elsif not exists (select 1 from public.loans where id = v_ref and status in ('active', 'seized')) then
    raise exception 'loan not found or closed' using errcode = 'P0002';
  end if;

  -- people without "approve": wait for the night cash count
  if not public.has_perm('approve') then
    v_note := concat_ws(' · ', 'waiting for cash count',
                        case when v_date < v_today - s.review_backdate_days then 'back-dated ' || (v_today - v_date) || ' days' end,
                        case when s.review_above > 0 and v_amount > s.review_above then 'more than ' || app_private.inr(s.review_above) end);
    insert into public.pending_payments (source, ref_id, paid_amount, paid_date, payment_mode, reference_no, bank_name, receipt_no,
                                         installments_covered, idempotency_key, note, parts, series_id)
    values (v_source, v_ref, v_amount, v_date, p->>'payment_mode', nullif(btrim(p->>'reference_no'), ''),
            nullif(btrim(p->>'bank_name'), ''), v_rno, v_im, v_key, v_note, case when p->>'payment_mode' = 'SPLIT' then p->'parts' end, v_series)
    returning * into v_pend;
    perform app_private.log('payment_pending', (select x ->> 'subject' from (select app_private.acct_ref(
              (select id from public.legacy_accounts where v_source = 'old' and sno = v_ref),
              case when v_source = 'new' then v_ref end) x) y),
            jsonb_build_object('source', v_source, 'ref_id', v_ref),
            jsonb_build_object('amount', v_amount, 'receipt_no', v_rno, 'paid_date', v_date, 'mode', p->>'payment_mode'));
    return jsonb_build_object('id', v_pend.id, 'receipt_no', v_rno, 'pending', true, 'review', v_note, 'replayed', false);
  end if;

  v_row := app_private.post_payment(p, auth.uid(), now());
  return jsonb_build_object('id', v_row.id, 'receipt_no', v_row.receipt_no, 'installment_no', v_row.installment_no,
                            'balance_after', v_row.balance_after, 'pending', false, 'replayed', false);
exception
  when unique_violation then
    select * into v_row from public.payments where idempotency_key = v_key;
    if found then
      return jsonb_build_object('id', v_row.id, 'receipt_no', v_row.receipt_no, 'installment_no', v_row.installment_no,
                                'balance_after', v_row.balance_after, 'pending', false, 'replayed', true);
    end if;
    raise;
end;
$function$
;

-- ===== public.refresh_notification_log
CREATE OR REPLACE FUNCTION public.refresh_notification_log()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  perform app_private.refresh_log();
end;
$function$
;

-- ===== public.remarks_list
CREATE OR REPLACE FUNCTION public.remarks_list(p_from date, p_to date, p_user uuid, p_q text, p_status text, p_promise date, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(id bigint, source text, ref_id bigint, subject text, folio text, mobile text, installment_no integer, remark text, promise_date date, created_at timestamp with time zone, by_user uuid, by_name text, paid_after boolean, total bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with base as (
    select r.*,
           case when r.source = 'old' then a.borrower_name else b.full_name end as name,
           case when r.source = 'old' then a.fno::text else l.folio_no end as folio,
           case when r.source = 'old' then a.borrower_mobile else b.mobile end as mobile,
           app_private.paid_after(r.source, r.ref_id, r.created_at) as paid
      from public.visit_remarks r
      left join public.legacy_accounts a on r.source = 'old' and a.sno = r.ref_id
      left join public.loans l on r.source = 'new' and l.id = r.ref_id
      left join public.borrowers b on b.id = l.borrower_id
     where (public.has_perm('view_accounts') or public.has_perm('collect'))
       and (app_private.sees_all_remarks() or r.created_by = auth.uid())
       and (p_from is null or (r.created_at at time zone 'Asia/Kolkata')::date >= p_from)
       and (p_to is null or (r.created_at at time zone 'Asia/Kolkata')::date <= p_to)
       and (p_user is null or r.created_by = p_user)
       and (p_promise is null or r.promise_date = p_promise)
  ),
  f as (
    select * from base
     where (nullif(btrim(p_q), '') is null
            or name ilike '%' || btrim(p_q) || '%' or mobile ilike '%' || btrim(p_q) || '%'
            or folio ilike btrim(p_q) || '%' or remark ilike '%' || btrim(p_q) || '%')
       and (p_status is null
            or (p_status = 'open' and not paid)
            or (p_status = 'paid' and paid)
            or (p_status = 'broken' and not paid and promise_date < (now() at time zone 'Asia/Kolkata')::date))
  )
  select f.id, f.source, f.ref_id, f.name, f.folio, f.mobile, f.installment_no, f.remark, f.promise_date, f.created_at,
         f.created_by, app_private.staff_name(f.created_by), f.paid, count(*) over ()
    from f
   order by f.created_at desc
   limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0);
$function$
;

-- ===== public.review_payment
CREATE OR REPLACE FUNCTION public.review_payment(p_id bigint, p_approve boolean, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.payments; r jsonb;
begin
  if not public.has_perm('approve') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into o from public.payments where id = p_id for update;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if o.review_reason is null or o.reviewed_at is not null then raise exception 'this payment is not waiting for approval' using errcode = '22023'; end if;
  if p_approve then
    update public.payments set reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
    r := app_private.acct_ref(o.legacy_account_id, o.loan_id);
    perform app_private.log('payment_approved', r ->> 'subject', r - 'subject',
      jsonb_build_object('receipt_no', o.receipt_no, 'amount', o.paid_amount, 'why', o.review_reason, 'note', nullif(btrim(p_note), '')));
  else
    perform app_private.cancel_payment_core(p_id, app_private.need_reason(p_note), 'payment_rejected');
  end if;
  return jsonb_build_object('id', p_id, 'approved', p_approve);
end;
$function$
;

-- ===== public.review_pending
CREATE OR REPLACE FUNCTION public.review_pending(p_ids bigint[], p_approve boolean, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.pending_payments; ok int := 0; amt numeric := 0; failed jsonb := '[]'; v_reason text; who text[] := '{}';
begin
  if not public.has_perm('approve') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not p_approve then v_reason := app_private.need_reason(p_note); end if;
  for r in select * from public.pending_payments where id = any (p_ids) order by created_at, id for update loop
    if p_approve then
      begin
        perform app_private.post_payment(jsonb_build_object(
          'source', r.source, 'ref_id', r.ref_id, 'paid_amount', r.paid_amount, 'paid_date', r.paid_date,
          'payment_mode', r.payment_mode, 'reference_no', r.reference_no, 'bank_name', r.bank_name,
          'receipt_no', r.receipt_no, 'installments_covered', r.installments_covered, 'idempotency_key', r.idempotency_key, 'parts', r.parts, 'series_id', r.series_id),
          r.created_by, r.created_at);
        delete from public.pending_payments where id = r.id;
        ok := ok + 1; amt := amt + r.paid_amount;
        who := array_append(who, app_private.staff_name(r.created_by));
      exception when others then
        failed := failed || jsonb_build_object('id', r.id, 'receipt_no', r.receipt_no, 'reason', sqlerrm);
      end;
    else
      delete from public.pending_payments where id = r.id;
      perform app_private.log('payment_rejected', null, jsonb_build_object('source', r.source, 'ref_id', r.ref_id),
        jsonb_build_object('reason', v_reason, 'receipt_no', r.receipt_no, 'amount', r.paid_amount, 'paid_date', r.paid_date,
                           'collected_by', app_private.staff_name(r.created_by)));
      ok := ok + 1; amt := amt + r.paid_amount;
    end if;
  end loop;
  if p_approve and ok > 0 then
    perform app_private.log('payments_approved', array_to_string(array(select distinct unnest(who)), ', '), null,
      jsonb_build_object('count', ok, 'amount', amt, 'note', nullif(btrim(p_note), ''), 'failed', jsonb_array_length(failed)));
  end if;
  return jsonb_build_object('done', ok, 'amount', amt, 'failed', failed);
end;
$function$
;

-- ===== public.save_notification_settings
CREATE OR REPLACE FUNCTION public.save_notification_settings(p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  update public.app_settings set
    business_name           = coalesce(nullif(btrim(p ->> 'business_name'), ''), business_name),
    telegram_enabled        = coalesce((p ->> 'telegram_enabled')::boolean, telegram_enabled),
    telegram_bot_token      = case when p ? 'telegram_bot_token' and (p ->> 'telegram_bot_token') not like '••••%'
                                   then nullif(btrim(p ->> 'telegram_bot_token'), '') else telegram_bot_token end,
    telegram_group_id       = case when p ? 'telegram_group_id' then nullif(btrim(p ->> 'telegram_group_id'), '') else telegram_group_id end,
    tg_on_payment           = coalesce((p ->> 'tg_on_payment')::boolean, tg_on_payment),
    tg_on_new_loan          = coalesce((p ->> 'tg_on_new_loan')::boolean, tg_on_new_loan),
    tg_on_seizure           = coalesce((p ->> 'tg_on_seizure')::boolean, tg_on_seizure),
    tg_daily_summary        = coalesce((p ->> 'tg_daily_summary')::boolean, tg_daily_summary),
    tg_summary_hour         = coalesce((p ->> 'tg_summary_hour')::int, tg_summary_hour),
    whatsapp_enabled        = coalesce((p ->> 'whatsapp_enabled')::boolean, whatsapp_enabled),
    whatsapp_host           = case when p ? 'whatsapp_host' then nullif(btrim(p ->> 'whatsapp_host'), '') else whatsapp_host end,
    whatsapp_api_key        = case when p ? 'whatsapp_api_key' and (p ->> 'whatsapp_api_key') not like '••••%'
                                   then nullif(btrim(p ->> 'whatsapp_api_key'), '') else whatsapp_api_key end,
    wa_receipt              = coalesce((p ->> 'wa_receipt')::boolean, wa_receipt),
    wa_receipt_template     = coalesce(nullif(btrim(p ->> 'wa_receipt_template'), ''), wa_receipt_template),
    wa_due_reminder         = coalesce((p ->> 'wa_due_reminder')::boolean, wa_due_reminder),
    wa_reminder_days_before = coalesce((p ->> 'wa_reminder_days_before')::int, wa_reminder_days_before),
    wa_reminder_hour        = coalesce((p ->> 'wa_reminder_hour')::int, wa_reminder_hour),
    wa_reminder_template    = coalesce(nullif(btrim(p ->> 'wa_reminder_template'), ''), wa_reminder_template),
    review_backdate_days    = coalesce((p ->> 'review_backdate_days')::int, review_backdate_days),
    review_above            = coalesce((p ->> 'review_above')::numeric, review_above),
    require_receipt_books   = coalesce((p ->> 'require_receipt_books')::boolean, require_receipt_books),
    restrict_to_assigned    = coalesce((p ->> 'restrict_to_assigned')::boolean, restrict_to_assigned),
    updated_at              = now(),
    updated_by              = (select auth.uid())
  where id = 1;
end;
$function$
;

-- ===== public.send_test_notification
CREATE OR REPLACE FUNCTION public.send_test_notification(p_channel text, p_mobile text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.app_settings; v_id bigint; v_txt text;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  select * into s from public.app_settings where id = 1;
  v_txt := '🧪 Test from ' || s.business_name || chr(10) || 'Notifications are working.' || chr(10) ||
           to_char(now() at time zone 'Asia/Kolkata', 'DD/MM/YYYY HH12:MI AM');
  if p_channel = 'telegram' then
    if s.telegram_bot_token is null or s.telegram_group_id is null then raise exception 'save the bot token and group id first' using errcode = '22023'; end if;
    -- test works even while the switch is off
    v_id := app_private.tg_send_force(v_txt);
  elsif p_channel = 'whatsapp' then
    if s.whatsapp_host is null or s.whatsapp_api_key is null then raise exception 'save the WhatsApp host and API key first' using errcode = '22023'; end if;
    if app_private.wa_number(p_mobile) is null then raise exception 'enter a valid 10-digit mobile number' using errcode = '22023'; end if;
    v_id := app_private.wa_send(p_mobile, v_txt, 'test', null, true);
  elsif p_channel = 'summary' then
    if s.telegram_bot_token is null or s.telegram_group_id is null then raise exception 'save the bot token and group id first' using errcode = '22023'; end if;
    v_id := app_private.daily_summary((now() at time zone 'Asia/Kolkata')::date, null);
    if v_id is null then raise exception 'turn Telegram on first' using errcode = '22023'; end if;
  else
    raise exception 'bad channel' using errcode = '22023';
  end if;
  return v_id;
end;
$function$
;

-- ===== public.set_account_zone
CREATE OR REPLACE FUNCTION public.set_account_zone(p_source text, p_ref bigint, p_zone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

-- ===== public.set_seized
CREATE OR REPLACE FUNCTION public.set_seized(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_src     text    := p->>'source';
  v_ref     bigint  := (p->>'ref_id')::bigint;
  v_seize   boolean := (p->>'seize')::boolean;
  v_date    date    := (p->>'action_date')::date;
  v_remarks text    := nullif(btrim(p->>'remarks'), '');
  v_key     uuid    := (p->>'idempotency_key')::uuid;
  v_acct    bigint;
  v_loan    bigint;
  v_status  text;
  v_now     boolean;
  v_id      bigint;
begin
  if not public.has_perm('seize') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select id into v_id from public.seizures where idempotency_key = v_key;
  if found then
    return jsonb_build_object('id', v_id, 'replayed', true);
  end if;

  if v_seize is null or v_date is null then
    raise exception 'missing details' using errcode = '22023';
  end if;
  if v_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'date cannot be in the future' using errcode = '22023';
  end if;
  if not v_seize and v_remarks is null then
    raise exception 'enter the reason for releasing' using errcode = '22023';
  end if;
  if length(v_remarks) > 300 then
    raise exception 'remarks too long' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('seize:' || v_src || ':' || v_ref));

  if v_src = 'old' then
    select id, public.legacy_is_seized(id, seized) into v_acct, v_now from public.legacy_accounts where sno = v_ref;
    if not found then raise exception 'account not found' using errcode = 'P0002'; end if;
  elsif v_src = 'new' then
    select id, status into v_loan, v_status from public.loans where id = v_ref for update;
    if not found then raise exception 'loan not found' using errcode = 'P0002'; end if;
    if v_status = 'closed' then raise exception 'loan is closed' using errcode = '22023'; end if;
    v_now := v_status = 'seized';
  else
    raise exception 'bad source' using errcode = '22023';
  end if;

  if v_now = v_seize then
    raise exception '%', case when v_seize then 'already seized' else 'not seized' end using errcode = '22023';
  end if;

  insert into public.seizures (legacy_account_id, loan_id, action, action_date, remarks, idempotency_key)
  values (v_acct, v_loan, case when v_seize then 'seize' else 'release' end, v_date, v_remarks, v_key)
  returning id into v_id;

  if v_loan is not null then
    update public.loans set status = case when v_seize then 'seized' else 'active' end where id = v_loan;
  end if;

  return jsonb_build_object('id', v_id, 'replayed', false);
end;
$function$
;

-- ===== public.staff_names
CREATE OR REPLACE FUNCTION public.staff_names(p_all boolean DEFAULT false)
 RETURNS TABLE(user_id uuid, full_name text, active boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select s.user_id, s.full_name || case when s.archived_at is not null then ' (removed)' else '' end, s.active
    from public.staff s
   where (public.has_perm('cash') or public.has_perm('activity') or public.has_perm('approve') or public.has_perm('assign'))
     and (p_all or s.archived_at is null)
   order by s.archived_at is not null, s.active desc, s.full_name;
$function$
;

-- ===== public.staff_performance
CREATE OR REPLACE FUNCTION public.staff_performance(p_from date, p_to date)
 RETURNS TABLE(user_id uuid, full_name text, active boolean, receipts integer, collected numeric, cash numeric, loans integer, lent numeric, seized integer, released integer, cash_expected numeric, cash_received numeric, cash_short numeric, days_open integer, late_fees numeric, fixes integer, last_receipt timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
  with p as (
    select created_by uid, count(*)::int n, sum(paid_amount) amt, sum(public.mode_part(payment_mode, paid_amount, parts, 'CASH')) cash, max(created_at) last
      from public.payments where (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to group by 1),
  l as (select created_by uid, count(*)::int n, sum(finance_amount) amt from public.loans
         where (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to group by 1),
  s as (select created_by uid, count(*) filter (where action = 'seize')::int sz, count(*) filter (where action = 'release')::int rl
          from public.seizures where (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to group by 1),
  c as (select user_id uid, sum(expected_cash) exp, sum(received_amount) rec from public.cash_closings where day between p_from and p_to group by 1),
  o as (  -- days with cash collected but not yet received
    select created_by uid, count(distinct (created_at at time zone 'Asia/Kolkata')::date)::int n
      from public.payments x
     where (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to and public.mode_part(payment_mode, paid_amount, parts, 'CASH') > 0
       and not exists (select 1 from public.cash_closings cc where cc.user_id = x.created_by and cc.day = (x.created_at at time zone 'Asia/Kolkata')::date)
     group by 1),
  f as (select created_by uid, sum(amount) amt from public.adjustments
         where kind = 'penalty' and cancelled_at is null and (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to group by 1),
  x as (select by_user uid, count(*)::int n from public.data_audit
         where action in ('payment_edited', 'payment_cancelled', 'loan_edited', 'loan_deleted', 'payment_rejected')
           and (at at time zone 'Asia/Kolkata')::date between p_from and p_to group by 1)
  select st.user_id, st.full_name, st.active,
         coalesce(p.n, 0), coalesce(p.amt, 0), coalesce(p.cash, 0),
         coalesce(l.n, 0), coalesce(l.amt, 0), coalesce(s.sz, 0), coalesce(s.rl, 0),
         coalesce(c.exp, 0), coalesce(c.rec, 0), coalesce(c.exp, 0) - coalesce(c.rec, 0),
         coalesce(o.n, 0), coalesce(f.amt, 0), coalesce(x.n, 0), p.last
    from public.staff st
    left join p on p.uid = st.user_id left join l on l.uid = st.user_id left join s on s.uid = st.user_id
    left join c on c.uid = st.user_id left join o on o.uid = st.user_id left join f on f.uid = st.user_id
    left join x on x.uid = st.user_id
   where public.has_perm('cash')
     and (st.active or p.n is not null or l.n is not null)
   order by coalesce(p.amt, 0) desc, st.full_name;
$function$
;

-- ===== public.unassign_collections
CREATE OR REPLACE FUNCTION public.unassign_collections(p_ids bigint[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_n int;
begin
  if not public.has_perm('assign') then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.collection_assignments where id = any (p_ids);
  get diagnostics v_n = row_count;
  perform app_private.log('unassigned', null, null, jsonb_build_object('removed', v_n));
  return v_n;
end;
$function$
;

-- ===== public.zone_status
CREATE OR REPLACE FUNCTION public.zone_status()
 RETURNS TABLE(id bigint, name text, active boolean, accounts integer, book_id bigint, book_no integer, book_code text, book_start bigint, book_opened timestamp with time zone, last_used bigint, next_no bigint, receipts integer, books jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select z.id, z.name, z.active,
         ((select count(*) from public.loans l where upper(btrim(l.zone)) = z.name)
          + (select count(*) from public.legacy_accounts a where upper(btrim(a.zone)) = z.name))::int,
         s.id, s.book_no, s.code, s.start_no, s.opened_at,
         app_private.series_last(s.id),
         coalesce(app_private.series_last(s.id) + 1, s.start_no),
         ((select count(*) from public.payments where series_id = s.id) + (select count(*) from public.pending_payments where series_id = s.id))::int,
         coalesce((select jsonb_agg(jsonb_build_object('code', o.code, 'book_no', o.book_no, 'start', o.start_no, 'opened', o.opened_at,
                                                       'closed', o.closed_at, 'last', app_private.series_last(o.id),
                                                       'receipts', (select count(*) from public.payments where series_id = o.id)
                                                                   + (select count(*) from public.legacy_payments where series_id = o.id))
                                     order by o.book_no desc)
                     from public.receipt_series o where o.zone_id = z.id and o.closed_at is not null), '[]')
    from public.zones z
    left join public.receipt_series s on s.zone_id = z.id and s.closed_at is null
   where public.is_staff()
   order by z.name;
$function$
;

-- ===== VIEW public.day_book_entries
create view public.day_book_entries as
 SELECT lp.paid_date AS entry_date,
    1 AS kind_order,
    'receipt'::text AS kind,
    (COALESCE(a.borrower_name, 'UNKNOWN ACCOUNT'::text) || COALESCE((' '::text || a.registration_no), ''::text)) AS particulars,
    (a.fno)::text AS folio,
    lp.due_amount,
    lp.due_date,
    lp.delay_days,
        CASE
            WHEN (a.emi_amount > (0)::numeric) THEN (GREATEST((1)::numeric, round((lp.paid_amount / a.emi_amount))))::integer
            ELSE NULL::integer
        END AS im,
    COALESCE(lp.payment_mode, 'CASH'::text) AS mode,
    (lp.receipt_no)::bigint AS receipt_no,
    lp.paid_amount AS debit,
    (0)::numeric(14,2) AS credit,
    'old'::text AS source,
    (lp.sno)::bigint AS ref_id,
    lp.receipt_book
   FROM (legacy_payments lp
     LEFT JOIN legacy_accounts a ON ((a.id = lp.account_id)))
  WHERE ((lp.paid_date IS NOT NULL) AND ((a.id IS NULL) OR (lp.ledger = a.ledger)))
UNION ALL
 SELECT p.paid_date AS entry_date,
    1 AS kind_order,
    'receipt'::text AS kind,
    (COALESCE(a.borrower_name, b.full_name) || COALESCE((' '::text || COALESCE(a.registration_no, l.vehicle_no)), ''::text)) AS particulars,
    COALESCE((a.fno)::text, l.folio_no) AS folio,
    p.due_amount,
    p.due_date,
    p.delay_days,
        CASE
            WHEN (COALESCE(a.emi_amount, l.emi_amount) > (0)::numeric) THEN (GREATEST((1)::numeric, round((p.paid_amount / COALESCE(a.emi_amount, l.emi_amount)))))::integer
            ELSE NULL::integer
        END AS im,
        CASE
            WHEN (p.payment_mode = 'SPLIT'::text) THEN ( SELECT string_agg((t.x ->> 'mode'::text), '+'::text ORDER BY t.o) AS string_agg
               FROM jsonb_array_elements(p.parts) WITH ORDINALITY t(x, o))
            ELSE p.payment_mode
        END AS mode,
    p.receipt_no,
    p.paid_amount AS debit,
    0 AS credit,
        CASE
            WHEN (p.loan_id IS NULL) THEN 'old'::text
            ELSE 'new'::text
        END AS source,
    COALESCE((a.sno)::bigint, l.id) AS ref_id,
    p.receipt_book
   FROM (((payments p
     LEFT JOIN legacy_accounts a ON ((a.id = p.legacy_account_id)))
     LEFT JOIN loans l ON ((l.id = p.loan_id)))
     LEFT JOIN borrowers b ON ((b.id = l.borrower_id)))
UNION ALL
 SELECT a.agreement_date AS entry_date,
    2 AS kind_order,
    'loan'::text AS kind,
    (a.borrower_name || COALESCE((' '::text || a.registration_no), ''::text)) AS particulars,
    (a.fno)::text AS folio,
    NULL::numeric AS due_amount,
    NULL::date AS due_date,
    NULL::integer AS delay_days,
    NULL::integer AS im,
    COALESCE(a.finance_mode, 'CASH'::text) AS mode,
    NULL::bigint AS receipt_no,
    0 AS debit,
    a.finance_amount AS credit,
    'old'::text AS source,
    (a.sno)::bigint AS ref_id,
    NULL::text AS receipt_book
   FROM legacy_accounts a
  WHERE ((a.agreement_date IS NOT NULL) AND (a.finance_amount > (0)::numeric))
UNION ALL
 SELECT l.agreement_date AS entry_date,
    2 AS kind_order,
    'loan'::text AS kind,
    (b.full_name || COALESCE((' '::text || l.vehicle_no), ''::text)) AS particulars,
    l.folio_no AS folio,
    NULL::numeric AS due_amount,
    NULL::date AS due_date,
    NULL::integer AS delay_days,
    NULL::integer AS im,
    l.loan_type AS mode,
    NULL::bigint AS receipt_no,
    0 AS debit,
    l.finance_amount AS credit,
    'new'::text AS source,
    l.id AS ref_id,
    NULL::text AS receipt_book
   FROM (loans l
     JOIN borrowers b ON ((b.id = l.borrower_id)));;

-- ===== VIEW public.seized_accounts
create view public.seized_accounts as
 SELECT 'old'::text AS source,
    (a.sno)::bigint AS ref_id,
        CASE
            WHEN (NULLIF(a.fcode, ''::text) IS NOT NULL) THEN ((a.fcode || '-'::text) || a.fno)
            ELSE (a.fno)::text
        END AS folio,
        CASE
            WHEN s.settled THEN 'closed'::text
            ELSE a.ledger
        END AS ledger,
    a.borrower_name,
    NULLIF(concat_ws(', '::text, a.borrower_mobile, a.borrower_mobile2), ''::text) AS mobile,
    a.vehicle_model,
    a.registration_no AS vehicle_no,
    s.total_amount,
    s.total_paid,
    s.balance,
    ev.action_date AS seized_on,
    ev.remarks,
    (ev.id IS NULL) AS from_old_software,
    lower(concat_ws(' '::text, a.search_text, a.chassis_no, a.engine_no)) AS search_text
   FROM ((legacy_accounts a
     JOIN legacy_account_summary s ON ((s.id = a.id)))
     LEFT JOIN LATERAL ( SELECT e.id,
            e.action_date,
            e.remarks
           FROM seizures e
          WHERE ((e.legacy_account_id = a.id) AND (e.action = 'seize'::text))
          ORDER BY e.created_at DESC, e.id DESC
         LIMIT 1) ev ON (true))
  WHERE s.seized
UNION ALL
 SELECT 'new'::text AS source,
    l.id AS ref_id,
    l.folio_no AS folio,
    'pending'::text AS ledger,
    b.full_name AS borrower_name,
    b.mobile,
    l.vehicle_model,
    l.vehicle_no,
    l.total_amount,
    (COALESCE(pp.paid, (0)::numeric))::numeric(14,2) AS total_paid,
    (((l.total_amount + adj_total(NULL::bigint, l.id)) - COALESCE(pp.paid, (0)::numeric)))::numeric(14,2) AS balance,
    ev.action_date AS seized_on,
    ev.remarks,
    false AS from_old_software,
    lower(concat_ws(' '::text, l.folio_no, b.full_name, b.father_name, b.mobile, l.vehicle_no, l.chassis_no, l.engine_no)) AS search_text
   FROM (((loans l
     JOIN borrowers b ON ((b.id = l.borrower_id)))
     LEFT JOIN LATERAL ( SELECT sum(p.paid_amount) AS paid
           FROM payments p
          WHERE (p.loan_id = l.id)) pp ON (true))
     LEFT JOIN LATERAL ( SELECT e.action_date,
            e.remarks
           FROM seizures e
          WHERE ((e.loan_id = l.id) AND (e.action = 'seize'::text))
          ORDER BY e.created_at DESC, e.id DESC
         LIMIT 1) ev ON (true))
  WHERE (l.status = 'seized'::text);;

-- ===== VIEW public.legacy_account_summary
create view public.legacy_account_summary as
 SELECT a.id,
    a.ledger,
    a.sno,
    a.fno,
    a.borrower_name,
    a.borrower_father,
    a.borrower_mobile,
    a.registration_no,
    a.vehicle_model,
    a.agreement_date,
    a.tenure_months,
    a.finance_amount,
    a.interest_amount,
    a.total_amount,
    a.emi_amount,
    legacy_is_seized(a.id, a.seized) AS seized,
    a.data_flags,
    a.search_text,
    (a.legacy_payments_count + COALESCE(n.payments_count, (0)::bigint)) AS payments_count,
    ((a.legacy_paid + COALESCE(n.total_paid, (0)::numeric)))::numeric(14,2) AS total_paid,
    ((((a.total_amount + COALESCE(j.adj, (0)::numeric)) - a.legacy_paid) - COALESCE(n.total_paid, (0)::numeric)))::numeric(14,2) AS balance,
    GREATEST(a.legacy_last_paid, n.last_paid_date) AS last_paid_date,
    (COALESCE(j.adj, (0)::numeric))::numeric(14,2) AS adjustments,
    COALESCE(j.settled, false) AS settled
   FROM ((legacy_accounts a
     LEFT JOIN LATERAL ( SELECT count(*) AS payments_count,
            sum(np.paid_amount) AS total_paid,
            max(np.paid_date) AS last_paid_date
           FROM payments np
          WHERE (np.legacy_account_id = a.id)) n ON (true))
     LEFT JOIN LATERAL ( SELECT sum(x.amount) AS adj,
            bool_or((x.kind = 'settle'::text)) AS settled
           FROM adjustments x
          WHERE ((x.legacy_account_id = a.id) AND (x.cancelled_at IS NULL))) j ON (true));;

-- ===== VIEW public.all_accounts
create view public.all_accounts as
 SELECT 'old'::text AS source,
    (s.sno)::bigint AS ref_id,
    (s.fno)::text AS folio,
        CASE
            WHEN s.settled THEN 'closed'::text
            ELSE s.ledger
        END AS ledger,
    s.borrower_name,
    s.borrower_father,
    s.borrower_mobile,
    s.registration_no,
    s.vehicle_model,
    s.tenure_months,
    s.payments_count,
    s.seized,
    s.total_amount,
    s.emi_amount,
    s.total_paid,
    s.balance,
    s.search_text,
    (s.sno)::bigint AS sort_key
   FROM legacy_account_summary s
UNION ALL
 SELECT 'new'::text AS source,
    l.id AS ref_id,
    l.folio_no AS folio,
        CASE
            WHEN (l.status = 'closed'::text) THEN 'closed'::text
            ELSE 'pending'::text
        END AS ledger,
    b.full_name AS borrower_name,
    b.father_name AS borrower_father,
    b.mobile AS borrower_mobile,
    l.vehicle_no AS registration_no,
    l.vehicle_model,
    l.installments AS tenure_months,
    COALESCE(np.cnt, (0)::bigint) AS payments_count,
    (l.status = 'seized'::text) AS seized,
    l.total_amount,
    l.emi_amount,
    (COALESCE(np.paid, (0)::numeric))::numeric(14,2) AS total_paid,
    (((l.total_amount + adj_total(NULL::bigint, l.id)) - COALESCE(np.paid, (0)::numeric)))::numeric(14,2) AS balance,
    lower(((((((((l.folio_no || ' '::text) || b.full_name) || ' '::text) || COALESCE(b.mobile, ''::text)) || ' '::text) || COALESCE(l.vehicle_no, ''::text)) || ' '::text) || COALESCE(b.father_name, ''::text))) AS search_text,
    (1000000000 + l.id) AS sort_key
   FROM ((loans l
     JOIN borrowers b ON ((b.id = l.borrower_id)))
     LEFT JOIN LATERAL ( SELECT count(*) AS cnt,
            sum(p.paid_amount) AS paid
           FROM payments p
          WHERE (p.loan_id = l.id)) np ON (true));;

-- ===== VIEW public.pending_borrowers
create view public.pending_borrowers as
 SELECT 'old'::text AS source,
    (a.sno)::bigint AS ref_id,
    (a.fno)::text AS folio,
    a.borrower_name,
    a.borrower_mobile,
    a.search_text,
    (a.sno)::bigint AS sort_key
   FROM legacy_accounts a
  WHERE ((a.ledger = 'pending'::text) AND (NOT legacy_settled(a.id)))
UNION ALL
 SELECT 'new'::text AS source,
    l.id AS ref_id,
    l.folio_no AS folio,
    b.full_name AS borrower_name,
    b.mobile AS borrower_mobile,
    lower(((((((l.folio_no || ' '::text) || b.full_name) || ' '::text) || COALESCE(b.mobile, ''::text)) || ' '::text) || COALESCE(l.vehicle_no, ''::text))) AS search_text,
    (1000000000 + l.id) AS sort_key
   FROM (loans l
     JOIN borrowers b ON ((b.id = l.borrower_id)))
  WHERE (l.status = ANY (ARRAY['active'::text, 'seized'::text]));;

