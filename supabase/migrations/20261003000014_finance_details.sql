-- Finance Details report: due_report() now also returns each account's loan amounts,
-- total received, last paid date and late days (sum of every receipt's days late; early = negative,
-- like the old software's "Late Dues"). Calculation of arrears / next due is unchanged.
drop function if exists public.due_report(date);

create or replace function public.due_report(p_asof date)
returns table (
  source text, ref_id bigint, folio text, borrower_name text, vehicle_model text, mobile text, vehicle_no text,
  seized boolean, search_text text, emi numeric, balance numeric, arrears numeric, overdue_emis integer,
  due_emis numeric, next_due date,
  agreement_date date, tenure integer, finance_amount numeric, interest_amount numeric, other_charges numeric,
  total_amount numeric, total_paid numeric, last_paid date, late_days integer
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
         greatest(coalesce(a.interval_months, 1), 1) as iv, a.agreement_date as start,
         a.finance_amount as fin, a.interest_amount as intr, a.agreement_amount + a.hp_amount as other
    from public.legacy_accounts a
   where a.ledger = 'pending'
  union all
  select 'new', l.id, null, l.id, l.folio_no, b.full_name, l.vehicle_model, b.mobile, l.vehicle_no, l.status = 'seized',
         lower(concat_ws(' ', l.folio_no, b.full_name, b.father_name, b.mobile, l.vehicle_no, l.chassis_no, l.engine_no)),
         l.emi_amount, l.total_amount, l.installments, greatest(l.interval_months, 1), l.agreement_date,
         l.finance_amount, l.interest_amount, l.agreement_amount + l.hp_amount
    from public.loans l
    join public.borrowers b on b.id = l.borrower_id
   where l.status in ('active', 'seized')
),
rcpt0 as (
  select a.src, a.ref, a.iv, a.emi, lp.installment_no as n, lp.paid_date as pd, lp.due_date as d, lp.paid_amount as amt,
         null::int as stored_im, lp.delay_days as dd
    from acct a
    join public.legacy_payments lp on lp.account_id = a.acct_id and lp.ledger = 'pending'
  union all
  select a.src, a.ref, a.iv, a.emi, p.installment_no, p.paid_date, p.due_date, p.paid_amount, p.installments_covered, p.delay_days
    from acct a
    join public.payments p on p.legacy_account_id = a.acct_id
  union all
  select a.src, a.ref, a.iv, a.emi, p.installment_no, p.paid_date, p.due_date, p.paid_amount, p.installments_covered, p.delay_days
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
  select g.src, g.ref, g.n, g.pd, g.d, g.amt, g.dd,
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
       f.next_due,
       f.start, f.tenure, f.fin, f.intr, f.other, f.total, f.paid, f.last_paid, f.late
  from fin f;
$$;

revoke execute on function public.due_report(date) from anon, public;
grant execute on function public.due_report(date) to authenticated;
