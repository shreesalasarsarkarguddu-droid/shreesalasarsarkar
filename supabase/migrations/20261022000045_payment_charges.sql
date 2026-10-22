-- Charges collected with an EMI payment, on the same receipt: OD (delay), seize charge and other (with a note).
--  * paid_amount stays the EMI part: only it lowers the loan balance (balances, EMIs, due report unchanged).
--  * charges = od_amount + seize_amount + other_amount is extra income; money received = paid_amount + charges
--    (Day Book, cash count, daily summary, staff report, approvals). A SPLIT payment's parts add up to that total.
--  * OD = days since the oldest unpaid EMI's due date × app_settings.od_per_day (₹10). Only the admin may change it.

-- ---------------------------------------------------------------- columns
alter table public.app_settings add column od_per_day numeric(10,2) not null default 10 check (od_per_day >= 0);

do $$
declare t text;
begin
  foreach t in array array['payments', 'pending_payments'] loop
    execute format($f$
      alter table public.%I
        add column od_amount    numeric(14,2) not null default 0 check (od_amount >= 0),
        add column od_days      integer not null default 0 check (od_days >= 0),
        add column seize_amount numeric(14,2) not null default 0 check (seize_amount >= 0),
        add column other_amount numeric(14,2) not null default 0 check (other_amount >= 0),
        add column other_note   text check (length(other_note) <= 100),
        add column charges      numeric(14,2) not null default 0,
        add constraint %I check (charges = od_amount + seize_amount + other_amount),
        add constraint %I check (other_amount = 0 or nullif(btrim(other_note), '') is not null)
    $f$, t, t || '_charges_sum', t || '_other_note');
  end loop;
end $$;

-- ---------------------------------------------------------------- OD helpers
-- The due date of the oldest unpaid EMI (the next payment's due date, as app_private.post_payment works it out);
-- null when the account is not open or nothing is left to pay.
create or replace function app_private.od_from(p_source text, p_ref bigint)
returns date language plpgsql stable security definer set search_path = '' as $$
declare
  v_acct bigint; v_loan bigint; v_total numeric; v_emi numeric; v_interval int; v_start date;
  v_paid numeric; v_used int; v_last_due date; v_last_im int;
begin
  if p_source = 'old' then
    select id, total_amount, emi_amount, greatest(coalesce(interval_months, 1), 1), agreement_date
      into v_acct, v_total, v_emi, v_interval, v_start
      from public.legacy_accounts where sno = p_ref and ledger = 'pending';
    if not found or public.legacy_settled(v_acct) then return null; end if;
    select coalesce(sum(amt), 0), coalesce(sum(im), 0) into v_paid, v_used from (
      select paid_amount amt, case when v_emi > 0 then greatest(1, round(paid_amount / v_emi))::int else 1 end im
        from public.legacy_payments where account_id = v_acct and ledger = 'pending'
      union all
      select paid_amount, installments_covered from public.payments where legacy_account_id = v_acct) r;
    select d, im into v_last_due, v_last_im from (
      select installment_no n, due_date d, case when v_emi > 0 then greatest(1, round(paid_amount / v_emi))::int else 1 end im
        from public.legacy_payments where account_id = v_acct and ledger = 'pending'
      union all
      select installment_no, due_date, installments_covered from public.payments where legacy_account_id = v_acct) r
     where d is not null order by n desc limit 1;
  elsif p_source = 'new' then
    select id, total_amount, emi_amount, interval_months, agreement_date
      into v_loan, v_total, v_emi, v_interval, v_start
      from public.loans where id = p_ref and status in ('active', 'seized');
    if not found then return null; end if;
    select coalesce(sum(paid_amount), 0), coalesce(sum(installments_covered), 0) into v_paid, v_used
      from public.payments where loan_id = v_loan;
    select due_date, installments_covered into v_last_due, v_last_im
      from public.payments where loan_id = v_loan and due_date is not null order by installment_no desc limit 1;
  else
    return null;
  end if;
  if v_total + public.adj_total(v_acct, v_loan) - v_paid <= 0 then return null; end if;
  return app_private.next_due_date(v_acct, v_loan, v_interval, v_start, v_used, v_last_due, v_last_im,
                                   app_private.paid_since_reschedule(v_acct, v_loan));
end $$;
revoke all on function app_private.od_from(text, bigint) from public, anon, authenticated;

-- What the payment window needs for the charges: OD rate and start date, seizure date, admin or not.
create or replace function public.charge_info(p_source text, p_ref bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_seized boolean; v_on date; v_acct bigint;
begin
  if not (public.has_perm('collect') or public.has_perm('view_accounts')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_source = 'old' then
    select id, public.legacy_is_seized(id, seized) into v_acct, v_seized from public.legacy_accounts where sno = p_ref;
    select action_date into v_on from public.seizures where legacy_account_id = v_acct order by created_at desc, id desc limit 1;
  else
    select status = 'seized' into v_seized from public.loans where id = p_ref;
    select action_date into v_on from public.seizures where loan_id = p_ref order by created_at desc, id desc limit 1;
  end if;
  return jsonb_build_object(
    'od_rate', (select od_per_day from public.app_settings where id = 1),
    'od_from', app_private.od_from(p_source, p_ref),
    'seized', coalesce(v_seized, false),
    'seized_on', case when v_seized then v_on end,
    'admin', public.is_admin());
end $$;
revoke all on function public.charge_info(text, bigint) from public, anon;
grant execute on function public.charge_info(text, bigint) to authenticated;

-- ---------------------------------------------------------------- functions (patched in place, like 032 / 035)
do $$
declare d text; o text;
begin
  -- record_payment: work out the charges first; a SPLIT's parts cover EMI + charges
  d := pg_get_functiondef('public.record_payment(jsonb)'::regprocedure); o := d;
  d := replace(d, '  v_series bigint;
begin', '  v_series bigint;
  v_od     numeric := 0;
  v_odd    int     := 0;
  v_seize  numeric := coalesce(round((p->>''seize_amount'')::numeric, 2), 0);
  v_other  numeric := coalesce(round((p->>''other_amount'')::numeric, 2), 0);
  v_onote  text    := nullif(btrim(p->>''other_note''), '''');
  v_from   date;
  v_charges numeric;
begin');
  d := replace(d, '  if p->>''payment_mode'' = ''SPLIT'' then
    p := jsonb_set(p, ''{parts}'', app_private.check_parts(p->''parts''));',
'  -- charges: OD = days late × rate (only the admin may change it), seize and other as typed.
  -- OD only when the screen sends od_amount (older screens and other callers take no OD).
  v_from := app_private.od_from(v_source, v_ref);
  if v_from is not null and v_date is not null and v_date > v_from then v_odd := v_date - v_from; end if;
  if nullif(p->>''od_amount'', '''') is null then
    v_odd := 0;
  else
    v_od := v_odd * (select od_per_day from public.app_settings where id = 1);
    if round((p->>''od_amount'')::numeric, 2) <> v_od then
      if not public.is_admin() then raise exception ''only the admin can change the OD amount'' using errcode = ''22023''; end if;
      v_od := round((p->>''od_amount'')::numeric, 2);
    end if;
  end if;
  if v_od < 0 or v_seize < 0 or v_other < 0 then raise exception ''charges cannot be less than 0'' using errcode = ''22023''; end if;
  if v_other > 0 and v_onote is null then raise exception ''write what the other charge is for'' using errcode = ''22023''; end if;
  if length(v_onote) > 100 then raise exception ''the other charge note is too long'' using errcode = ''22023''; end if;
  v_charges := v_od + v_seize + v_other;
  p := p || jsonb_build_object(''od_amount'', v_od, ''od_days'', v_odd, ''seize_amount'', v_seize, ''other_amount'', v_other,
                               ''other_note'', case when v_other > 0 then v_onote end, ''charges'', v_charges);

  if p->>''payment_mode'' = ''SPLIT'' then
    p := jsonb_set(p, ''{parts}'', app_private.check_parts(p->''parts''));');
  d := replace(d, 'if v_amount is not null and round(v_amount, 2) <> (select sum((x->>''amount'')::numeric) from jsonb_array_elements(p->''parts'') x) then
      raise exception ''the parts must add up to the amount''',
                  'if v_amount is not null and round(v_amount + v_charges, 2) <> (select sum((x->>''amount'')::numeric) from jsonb_array_elements(p->''parts'') x) then
      raise exception ''the parts must add up to the EMI amount and the charges''');
  d := replace(d, 'v_amount := (select sum((x->>''amount'')::numeric) from jsonb_array_elements(p->''parts'') x);',
                  'v_amount := (select sum((x->>''amount'')::numeric) from jsonb_array_elements(p->''parts'') x) - v_charges;');
  d := replace(d, 'installments_covered, idempotency_key, note, parts, series_id)',
                  'installments_covered, idempotency_key, note, parts, series_id, od_amount, od_days, seize_amount, other_amount, other_note, charges)');
  d := replace(d, 'case when p->>''payment_mode'' = ''SPLIT'' then p->''parts'' end, v_series)',
                  'case when p->>''payment_mode'' = ''SPLIT'' then p->''parts'' end, v_series, v_od, v_odd, v_seize, v_other, case when v_other > 0 then v_onote end, v_charges)');
  if d = o or position('v_charges, 2) <>' in d) = 0 or position('- v_charges;' in d) = 0 or position('v_onote end, v_charges)' in d) = 0
     or position('od_amount, od_days, seize_amount, other_amount, other_note, charges)' in d) = 0 then
    raise exception 'record_payment: a marker was not found';
  end if;
  execute d;

  -- post_payment: store the charges
  d := pg_get_functiondef('app_private.post_payment(jsonb,uuid,timestamp with time zone)'::regprocedure); o := d;
  d := replace(d, 'installments_covered, idempotency_key, created_by, created_at, parts, series_id)',
                  'installments_covered, idempotency_key, created_by, created_at, parts, series_id,
                               od_amount, od_days, seize_amount, other_amount, other_note, charges)');
  d := replace(d, '(p ->> ''series_id'')::bigint)
  returning * into v_row;', '(p ->> ''series_id'')::bigint,
          coalesce((p ->> ''od_amount'')::numeric, 0), coalesce((p ->> ''od_days'')::int, 0), coalesce((p ->> ''seize_amount'')::numeric, 0),
          coalesce((p ->> ''other_amount'')::numeric, 0), nullif(btrim(p ->> ''other_note''), ''''),
          coalesce((p ->> ''od_amount'')::numeric, 0) + coalesce((p ->> ''seize_amount'')::numeric, 0) + coalesce((p ->> ''other_amount'')::numeric, 0))
  returning * into v_row;');
  if position('other_note, charges)' in d) = 0 or position('nullif(btrim(p ->> ''other_note''), '''')' in d) = 0 then
    raise exception 'post_payment: a marker was not found';
  end if;
  execute d;

  -- approving a waiting payment keeps its charges
  d := pg_get_functiondef('public.review_pending(bigint[],boolean,text)'::regprocedure); o := d;
  d := replace(d, '''parts'', r.parts, ''series_id'', r.series_id)',
                  '''parts'', r.parts, ''series_id'', r.series_id,
          ''od_amount'', r.od_amount, ''od_days'', r.od_days, ''seize_amount'', r.seize_amount, ''other_amount'', r.other_amount, ''other_note'', r.other_note)');
  d := replace(d, 'ok := ok + 1; amt := amt + r.paid_amount;', 'ok := ok + 1; amt := amt + r.paid_amount + r.charges;');
  if position('''other_note'', r.other_note)' in d) = 0 then raise exception 'review_pending: marker not found'; end if;
  execute d;

  -- admin edit keeps the charges: a SPLIT's parts cover EMI + charges
  d := pg_get_functiondef('public.admin_edit_payment(bigint,jsonb,text)'::regprocedure); o := d;
  d := replace(d, 'from jsonb_array_elements(v_parts) x) <> round(v_amount, 2) then
      raise exception ''the parts must add up to the amount''',
                  'from jsonb_array_elements(v_parts) x) <> round(v_amount + o.charges, 2) then
      raise exception ''the parts must add up to the EMI amount and the charges''');
  if d = o then raise exception 'admin_edit_payment: marker not found'; end if;
  execute d;

  -- money received = EMI part + charges
  d := pg_get_functiondef('public.cash_day(date)'::regprocedure); o := d;
  d := replace(d, 'select created_by, paid_amount, payment_mode, parts, false as waiting from public.payments',
                  'select created_by, paid_amount + charges as paid_amount, payment_mode, parts, false as waiting from public.payments');
  d := replace(d, 'select created_by, paid_amount, payment_mode, parts, true from public.pending_payments',
                  'select created_by, paid_amount + charges, payment_mode, parts, true from public.pending_payments');
  if position('paid_amount + charges, payment_mode, parts, true' in d) = 0 or position('paid_amount + charges as paid_amount' in d) = 0 then
    raise exception 'cash_day: marker not found';
  end if;
  execute d;

  d := pg_get_functiondef('public.cash_receive(uuid,date,numeric,text)'::regprocedure); o := d;
  d := replace(d, 'from (select paid_amount amt, payment_mode mode, parts from public.payments',
                  'from (select paid_amount + charges amt, payment_mode mode, parts from public.payments');
  d := replace(d, 'select paid_amount, payment_mode, parts from public.pending_payments',
                  'select paid_amount + charges, payment_mode, parts from public.pending_payments');
  if position('paid_amount + charges amt' in d) = 0 or position('select paid_amount + charges, payment_mode, parts from public.pending_payments' in d) = 0 then
    raise exception 'cash_receive: marker not found';
  end if;
  execute d;

  d := pg_get_functiondef('app_private.daily_summary(date,text)'::regprocedure); o := d;
  d := replace(d, 'coalesce(sum(paid_amount), 0) into v_cnt, v_sum from public.payments', 'coalesce(sum(paid_amount + charges), 0) into v_cnt, v_sum from public.payments');
  d := replace(d, 'public.mode_part(pm.payment_mode, pm.paid_amount, pm.parts, m.mode)', 'public.mode_part(pm.payment_mode, pm.paid_amount + pm.charges, pm.parts, m.mode)');
  if position('sum(paid_amount + charges)' in d) = 0 or position('pm.paid_amount + pm.charges' in d) = 0 then raise exception 'daily_summary: marker not found'; end if;
  execute d;

  d := pg_get_functiondef('public.staff_performance(date,date)'::regprocedure); o := d;
  d := replace(d, 'sum(paid_amount) amt, sum(public.mode_part(payment_mode, paid_amount, parts, ''CASH'')) cash',
                  'sum(paid_amount + charges) amt, sum(public.mode_part(payment_mode, paid_amount + charges, parts, ''CASH'')) cash');
  d := replace(d, 'public.mode_part(payment_mode, paid_amount, parts, ''CASH'') > 0', 'public.mode_part(payment_mode, paid_amount + charges, parts, ''CASH'') > 0');
  if position('sum(paid_amount + charges) amt' in d) = 0 then raise exception 'staff_performance: marker not found'; end if;
  execute d;

  d := pg_get_functiondef('public.dashboard(date)'::regprocedure); o := d;
  d := replace(d, 'public.mode_part(p.payment_mode, p.paid_amount, p.parts, ''CASH'') > 0', 'public.mode_part(p.payment_mode, p.paid_amount + p.charges, p.parts, ''CASH'') > 0');
  if d = o then raise exception 'dashboard: marker not found'; end if;
  execute d;

  d := pg_get_functiondef('public.pending_approvals()'::regprocedure); o := d;
  d := replace(d, 'p.source, p.ref_id, p.paid_amount, p.paid_date, p.receipt_no,', 'p.source, p.ref_id, p.paid_amount + p.charges, p.paid_date, p.receipt_no,');
  d := replace(d, 'public.mode_part(p.payment_mode, p.paid_amount, p.parts, ''CASH'')', 'public.mode_part(p.payment_mode, p.paid_amount + p.charges, p.parts, ''CASH'')');
  if position('p.ref_id, p.paid_amount + p.charges' in d) = 0 or position('p.paid_amount + p.charges, p.parts' in d) = 0 then raise exception 'pending_approvals: marker not found'; end if;
  execute d;

  -- Telegram / WhatsApp: the whole amount, and what the charges were
  d := pg_get_functiondef('app_private.on_payment()'::regprocedure); o := d;
  d := replace(d, 'app_private.inr(new.paid_amount) || '' · '' || public.payment_mode_text(',
                  'app_private.inr(new.paid_amount + new.charges) || '' · '' || public.payment_mode_text(');
  d := replace(d, '''Balance '' || app_private.inr(new.balance_after) || chr(10) ||
        ''By ''', 'case when new.charges > 0 then ''EMI '' || app_private.inr(new.paid_amount) ||
          case when new.od_amount > 0 then '' + OD '' || app_private.inr(new.od_amount) || '' ('' || new.od_days || '' days)'' else '''' end ||
          case when new.seize_amount > 0 then '' + Seize '' || app_private.inr(new.seize_amount) else '''' end ||
          case when new.other_amount > 0 then '' + '' || coalesce(new.other_note, ''Other'') || '' '' || app_private.inr(new.other_amount) else '''' end || chr(10)
          else '''' end ||
        ''Balance '' || app_private.inr(new.balance_after) || chr(10) ||
        ''By ''');
  d := replace(d, '''amount'', app_private.inr(new.paid_amount),', '''amount'', app_private.inr(new.paid_amount + new.charges),');
  if position('inr(new.paid_amount + new.charges) || '' · ''' in d) = 0 or position('+ OD' in d) = 0
     or position('''amount'', app_private.inr(new.paid_amount + new.charges)' in d) = 0 then
    raise exception 'on_payment: marker not found';
  end if;
  execute d;

  -- Settings: the OD rate
  d := pg_get_functiondef('public.save_notification_settings(jsonb)'::regprocedure); o := d;
  d := replace(d, '    restrict_to_assigned    = coalesce((p ->> ''restrict_to_assigned'')::boolean, restrict_to_assigned),',
                  '    restrict_to_assigned    = coalesce((p ->> ''restrict_to_assigned'')::boolean, restrict_to_assigned),
    od_per_day              = coalesce((p ->> ''od_per_day'')::numeric, od_per_day),');
  if d = o then raise exception 'save_notification_settings: marker not found'; end if;
  execute d;
end $$;

-- ---------------------------------------------------------------- Day Book: receipts count EMI + charges; emi / charges columns at the end
create or replace view public.day_book_entries with (security_invoker = true) as
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
    lp.receipt_book,
    (
        CASE
            WHEN (upper(btrim(COALESCE(lp.payment_mode, 'CASH'::text))) = 'CASH'::text) THEN lp.paid_amount
            ELSE (0)::numeric
        END)::numeric(14,2) AS cash,
    (
        CASE
            WHEN (upper(btrim(COALESCE(lp.payment_mode, 'CASH'::text))) = 'CASH'::text) THEN (0)::numeric
            ELSE lp.paid_amount
        END)::numeric(14,2) AS bank,
    lp.paid_amount AS emi,
    (0)::numeric AS od,
    (0)::numeric AS seize,
    (0)::numeric AS other,
    NULL::text AS other_note
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
    p.paid_amount + p.charges AS debit,
    0 AS credit,
        CASE
            WHEN (p.loan_id IS NULL) THEN 'old'::text
            ELSE 'new'::text
        END AS source,
    COALESCE((a.sno)::bigint, l.id) AS ref_id,
    p.receipt_book,
    mode_part(p.payment_mode, p.paid_amount + p.charges, p.parts, 'CASH'::text) AS cash,
    (p.paid_amount + p.charges - mode_part(p.payment_mode, p.paid_amount + p.charges, p.parts, 'CASH'::text)) AS bank,
    p.paid_amount AS emi,
    p.od_amount AS od,
    p.seize_amount AS seize,
    p.other_amount AS other,
    p.other_note
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
    NULL::text AS receipt_book,
        CASE
            WHEN (upper(btrim(COALESCE(a.finance_mode, 'CASH'::text))) = 'CASH'::text) THEN a.finance_amount
            ELSE (0)::numeric
        END AS cash,
        CASE
            WHEN (upper(btrim(COALESCE(a.finance_mode, 'CASH'::text))) = 'CASH'::text) THEN (0)::numeric
            ELSE a.finance_amount
        END AS bank,
    NULL::numeric AS emi,
    NULL::numeric AS od,
    NULL::numeric AS seize,
    NULL::numeric AS other,
    NULL::text AS other_note
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
    NULL::text AS receipt_book,
        CASE
            WHEN (upper(btrim(COALESCE(l.loan_type, 'CASH'::text))) = 'CASH'::text) THEN l.finance_amount
            ELSE (0)::numeric
        END AS cash,
        CASE
            WHEN (upper(btrim(COALESCE(l.loan_type, 'CASH'::text))) = 'CASH'::text) THEN (0)::numeric
            ELSE l.finance_amount
        END AS bank,
    NULL::numeric AS emi,
    NULL::numeric AS od,
    NULL::numeric AS seize,
    NULL::numeric AS other,
    NULL::text AS other_note
   FROM (loans l
     JOIN borrowers b ON ((b.id = l.borrower_id)));
