-- Payments taken in the new system, for both old (legacy, pending) accounts and new loans.
-- Legacy payment rows stay untouched; totals add the two together.

create table public.payments (
  id                 bigint generated always as identity primary key,
  legacy_account_id  bigint references public.legacy_accounts (id),
  loan_id            bigint references public.loans (id),
  installment_no     integer not null check (installment_no > 0),
  due_date           date,
  due_amount         numeric(14,2),
  paid_amount        numeric(14,2) not null check (paid_amount > 0),
  paid_date          date not null,
  payment_mode       text not null check (payment_mode in ('CASH', 'BOB', 'SBI', 'SSS')),
  reference_no       text check (length(reference_no) <= 30),            -- cheque / UTR
  receipt_no         bigint not null unique check (receipt_no > 0),       -- from the paper receipt book
  balance_after      numeric(14,2) not null,
  delay_days         integer,
  idempotency_key    uuid not null unique,
  created_at         timestamptz not null default now(),
  created_by         uuid not null default auth.uid() references auth.users (id),
  check ((legacy_account_id is null) <> (loan_id is null)),
  unique (legacy_account_id, installment_no),
  unique (loan_id, installment_no)
);
create index payments_legacy_idx on public.payments (legacy_account_id) where legacy_account_id is not null;
create index payments_loan_idx   on public.payments (loan_id) where loan_id is not null;

alter table public.payments enable row level security;
create policy "staff read payments"   on public.payments for select to authenticated using ((select public.is_staff()));
create policy "staff create payments" on public.payments for insert to authenticated with check ((select public.is_staff()) and created_by = (select auth.uid()));
revoke all on public.payments from anon;
revoke update, delete, truncate on public.payments from authenticated;
grant select, insert on public.payments to authenticated;

-- ---------------------------------------------------------------------------
-- Record one payment. p = { source: 'old'|'new', ref_id, paid_amount, paid_date, payment_mode,
--                           reference_no, receipt_no, idempotency_key }
--   old -> ref_id is the legacy SNO;  new -> ref_id is loans.id
-- Installment no., due date, balance and delay are calculated here, under a per-account lock,
-- so two people collecting at the same time can never produce the same installment or a wrong balance.
-- ---------------------------------------------------------------------------
create or replace function public.record_payment(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_key      uuid    := (p->>'idempotency_key')::uuid;
  v_source   text    := p->>'source';
  v_ref      bigint  := (p->>'ref_id')::bigint;
  v_amount   numeric := (p->>'paid_amount')::numeric;
  v_date     date    := (p->>'paid_date')::date;
  v_today    date    := (now() at time zone 'Asia/Kolkata')::date;
  v_acct     bigint;
  v_loan     bigint;
  v_total    numeric;
  v_emi      numeric;
  v_interval int;
  v_start    date;
  v_paid     numeric;
  v_next     int;
  v_anchor_no   int;
  v_anchor_date date;
  v_due      date;
  v_row      public.payments;
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_row from public.payments where idempotency_key = v_key;
  if found then
    return jsonb_build_object('id', v_row.id, 'receipt_no', v_row.receipt_no, 'installment_no', v_row.installment_no,
                              'balance_after', v_row.balance_after, 'replayed', true);
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'amount must be more than 0' using errcode = '22023';
  end if;
  if v_date is null or v_date > v_today then
    raise exception 'paid date cannot be in the future' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('payment:' || v_source || ':' || v_ref));

  if v_source = 'old' then
    select id, total_amount, emi_amount, greatest(coalesce(interval_months, 1), 1), agreement_date
      into v_acct, v_total, v_emi, v_interval, v_start
      from public.legacy_accounts where sno = v_ref and ledger = 'pending';
    if not found then raise exception 'account not found or not pending' using errcode = 'P0002'; end if;

    select coalesce(sum(paid_amount), 0) into v_paid from (
      select paid_amount from public.legacy_payments where account_id = v_acct and ledger = 'pending'
      union all
      select paid_amount from public.payments where legacy_account_id = v_acct) x;

    select coalesce(max(n), 0) into v_next from (
      select installment_no n from public.legacy_payments where account_id = v_acct and ledger = 'pending'
      union all
      select installment_no from public.payments where legacy_account_id = v_acct) x;

    select n, d into v_anchor_no, v_anchor_date from (
      select installment_no n, due_date d from public.legacy_payments where account_id = v_acct and ledger = 'pending' and due_date is not null
      union all
      select installment_no, due_date from public.payments where legacy_account_id = v_acct and due_date is not null) x
    order by n desc limit 1;

  elsif v_source = 'new' then
    select id, total_amount, emi_amount, interval_months, agreement_date
      into v_loan, v_total, v_emi, v_interval, v_start
      from public.loans where id = v_ref and status = 'active';
    if not found then raise exception 'loan not found or not active' using errcode = 'P0002'; end if;

    select coalesce(sum(paid_amount), 0), coalesce(max(installment_no), 0) into v_paid, v_next
      from public.payments where loan_id = v_loan;
    select installment_no, due_date into v_anchor_no, v_anchor_date
      from public.payments where loan_id = v_loan and due_date is not null order by installment_no desc limit 1;
  else
    raise exception 'bad source' using errcode = '22023';
  end if;

  v_next := v_next + 1;
  if v_anchor_date is not null then
    v_due := (v_anchor_date + make_interval(months => (v_next - v_anchor_no) * v_interval))::date;
  elsif v_start is not null then
    v_due := (v_start + make_interval(months => v_next * v_interval))::date;
  end if;

  insert into public.payments (legacy_account_id, loan_id, installment_no, due_date, due_amount, paid_amount, paid_date,
                               payment_mode, reference_no, receipt_no, balance_after, delay_days, idempotency_key)
  values (v_acct, v_loan, v_next, v_due, v_emi, v_amount, v_date,
          p->>'payment_mode', nullif(btrim(p->>'reference_no'), ''), (p->>'receipt_no')::bigint,
          v_total - v_paid - v_amount, v_date - v_due, v_key)
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'receipt_no', v_row.receipt_no, 'installment_no', v_row.installment_no,
                            'balance_after', v_row.balance_after, 'replayed', false);
exception
  when unique_violation then
    select * into v_row from public.payments where idempotency_key = v_key;
    if found then
      return jsonb_build_object('id', v_row.id, 'receipt_no', v_row.receipt_no, 'installment_no', v_row.installment_no,
                                'balance_after', v_row.balance_after, 'replayed', true);
    end if;
    raise;  -- receipt number already used
end;
$$;

revoke execute on function public.record_payment(jsonb) from anon, public;
grant execute on function public.record_payment(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Totals now include payments taken in the new system.
-- ---------------------------------------------------------------------------
create or replace view public.legacy_account_summary
with (security_invoker = true)
as
select
  a.id, a.ledger, a.sno, a.fno, a.borrower_name, a.borrower_father, a.borrower_mobile,
  a.registration_no, a.vehicle_model, a.agreement_date, a.tenure_months,
  a.finance_amount, a.interest_amount, a.total_amount, a.emi_amount, a.seized,
  a.data_flags, a.search_text,
  coalesce(p.payments_count, 0) + coalesce(n.payments_count, 0)                    as payments_count,
  (coalesce(p.total_paid, 0) + coalesce(n.total_paid, 0))::numeric(14,2)           as total_paid,
  (a.total_amount - coalesce(p.total_paid, 0) - coalesce(n.total_paid, 0))::numeric(14,2) as balance,
  greatest(p.last_paid_date, n.last_paid_date)                                     as last_paid_date
from public.legacy_accounts a
left join lateral (
  select count(*) as payments_count, sum(lp.paid_amount) as total_paid, max(lp.paid_date) as last_paid_date
  from public.legacy_payments lp
  where lp.account_id = a.id and lp.ledger = a.ledger
) p on true
left join lateral (
  select count(*) as payments_count, sum(np.paid_amount) as total_paid, max(np.paid_date) as last_paid_date
  from public.payments np
  where np.legacy_account_id = a.id
) n on true;

create or replace view public.all_accounts
with (security_invoker = true)
as
select
  'old'::text as source, s.sno::bigint as ref_id, s.fno::text as folio, s.ledger,
  s.borrower_name, s.borrower_father, s.borrower_mobile,
  s.registration_no, s.vehicle_model, s.tenure_months,
  s.payments_count, s.seized,
  s.total_amount, s.emi_amount, s.total_paid, s.balance,
  s.search_text, s.sno::bigint as sort_key
from public.legacy_account_summary s
union all
select
  'new'::text, l.id, l.folio_no,
  case when l.status = 'closed' then 'closed' else 'pending' end,
  b.full_name, b.father_name, b.mobile,
  l.vehicle_no, l.vehicle_model, l.installments,
  coalesce(np.cnt, 0), l.status = 'seized',
  l.total_amount, l.emi_amount, coalesce(np.paid, 0)::numeric(14,2), (l.total_amount - coalesce(np.paid, 0))::numeric(14,2),
  lower(l.folio_no || ' ' || b.full_name || ' ' || coalesce(b.mobile, '') || ' ' ||
        coalesce(l.vehicle_no, '') || ' ' || coalesce(b.father_name, '')),
  1000000000 + l.id
from public.loans l
join public.borrowers b on b.id = l.borrower_id
left join lateral (select count(*) as cnt, sum(paid_amount) as paid from public.payments p where p.loan_id = l.id) np on true;

-- Light list for the Collect Payment screen: only what the list shows + what search needs.
create view public.pending_borrowers
with (security_invoker = true)
as
select 'old'::text as source, a.sno::bigint as ref_id, a.fno::text as folio, a.borrower_name, a.borrower_mobile,
       a.search_text, a.sno::bigint as sort_key
from public.legacy_accounts a
where a.ledger = 'pending'
union all
select 'new', l.id, l.folio_no, b.full_name, b.mobile,
       lower(l.folio_no || ' ' || b.full_name || ' ' || coalesce(b.mobile, '') || ' ' || coalesce(l.vehicle_no, '')),
       1000000000 + l.id
from public.loans l
join public.borrowers b on b.id = l.borrower_id
where l.status = 'active';

revoke all on public.pending_borrowers from anon;
grant select on public.pending_borrowers to authenticated;
