-- Day Book: every money movement by date.
--   Debit  (money in)  = installments received (legacy receipts + payments taken in the new system)
--   Credit (money out) = loans given (finance amount on the agreement date)
-- Legacy receipts are counted once: only rows from the same ledger file as their account
-- (the 15 accounts present in both payment files are not double counted), plus orphan rows.

create index if not exists legacy_payments_paid_date_idx  on public.legacy_payments (paid_date);
create index if not exists payments_paid_date_idx         on public.payments (paid_date);
create index if not exists legacy_accounts_agreement_idx  on public.legacy_accounts (agreement_date);
create index if not exists loans_agreement_idx            on public.loans (agreement_date);

create view public.day_book_entries
with (security_invoker = true)
as
-- legacy receipts
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
-- receipts taken in the new system
select p.paid_date, 1, 'receipt',
       coalesce(a.borrower_name, b.full_name) || coalesce(' ' || coalesce(a.registration_no, l.vehicle_no), ''),
       coalesce(a.fno::text, l.folio_no),
       p.due_amount, p.due_date, p.delay_days,
       case when coalesce(a.emi_amount, l.emi_amount) > 0 then greatest(1, round(p.paid_amount / coalesce(a.emi_amount, l.emi_amount)))::int end,
       p.payment_mode, p.receipt_no, p.paid_amount, 0,
       case when p.loan_id is null then 'old' else 'new' end,
       coalesce(a.sno::bigint, l.id)
from public.payments p
left join public.legacy_accounts a on a.id = p.legacy_account_id
left join public.loans l on l.id = p.loan_id
left join public.borrowers b on b.id = l.borrower_id
union all
-- legacy loans given
select a.agreement_date, 2, 'loan',
       a.borrower_name || coalesce(' ' || a.registration_no, ''),
       a.fno::text, null, null, null, null,
       coalesce(a.finance_mode, 'CASH'), null, 0, a.finance_amount, 'old', a.sno::bigint
from public.legacy_accounts a
where a.agreement_date is not null and a.finance_amount > 0
union all
-- new loans given
select l.agreement_date, 2, 'loan',
       b.full_name || coalesce(' ' || l.vehicle_no, ''),
       l.folio_no, null, null, null, null,
       l.loan_type, null, 0, l.finance_amount, 'new', l.id
from public.loans l
join public.borrowers b on b.id = l.borrower_id;

revoke all on public.day_book_entries from anon;
grant select on public.day_book_entries to authenticated;

-- Opening balance (debit - credit) of everything before p_from.
create or replace function public.day_book_opening(p_from date)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(debit - credit), 0) from public.day_book_entries where entry_date < p_from;
$$;

revoke execute on function public.day_book_opening(date) from anon, public;
grant execute on function public.day_book_opening(date) to authenticated;
