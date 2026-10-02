-- Speed: legacy payments never change, so their per-account totals are stored once
-- instead of re-adding ~25,000 rows on every Accounts page load (slow when the database is cold).
-- Only payments taken in the new system are summed live.

alter table public.legacy_accounts
  add column legacy_paid           numeric(14,2) not null default 0,
  add column legacy_payments_count integer       not null default 0,
  add column legacy_last_paid      date;

update public.legacy_accounts a
set legacy_paid           = coalesce(t.paid, 0),
    legacy_payments_count = coalesce(t.cnt, 0),
    legacy_last_paid      = t.last_paid
from (
  select lp.account_id, sum(lp.paid_amount) as paid, count(*) as cnt, max(lp.paid_date) as last_paid
  from public.legacy_payments lp
  join public.legacy_accounts x on x.id = lp.account_id and x.ledger = lp.ledger
  group by lp.account_id
) t
where t.account_id = a.id;

create or replace view public.legacy_account_summary
with (security_invoker = true)
as
select
  a.id, a.ledger, a.sno, a.fno, a.borrower_name, a.borrower_father, a.borrower_mobile,
  a.registration_no, a.vehicle_model, a.agreement_date, a.tenure_months,
  a.finance_amount, a.interest_amount, a.total_amount, a.emi_amount, a.seized,
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
