-- Seize / release vehicles, with a permanent history (who, when, why).
--  * Old accounts: the legacy SEZIED flag is the starting state; the latest event overrides it.
--  * New loans: loans.status becomes 'seized' / 'active'.
--  * Seized accounts can still take payments (settlement / sale).

create table public.seizures (
  id                 bigint generated always as identity primary key,
  legacy_account_id  bigint references public.legacy_accounts (id),
  loan_id            bigint references public.loans (id),
  action             text not null check (action in ('seize', 'release')),
  action_date        date not null,
  remarks            text check (length(remarks) <= 300),
  created_by         uuid not null default auth.uid() references public.staff (user_id),
  created_at         timestamptz not null default now(),
  idempotency_key    uuid not null unique,
  check ((legacy_account_id is null) <> (loan_id is null)),
  check (action = 'seize' or nullif(btrim(remarks), '') is not null)  -- a release always needs a reason
);
create index seizures_legacy_idx on public.seizures (legacy_account_id, created_at desc) where legacy_account_id is not null;
create index seizures_loan_idx   on public.seizures (loan_id, created_at desc) where loan_id is not null;

alter table public.seizures enable row level security;
create policy "staff read seizures" on public.seizures for select to authenticated using ((select public.is_staff()));
revoke all on public.seizures from anon;
revoke insert, update, delete, truncate on public.seizures from authenticated;  -- only via set_seized()
grant select on public.seizures to authenticated;

-- Current seized state of an old account: latest event, else the old software's flag.
create or replace function public.legacy_is_seized(p_id bigint, p_legacy boolean)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select s.action = 'seize' from public.seizures s where s.legacy_account_id = p_id order by s.created_at desc, s.id desc limit 1),
    p_legacy, false);
$$;
grant execute on function public.legacy_is_seized(bigint, boolean) to authenticated;

-- Seize (p.seize = true) or release (false). p = { source, ref_id, seize, action_date, remarks, idempotency_key }
create or replace function public.set_seized(p jsonb)
returns jsonb
language plpgsql
security definer   -- needs to update loans.status, which staff cannot update directly
set search_path = ''
as $$
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
  if not public.is_staff() then
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
$$;
revoke execute on function public.set_seized(jsonb) from anon, public;
grant execute on function public.set_seized(jsonb) to authenticated;

-- Account totals view: seized = current state (events override the old flag)
create or replace view public.legacy_account_summary
with (security_invoker = true)
as
select
  a.id, a.ledger, a.sno, a.fno, a.borrower_name, a.borrower_father, a.borrower_mobile,
  a.registration_no, a.vehicle_model, a.agreement_date, a.tenure_months,
  a.finance_amount, a.interest_amount, a.total_amount, a.emi_amount,
  public.legacy_is_seized(a.id, a.seized) as seized,
  a.data_flags, a.search_text,
  a.legacy_payments_count + coalesce(n.payments_count, 0)                         as payments_count,
  (a.legacy_paid + coalesce(n.total_paid, 0))::numeric(14,2)                      as total_paid,
  (a.total_amount - a.legacy_paid - coalesce(n.total_paid, 0))::numeric(14,2)     as balance,
  greatest(a.legacy_last_paid, n.last_paid_date)                                  as last_paid_date
from public.legacy_accounts a
left join lateral (
  select count(*) as payments_count, sum(np.paid_amount) as total_paid, max(np.paid_date) as last_paid_date
  from public.payments np
  where np.legacy_account_id = a.id
) n on true;

-- Collect list: seized new loans can still take payments
create or replace view public.pending_borrowers
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
where l.status in ('active', 'seized');

-- Seized Vehicles report: every account seized right now
create view public.seized_accounts
with (security_invoker = true)
as
select 'old'::text as source, a.sno::bigint as ref_id,
       case when nullif(a.fcode, '') is not null then a.fcode || '-' || a.fno else a.fno::text end as folio,
       a.ledger, a.borrower_name, nullif(concat_ws(', ', a.borrower_mobile, a.borrower_mobile2), '') as mobile,
       a.vehicle_model, a.registration_no as vehicle_no,
       s.total_amount, s.total_paid, s.balance,
       ev.action_date as seized_on, ev.remarks, ev.id is null as from_old_software,
       lower(concat_ws(' ', a.search_text, a.chassis_no, a.engine_no)) as search_text
from public.legacy_accounts a
join public.legacy_account_summary s on s.id = a.id
left join lateral (
  select e.id, e.action_date, e.remarks from public.seizures e
   where e.legacy_account_id = a.id and e.action = 'seize' order by e.created_at desc, e.id desc limit 1
) ev on true
where s.seized
union all
select 'new', l.id, l.folio_no, 'pending', b.full_name, b.mobile, l.vehicle_model, l.vehicle_no,
       l.total_amount, coalesce(pp.paid, 0)::numeric(14,2), (l.total_amount - coalesce(pp.paid, 0))::numeric(14,2),
       ev.action_date, ev.remarks, false,
       lower(concat_ws(' ', l.folio_no, b.full_name, b.father_name, b.mobile, l.vehicle_no, l.chassis_no, l.engine_no))
from public.loans l
join public.borrowers b on b.id = l.borrower_id
left join lateral (select sum(p.paid_amount) as paid from public.payments p where p.loan_id = l.id) pp on true
left join lateral (
  select e.action_date, e.remarks from public.seizures e
   where e.loan_id = l.id and e.action = 'seize' order by e.created_at desc, e.id desc limit 1
) ev on true
where l.status = 'seized';

revoke all on public.seized_accounts from anon;
grant select on public.seized_accounts to authenticated;

-- Payments allowed on seized new loans too
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
  v_im       int     := coalesce((p->>'installments_covered')::int, 1);
  v_today    date    := (now() at time zone 'Asia/Kolkata')::date;
  v_acct     bigint;
  v_loan     bigint;
  v_total    numeric;
  v_emi      numeric;
  v_interval int;
  v_start    date;
  v_paid     numeric;
  v_next     int;
  v_used     int;      -- EMI slots already covered by earlier receipts
  v_last_due date;     -- due date of the latest receipt
  v_last_im  int;      -- EMIs that latest receipt covered
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
  if v_im < 1 or v_im > 360 then
    raise exception 'EMIs covered must be 1 or more' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('payment:' || v_source || ':' || v_ref));

  -- receipts so far as (installment_no, due_date, paid, im), from the right tables
  if v_source = 'old' then
    select id, total_amount, emi_amount, greatest(coalesce(interval_months, 1), 1), agreement_date
      into v_acct, v_total, v_emi, v_interval, v_start
      from public.legacy_accounts where sno = v_ref and ledger = 'pending';
    if not found then raise exception 'account not found or not pending' using errcode = 'P0002'; end if;

    create temp table _r on commit drop as
      select installment_no n, due_date d, paid_amount amt,
             case when v_emi > 0 then greatest(1, round(paid_amount / v_emi))::int else 1 end im
        from public.legacy_payments where account_id = v_acct and ledger = 'pending'
      union all
      select installment_no, due_date, paid_amount, installments_covered
        from public.payments where legacy_account_id = v_acct;
  elsif v_source = 'new' then
    select id, total_amount, emi_amount, interval_months, agreement_date
      into v_loan, v_total, v_emi, v_interval, v_start
      from public.loans where id = v_ref and status in ('active', 'seized');
    if not found then raise exception 'loan not found or closed' using errcode = 'P0002'; end if;

    create temp table _r on commit drop as
      select installment_no n, due_date d, paid_amount amt, installments_covered im
        from public.payments where loan_id = v_loan;
  else
    raise exception 'bad source' using errcode = '22023';
  end if;

  select coalesce(sum(amt), 0), coalesce(max(n), 0), coalesce(sum(im), 0) into v_paid, v_next, v_used from _r;
  select d, im into v_last_due, v_last_im from _r where d is not null order by n desc limit 1;
  drop table _r;

  v_next := v_next + 1;
  -- This receipt starts at the first EMI slot not yet covered.
  if v_last_due is not null then
    v_due := (v_last_due + make_interval(months => v_last_im * v_interval))::date;
  elsif v_start is not null then
    v_due := (v_start + make_interval(months => (v_used + 1) * v_interval))::date;
  end if;

  insert into public.payments (legacy_account_id, loan_id, installment_no, due_date, due_amount, paid_amount, paid_date,
                               payment_mode, reference_no, bank_name, receipt_no, balance_after, delay_days,
                               installments_covered, idempotency_key)
  values (v_acct, v_loan, v_next, v_due, v_emi, v_amount, v_date,
          p->>'payment_mode', nullif(btrim(p->>'reference_no'), ''), nullif(btrim(p->>'bank_name'), ''),
          (p->>'receipt_no')::bigint, v_total - v_paid - v_amount, v_date - v_due, v_im, v_key)
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
    raise;
end;
$$;


-- Due report: seized = current state
create or replace function public.due_report(p_asof date)
returns table (
  source text, ref_id bigint, folio text, borrower_name text, vehicle_model text, mobile text, vehicle_no text,
  seized boolean, search_text text, emi numeric, balance numeric, arrears numeric, overdue_emis integer,
  due_emis numeric, next_due date
)
language sql
stable
security invoker
set search_path = ''
as $$
with acct as (
  select 'old'::text as src, a.sno::bigint as ref, a.id as acct_id, null::bigint as loan_id,
         case when nullif(a.fcode, '') is not null then a.fcode || '-' || a.fno else a.fno::text end as folio,
         a.borrower_name as nm, a.vehicle_model as model,
         nullif(concat_ws(', ', a.borrower_mobile, a.borrower_mobile2), '') as mob,
         a.registration_no as vno, public.legacy_is_seized(a.id, a.seized) as sz,
         lower(concat_ws(' ', a.search_text, a.chassis_no, a.engine_no,
               case when nullif(a.fcode, '') is not null then a.fcode || '-' || a.fno end)) as st,
         a.emi_amount as emi, a.total_amount as total, a.tenure_months as tenure,
         greatest(coalesce(a.interval_months, 1), 1) as iv, a.agreement_date as start
    from public.legacy_accounts a
   where a.ledger = 'pending'
  union all
  select 'new', l.id, null, l.id, l.folio_no, b.full_name, l.vehicle_model, b.mobile, l.vehicle_no, l.status = 'seized',
         lower(concat_ws(' ', l.folio_no, b.full_name, b.father_name, b.mobile, l.vehicle_no, l.chassis_no, l.engine_no)),
         l.emi_amount, l.total_amount, l.installments, greatest(l.interval_months, 1), l.agreement_date
    from public.loans l
    join public.borrowers b on b.id = l.borrower_id
   where l.status in ('active', 'seized')
),
rcpt0 as (
  select a.src, a.ref, a.iv, a.emi, lp.installment_no as n, lp.paid_date as pd, lp.due_date as d, lp.paid_amount as amt,
         null::int as stored_im
    from acct a
    join public.legacy_payments lp on lp.account_id = a.acct_id and lp.ledger = 'pending'
  union all
  select a.src, a.ref, a.iv, a.emi, p.installment_no, p.paid_date, p.due_date, p.paid_amount, p.installments_covered
    from acct a
    join public.payments p on p.legacy_account_id = a.acct_id
  union all
  select a.src, a.ref, a.iv, a.emi, p.installment_no, p.paid_date, p.due_date, p.paid_amount, p.installments_covered
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
  select g.src, g.ref, g.n, g.pd, g.d, g.amt,
         case when g.stored_im is not null and g.stored_im > 0 then g.stored_im
              when g.gap is not null and g.gap > 0 and g.gap % g.iv = 0 and g.gap / g.iv between 1 and 60 then g.gap / g.iv
              when g.emi > 0 then greatest(1, round(g.amt / g.emi))::int
              else 1 end as im
    from rcpt_gap g
),
agg as (
  select src, ref, sum(amt) as paid, sum(im)::int as used from rcpt group by src, ref
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
  select a.*, coalesce(g.paid, 0) as paid, coalesce(g.used, 0) as used, l.last_due, l.last_im, coalesce(rs.c, 0) as rdue,
         a.total - coalesce(g.paid, 0) as bal
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
),
slot_stats as (
  select src, ref,
         min(due) filter (where k = 1) as next_due,
         count(*) filter (where due <= p_asof)::int as due_le,
         count(*) filter (where due < p_asof)::int as overdue
    from slots
   group by src, ref
),
fin as (
  select c.*, s.next_due, coalesce(s.overdue, 0) as overdue,
         case when c.bal <= 0 then 0
              else greatest(0, least(c.bal, c.emi * (c.rdue + coalesce(s.due_le, 0)) - c.paid)) end as arr
    from calc2 c
    left join slot_stats s on s.src = c.src and s.ref = c.ref
)
select f.src, f.ref, f.folio, f.nm, f.model, f.mob, f.vno, f.sz, f.st, f.emi, f.bal, f.arr, f.overdue,
       case when f.emi > 0 then floor((f.arr * 100 * 10 + floor(f.emi * 100 / 2)) / (f.emi * 100)) / 10 else 0 end,
       f.next_due
  from fin f;
$$;

revoke execute on function public.due_report(date) from anon, public;
grant execute on function public.due_report(date) to authenticated;
