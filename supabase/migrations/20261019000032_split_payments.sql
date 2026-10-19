-- Split payments: one receipt paid partly in cash and partly online (cheque / SBI / bank).
-- Stored as ONE payment (one receipt no., EMIs counted once) with payment_mode = 'SPLIT' and
-- parts = [{mode, amount, bank_name, reference_no}, ...] (2 to 4 parts, adding up to the amount).
-- Daily cash counts only the cash part; messages and screens show "CASH ₹3,000 + BANK ₹1,747".

alter table public.payments add column if not exists parts jsonb;
alter table public.pending_payments add column if not exists parts jsonb;

alter table public.payments drop constraint payments_payment_mode_check;
alter table public.payments add constraint payments_payment_mode_check check (payment_mode in ('CASH', 'CHEQUE', 'SBI', 'BANK', 'SPLIT'));
alter table public.payments add constraint payments_split_parts check
  (payment_mode <> 'SPLIT' or (jsonb_typeof(parts) = 'array' and jsonb_array_length(parts) between 2 and 4));
alter table public.pending_payments drop constraint pending_payments_payment_mode_check;
alter table public.pending_payments add constraint pending_payments_payment_mode_check check (payment_mode in ('CASH', 'CHEQUE', 'SBI', 'BANK', 'SPLIT'));
alter table public.pending_payments add constraint pending_payments_split_parts check
  (payment_mode <> 'SPLIT' or (jsonb_typeof(parts) = 'array' and jsonb_array_length(parts) between 2 and 4));

-- ---------------------------------------------------------------- helpers
-- amount paid in one mode (CASH / CHEQUE / SBI / BANK) by a payment, split or not
create or replace function public.mode_part(p_mode text, p_amount numeric, p_parts jsonb, p_want text)
returns numeric language sql immutable set search_path = '' as $$
  select case when p_mode = 'SPLIT'
              then coalesce((select sum((x ->> 'amount')::numeric) from jsonb_array_elements(p_parts) x where x ->> 'mode' = p_want), 0)
              when p_mode = p_want then p_amount else 0 end;
$$;
-- "CASH ₹3,000 + BANK SBI ₹1,747" / "BANK SBI" / "CASH"
create or replace function public.payment_mode_text(p_mode text, p_bank text, p_parts jsonb)
returns text language sql immutable set search_path = '' as $$
  select case when p_mode = 'SPLIT'
              then (select string_agg((x ->> 'mode') || coalesce(' ' || nullif(x ->> 'bank_name', ''), '') || ' ' || app_private.inr((x ->> 'amount')::numeric), ' + ' order by o)
                      from jsonb_array_elements(p_parts) with ordinality t(x, o))
              else p_mode || coalesce(' ' || nullif(p_bank, ''), '') end;
$$;
grant execute on function public.mode_part(text, numeric, jsonb, text), public.payment_mode_text(text, text, jsonb) to authenticated;
-- payment_mode_text uses app_private.inr: give the owner-run function a public twin of it
alter function public.payment_mode_text(text, text, jsonb) security definer;

-- validate split parts -> normalized jsonb (raises on anything wrong)
create or replace function app_private.check_parts(p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
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
$$;

-- ---------------------------------------------------------------- posting keeps the parts
do $$
declare d text;
begin
  d := pg_get_functiondef('app_private.post_payment(jsonb,uuid,timestamp with time zone)'::regprocedure);
  if position('installments_covered, idempotency_key, created_by, created_at)' in d) = 0 then raise exception 'post_payment marker not found'; end if;
  d := replace(d, 'installments_covered, idempotency_key, created_by, created_at)', 'installments_covered, idempotency_key, created_by, created_at, parts)');
  d := replace(d, 'p_by, p_at)', 'p_by, p_at, case when p ->> ''payment_mode'' = ''SPLIT'' then p -> ''parts'' end)');
  execute d;
end $$;

-- record_payment: a SPLIT payment's amount is the sum of its parts
do $$
declare d text;
begin
  d := pg_get_functiondef('public.record_payment(jsonb)'::regprocedure);
  if position('if v_amount is null or v_amount <= 0 then raise exception' in d) = 0 then raise exception 'record_payment marker 1 not found'; end if;
  -- check / normalise the parts first, and use their sum
  d := replace(d, 'if v_amount is null or v_amount <= 0 then raise exception',
    'if p->>''payment_mode'' = ''SPLIT'' then
    p := jsonb_set(p, ''{parts}'', app_private.check_parts(p->''parts''));
    if v_amount is not null and round(v_amount, 2) <> (select sum((x->>''amount'')::numeric) from jsonb_array_elements(p->''parts'') x) then
      raise exception ''the parts must add up to the amount'' using errcode = ''22023'';
    end if;
    v_amount := (select sum((x->>''amount'')::numeric) from jsonb_array_elements(p->''parts'') x);
    p := jsonb_set(p, ''{paid_amount}'', to_jsonb(v_amount)) - ''reference_no'' - ''bank_name'';
  elsif p->>''payment_mode'' not in (''CASH'', ''CHEQUE'', ''SBI'', ''BANK'') or p->>''payment_mode'' is null then
    raise exception ''choose payment mode'' using errcode = ''22023'';
  end if;
  if v_amount is null or v_amount <= 0 then raise exception');
  -- waiting payments keep the parts too
  if position('installments_covered, idempotency_key, note)' in d) = 0 then raise exception 'record_payment marker 2 not found'; end if;
  d := replace(d, 'installments_covered, idempotency_key, note)', 'installments_covered, idempotency_key, note, parts)');
  d := replace(d, 'v_rno, v_im, v_key, v_note)', 'v_rno, v_im, v_key, v_note, case when p->>''payment_mode'' = ''SPLIT'' then p->''parts'' end)');
  execute d;
end $$;

-- approval passes the parts on
do $$
declare d text;
begin
  d := pg_get_functiondef('public.review_pending(bigint[],boolean,text)'::regprocedure);
  if position('''idempotency_key'', r.idempotency_key)' in d) = 0 then raise exception 'review_pending marker not found'; end if;
  execute replace(d, '''idempotency_key'', r.idempotency_key)', '''idempotency_key'', r.idempotency_key, ''parts'', r.parts)');
end $$;

-- editing a split payment: date / receipt / EMIs can change; to change the amounts cancel and enter again
do $$
declare d text; m1 text := 'if v_mode is null or v_mode not in (''CASH'', ''CHEQUE'', ''SBI'', ''BANK'') then';
        m2 text := 'receipt_no = v_rno, installments_covered = v_im';
begin
  d := pg_get_functiondef('public.admin_edit_payment(bigint,jsonb,text)'::regprocedure);
  if position(m1 in d) = 0 or position(m2 in d) = 0 then raise exception 'admin_edit_payment markers not found'; end if;
  d := replace(d, m1, 'if v_mode = ''SPLIT'' and (o.payment_mode <> ''SPLIT'' or v_amount <> o.paid_amount) then
    raise exception ''to change a split payment''''s amount, cancel it and enter it again'' using errcode = ''22023'';
  end if;
  if v_mode is null or v_mode not in (''CASH'', ''CHEQUE'', ''SBI'', ''BANK'', ''SPLIT'') then');
  d := replace(d, m2, m2 || ', parts = case when v_mode = ''SPLIT'' then parts end');
  execute d;
end $$;

-- ---------------------------------------------------------------- cash count: only the cash part is cash
create or replace function public.cash_day(p_day date)
returns table (user_id uuid, full_name text, receipts int, cash numeric, cheque numeric, sbi numeric, bank numeric, total numeric,
               closed boolean, received_amount numeric, expected_at_close numeric, note text, received_by text, received_at timestamptz,
               pending_count int, pending_amount numeric)
language sql stable security definer set search_path = '' as $$
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
$$;

do $$
declare d text; m text := 'select count(*), coalesce(sum(amt) filter (where mode = ''CASH''), 0), coalesce(sum(amt) filter (where mode <> ''CASH''), 0)';
begin
  d := pg_get_functiondef('public.cash_receive(uuid,date,numeric,text)'::regprocedure);
  if position(m in d) = 0 then raise exception 'cash_receive marker not found'; end if;
  d := replace(d, m, 'select count(*), coalesce(sum(public.mode_part(mode, amt, parts, ''CASH'')), 0), coalesce(sum(amt - public.mode_part(mode, amt, parts, ''CASH'')), 0)');
  d := replace(d, 'select paid_amount amt, payment_mode mode from public.payments', 'select paid_amount amt, payment_mode mode, parts from public.payments');
  d := replace(d, 'select paid_amount, payment_mode from public.pending_payments', 'select paid_amount, payment_mode, parts from public.pending_payments');
  execute d;
end $$;

do $$
declare d text; m text := 'sum(paid_amount) filter (where payment_mode = ''CASH'') cash';
begin
  d := pg_get_functiondef('public.staff_performance(date,date)'::regprocedure);
  if position(m in d) = 0 then raise exception 'staff_performance marker not found'; end if;
  d := replace(d, m, 'sum(public.mode_part(payment_mode, paid_amount, parts, ''CASH'')) cash');
  d := replace(d, 'and payment_mode = ''CASH''', 'and public.mode_part(payment_mode, paid_amount, parts, ''CASH'') > 0');
  execute d;
end $$;

-- dashboard alert "cash not handed in" also sees the cash part of split payments
do $$
declare d text; m text := 'and p.payment_mode = ''CASH''';
begin
  d := pg_get_functiondef('public.dashboard(date)'::regprocedure);
  if position(m in d) = 0 then raise exception 'dashboard marker not found'; end if;
  execute replace(d, m, 'and public.mode_part(p.payment_mode, p.paid_amount, p.parts, ''CASH'') > 0');
end $$;

-- ---------------------------------------------------------------- messages show the split
do $$
declare d text; m text := 'new.payment_mode || coalesce('' '' || new.bank_name, '''')';
begin
  d := pg_get_functiondef('app_private.on_payment()'::regprocedure);
  if position(m in d) = 0 then raise exception 'on_payment marker not found'; end if;
  execute replace(d, m, 'public.payment_mode_text(new.payment_mode, new.bank_name, new.parts)');
end $$;

do $$
declare d text; m text := '(select payment_mode, sum(paid_amount) t from public.payments where paid_date = p_day group by 1)';
begin
  d := pg_get_functiondef('app_private.daily_summary(date,text)'::regprocedure);
  if position(m in d) = 0 then raise exception 'daily_summary marker not found'; end if;
  execute replace(d, m, '(select m.mode as payment_mode, sum(public.mode_part(pm.payment_mode, pm.paid_amount, pm.parts, m.mode)) t
                           from public.payments pm cross join (values (''CASH''), (''CHEQUE''), (''SBI''), (''BANK'')) m(mode)
                          where pm.paid_date = p_day group by 1 having sum(public.mode_part(pm.payment_mode, pm.paid_amount, pm.parts, m.mode)) > 0)');
end $$;

-- Day Book: a split receipt shows "CASH+BANK" as its mode
create or replace view public.day_book_entries
with (security_invoker = true)
as
select lp.paid_date                                  as entry_date,
       1                                             as kind_order,
       'receipt'::text                               as kind,
       coalesce(a.borrower_name, 'UNKNOWN ACCOUNT')
         || coalesce(' ' || a.registration_no, '')   as particulars,
       a.fno::text                                   as folio,
       lp.due_amount, lp.due_date, lp.delay_days,
       case when a.emi_amount > 0 then greatest(1, round(lp.paid_amount / a.emi_amount))::int end as im,
       coalesce(lp.payment_mode, 'CASH')             as mode,
       lp.receipt_no::bigint                         as receipt_no,
       lp.paid_amount                                as debit,
       0::numeric(14,2)                              as credit,
       'old'::text                                   as source,
       lp.sno::bigint                                as ref_id
from public.legacy_payments lp
left join public.legacy_accounts a on a.id = lp.account_id
where lp.paid_date is not null and (a.id is null or lp.ledger = a.ledger)
union all
select p.paid_date, 1, 'receipt',
       coalesce(a.borrower_name, b.full_name) || coalesce(' ' || coalesce(a.registration_no, l.vehicle_no), ''),
       coalesce(a.fno::text, l.folio_no),
       p.due_amount, p.due_date, p.delay_days,
       case when coalesce(a.emi_amount, l.emi_amount) > 0 then greatest(1, round(p.paid_amount / coalesce(a.emi_amount, l.emi_amount)))::int end,
       case when p.payment_mode = 'SPLIT' then (select string_agg(x ->> 'mode', '+' order by o) from jsonb_array_elements(p.parts) with ordinality t(x, o))
            else p.payment_mode end,
       p.receipt_no, p.paid_amount, 0,
       case when p.loan_id is null then 'old' else 'new' end,
       coalesce(a.sno::bigint, l.id)
from public.payments p
left join public.legacy_accounts a on a.id = p.legacy_account_id
left join public.loans l on l.id = p.loan_id
left join public.borrowers b on b.id = l.borrower_id
union all
select a.agreement_date, 2, 'loan',
       a.borrower_name || coalesce(' ' || a.registration_no, ''),
       a.fno::text, null, null, null, null,
       coalesce(a.finance_mode, 'CASH'), null, 0, a.finance_amount, 'old', a.sno::bigint
from public.legacy_accounts a
where a.agreement_date is not null and a.finance_amount > 0
union all
select l.agreement_date, 2, 'loan',
       b.full_name || coalesce(' ' || l.vehicle_no, ''),
       l.folio_no, null, null, null, null,
       l.loan_type, null, 0, l.finance_amount, 'new', l.id
from public.loans l
join public.borrowers b on b.id = l.borrower_id;

-- Approvals list shows the parts
drop function if exists public.pending_approvals();
create or replace function public.pending_approvals()
returns table (id bigint, user_id uuid, subject text, source text, ref_id bigint, paid_amount numeric, paid_date date, receipt_no bigint,
               payment_mode text, reason text, by_name text, created_at timestamptz, cash_part numeric)
language sql stable security definer set search_path = '' as $$
  select p.id, p.created_by,
         case when p.source = 'old' then (select 'SNO ' || a.sno || ' · ' || a.borrower_name from public.legacy_accounts a where a.sno = p.ref_id)
              else (select 'Folio ' || l.folio_no || ' · ' || b.full_name from public.loans l join public.borrowers b on b.id = l.borrower_id where l.id = p.ref_id) end,
         p.source, p.ref_id, p.paid_amount, p.paid_date, p.receipt_no,
         public.payment_mode_text(p.payment_mode, p.bank_name, p.parts), p.note, app_private.staff_name(p.created_by), p.created_at,
         public.mode_part(p.payment_mode, p.paid_amount, p.parts, 'CASH')
    from public.pending_payments p
   where public.has_perm('approve')
   order by p.created_by, p.created_at;
$$;

revoke execute on all functions in schema app_private from public, anon, authenticated;
revoke execute on function public.pending_approvals() from anon, public;
grant execute on function public.pending_approvals() to authenticated;
