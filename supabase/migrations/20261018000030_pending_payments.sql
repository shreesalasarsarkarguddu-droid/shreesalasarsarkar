-- Payments by collection men wait for the night cash count.
--   * anyone WITHOUT "approve": the payment goes to pending_payments (does not count anywhere yet: balance,
--     reports, day book, dashboard all stay as they were); the receipt number is taken at once
--   * at night the admin (or anyone with "approve") counts the cash and approves: each pending payment then becomes
--     a real payment (who collected it and when are kept), and only then the WhatsApp receipt / Telegram message go out
--   * reject = removed (kept in the activity log)
-- Receipt numbers can never repeat: payments, pending payments and old-software receipts are all checked.

create table public.pending_payments (
  id                    bigint generated always as identity primary key,
  source                text not null check (source in ('old', 'new')),
  ref_id                bigint not null,                        -- SNO / loan id
  paid_amount           numeric(14,2) not null check (paid_amount > 0),
  paid_date             date not null,
  payment_mode          text not null check (payment_mode in ('CASH', 'CHEQUE', 'SBI', 'BANK')),
  reference_no          text check (length(reference_no) <= 30),
  bank_name             text check (length(bank_name) <= 60),
  receipt_no            bigint not null unique check (receipt_no > 0),
  installments_covered  int not null default 1 check (installments_covered between 1 and 360),
  idempotency_key       uuid not null unique,
  note                  text,
  created_by            uuid not null default auth.uid() references auth.users (id),
  created_at            timestamptz not null default now()
);
create index pending_payments_ref_idx on public.pending_payments (source, ref_id);
create index pending_payments_by_idx on public.pending_payments (created_by, created_at);
alter table public.pending_payments enable row level security;
-- everyone who can see accounts sees what is waiting (so nobody collects the same money twice)
create policy "read pending payments" on public.pending_payments for select to authenticated
  using ((select public.has_perm('view_accounts')) or created_by = (select auth.uid()));
revoke all on public.pending_payments from anon;
revoke insert, update, delete, truncate on public.pending_payments from authenticated;
grant select on public.pending_payments to authenticated;

-- ---------------------------------------------------------------- posting a payment (shared by direct entry and approval)
-- p = { source, ref_id, paid_amount, paid_date, payment_mode, reference_no, bank_name, receipt_no, installments_covered, idempotency_key }
create or replace function app_private.post_payment(p jsonb, p_by uuid, p_at timestamptz)
returns public.payments language plpgsql security definer set search_path = '' as $$
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
                               installments_covered, idempotency_key, created_by, created_at)
  values (v_acct, v_loan, v_next, v_due, v_emi, v_amount, v_date,
          p ->> 'payment_mode', nullif(btrim(p ->> 'reference_no'), ''), nullif(btrim(p ->> 'bank_name'), ''),
          (p ->> 'receipt_no')::bigint, v_total - v_paid - v_amount, v_date - v_due, v_im, (p ->> 'idempotency_key')::uuid,
          p_by, p_at)
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------- taking a payment
create or replace function public.record_payment(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
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

  if v_amount is null or v_amount <= 0 then raise exception 'amount must be more than 0' using errcode = '22023'; end if;
  if v_date is null or v_date > v_today then raise exception 'paid date cannot be in the future' using errcode = '22023'; end if;
  if v_im < 1 or v_im > 360 then raise exception 'EMIs covered must be 1 or more' using errcode = '22023'; end if;
  if v_rno is null or v_rno <= 0 then raise exception 'enter the receipt number' using errcode = '22023'; end if;
  if v_source not in ('old', 'new') then raise exception 'bad source' using errcode = '22023'; end if;

  -- receipt number: never twice (app payments, waiting payments, old software)
  perform pg_advisory_xact_lock(hashtext('receipt:' || v_rno));
  if exists (select 1 from public.payments where receipt_no = v_rno)
     or exists (select 1 from public.pending_payments where receipt_no = v_rno)
     or exists (select 1 from public.legacy_payments where receipt_no = v_rno) then
    raise exception 'receipt no. % is already used', v_rno using errcode = '23505';
  end if;

  -- receipt books
  select * into s from public.app_settings where id = 1;
  select * into v_book from public.receipt_books where closed_at is null and int8range(from_no, to_no, '[]') @> v_rno;
  if found and v_book.user_id <> auth.uid() then
    raise exception 'receipt no. % belongs to %''s receipt book', v_rno, app_private.staff_name(v_book.user_id) using errcode = '22023';
  elsif not found and exists (select 1 from public.receipt_books where user_id = auth.uid() and closed_at is null) then
    raise exception 'receipt no. % is not in your receipt book (%)', v_rno,
      (select string_agg(from_no || '–' || to_no, ', ' order by from_no) from public.receipt_books where user_id = auth.uid() and closed_at is null)
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
                                         installments_covered, idempotency_key, note)
    values (v_source, v_ref, v_amount, v_date, p->>'payment_mode', nullif(btrim(p->>'reference_no'), ''),
            nullif(btrim(p->>'bank_name'), ''), v_rno, v_im, v_key, v_note)
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
$$;
revoke execute on function public.record_payment(jsonb) from anon, public;
grant execute on function public.record_payment(jsonb) to authenticated;

-- ---------------------------------------------------------------- approve / reject (anyone with "approve")
create or replace function public.review_pending(p_ids bigint[], p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
          'receipt_no', r.receipt_no, 'installments_covered', r.installments_covered, 'idempotency_key', r.idempotency_key),
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
$$;

drop function if exists public.pending_approvals();
create or replace function public.pending_approvals()
returns table (id bigint, user_id uuid, subject text, source text, ref_id bigint, paid_amount numeric, paid_date date, receipt_no bigint,
               payment_mode text, reason text, by_name text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.created_by,
         case when p.source = 'old' then (select 'SNO ' || a.sno || ' · ' || a.borrower_name from public.legacy_accounts a where a.sno = p.ref_id)
              else (select 'Folio ' || l.folio_no || ' · ' || b.full_name from public.loans l join public.borrowers b on b.id = l.borrower_id where l.id = p.ref_id) end,
         p.source, p.ref_id, p.paid_amount, p.paid_date, p.receipt_no, p.payment_mode, p.note, app_private.staff_name(p.created_by), p.created_at
    from public.pending_payments p
   where public.has_perm('approve')
   order by p.created_by, p.created_at;
$$;

-- ---------------------------------------------------------------- receipt number hint for the payment window
create or replace function public.receipt_hint()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'last_app', (select max(n) from (select max(receipt_no) n from public.payments union all select max(receipt_no) from public.pending_payments) x),
    'last_mine', (select max(n) from (select max(receipt_no) n from public.payments where created_by = auth.uid()
                                      union all select max(receipt_no) from public.pending_payments where created_by = auth.uid()) x),
    'last_old', (select max(receipt_no) from public.legacy_payments),
    'books', coalesce((select jsonb_agg(jsonb_build_object('from', b.from_no, 'to', b.to_no,
                 'next', (select min(n) from generate_series(b.from_no, b.to_no) n
                           where not exists (select 1 from public.payments where receipt_no = n)
                             and not exists (select 1 from public.pending_payments where receipt_no = n))) order by b.from_no)
               from public.receipt_books b where b.user_id = auth.uid() and b.closed_at is null), '[]'))
  where public.has_perm('collect');
$$;

-- ---------------------------------------------------------------- daily cash / collection lists include what is waiting
drop function if exists public.cash_day(date);
create or replace function public.cash_day(p_day date)
returns table (user_id uuid, full_name text, receipts int, cash numeric, cheque numeric, sbi numeric, bank numeric, total numeric,
               closed boolean, received_amount numeric, expected_at_close numeric, note text, received_by text, received_at timestamptz,
               pending_count int, pending_amount numeric)
language sql stable security definer set search_path = '' as $$
  with allp as (
    select created_by, paid_amount, payment_mode, false as waiting from public.payments
     where (created_at at time zone 'Asia/Kolkata')::date = p_day
    union all
    select created_by, paid_amount, payment_mode, true from public.pending_payments
     where (created_at at time zone 'Asia/Kolkata')::date = p_day
  ),
  pay as (
    select created_by as uid, count(*)::int as n,
           sum(paid_amount) filter (where payment_mode = 'CASH')   as cash,
           sum(paid_amount) filter (where payment_mode = 'CHEQUE') as cheque,
           sum(paid_amount) filter (where payment_mode = 'SBI')    as sbi,
           sum(paid_amount) filter (where payment_mode = 'BANK')   as bank,
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

create or replace function public.cash_receive(p_user uuid, p_day date, p_amount numeric, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_n int; v_cash numeric; v_other numeric; v_name text; v_short numeric;
begin
  if not public.has_perm('cash') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'enter the cash received' using errcode = '22023'; end if;
  if p_day > (now() at time zone 'Asia/Kolkata')::date then raise exception 'the day cannot be in the future' using errcode = '22023'; end if;
  select count(*), coalesce(sum(amt) filter (where mode = 'CASH'), 0), coalesce(sum(amt) filter (where mode <> 'CASH'), 0)
    into v_n, v_cash, v_other
    from (select paid_amount amt, payment_mode mode from public.payments
           where created_by = p_user and (created_at at time zone 'Asia/Kolkata')::date = p_day
          union all
          select paid_amount, payment_mode from public.pending_payments
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
    '💵 Cash handed in · ' || v_name || ' · ' || to_char(p_day, 'DD-MM-YYYY') || chr(10) ||
    'Collected in cash ' || app_private.inr(v_cash) || ' (' || v_n || ' receipts)' || chr(10) ||
    'Received ' || app_private.inr(p_amount) ||
    case when v_short > 0 then ' · SHORT ' || app_private.inr(v_short) when v_short < 0 then ' · extra ' || app_private.inr(-v_short) else ' · matches' end || chr(10) ||
    'By ' || app_private.staff_name(auth.uid()),
    'cash_received');
  return jsonb_build_object('short', v_short);
end;
$$;

-- collection list: "collected" = approved + waiting; "waiting" shown separately
drop function if exists public.collection_list(date, uuid);
create or replace function public.collection_list(p_day date, p_user uuid default null)
returns table (id bigint, user_id uuid, collector text, source text, ref_id bigint, folio text, borrower_name text, mobile text,
               address text, vehicle text, emi numeric, balance numeric, arrears numeric, overdue_emis integer, next_due date,
               seized boolean, closed boolean, collected numeric, receipts int, note text, waiting numeric)
language plpgsql security definer set search_path = '' as $$
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
$$;
alter function public.collection_list(date, uuid) set statement_timeout = '30s';

-- dashboard alert counts the waiting payments
do $$
declare d text;
begin
  d := pg_get_functiondef('public.dashboard(date)'::regprocedure);
  if position('(select count(*) from public.payments where review_reason is not null and reviewed_at is null)' in d) = 0 then
    raise exception 'dashboard marker not found';
  end if;
  execute replace(d, '(select count(*) from public.payments where review_reason is not null and reviewed_at is null)',
                     '(select count(*) from public.pending_payments)');
end $$;

-- editing a payment's receipt no. also checks waiting payments
do $$
declare d text; m text := 'if v_rno <> o.receipt_no and exists (select 1 from public.legacy_payments where receipt_no = v_rno) then';
begin
  d := pg_get_functiondef('public.admin_edit_payment(bigint,jsonb,text)'::regprocedure);
  if position(m in d) = 0 then raise exception 'edit_payment marker not found'; end if;
  execute replace(d, m, 'if v_rno <> o.receipt_no and exists (select 1 from public.pending_payments where receipt_no = v_rno) then
    raise exception ''receipt no. % is already used by a payment waiting for approval'', v_rno using errcode = ''22023'';
  end if;
  ' || m);
end $$;

-- restore points / backups
create or replace function app_private.data_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['import_batches','legacy_accounts','legacy_payments','borrowers','loans','payments','seizures','adjustments',
               'receipt_books','cash_closings','collection_assignments','pending_payments'];
$$;

revoke execute on all functions in schema app_private from public, anon, authenticated;
revoke execute on function public.review_pending(bigint[], boolean, text), public.pending_approvals(), public.receipt_hint(),
  public.cash_day(date), public.collection_list(date, uuid) from anon, public;
grant execute on function public.review_pending(bigint[], boolean, text), public.pending_approvals(), public.receipt_hint(),
  public.cash_day(date), public.collection_list(date, uuid) to authenticated;
