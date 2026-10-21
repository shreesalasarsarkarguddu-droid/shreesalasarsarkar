-- Day Book: how much of every entry was cash and how much bank, and the opening balance for one mode
-- (Day Book filter Mode: All / Cash / Bank).
-- Cash = CASH or no mode (old software); everything else (BOB, SBI, SSS, BANK, UPI, ...) is bank.
-- A split payment counts its CASH part as cash and the rest as bank.

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
       lp.sno::bigint                                as ref_id,
       lp.receipt_book                               as receipt_book,
       (case when upper(btrim(coalesce(lp.payment_mode, 'CASH'))) = 'CASH' then lp.paid_amount else 0 end)::numeric(14,2) as cash,
       (case when upper(btrim(coalesce(lp.payment_mode, 'CASH'))) = 'CASH' then 0 else lp.paid_amount end)::numeric(14,2) as bank
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
       coalesce(a.sno::bigint, l.id),
       p.receipt_book,
       public.mode_part(p.payment_mode, p.paid_amount, p.parts, 'CASH'),
       p.paid_amount - public.mode_part(p.payment_mode, p.paid_amount, p.parts, 'CASH')
from public.payments p
left join public.legacy_accounts a on a.id = p.legacy_account_id
left join public.loans l on l.id = p.loan_id
left join public.borrowers b on b.id = l.borrower_id
union all
select a.agreement_date, 2, 'loan',
       a.borrower_name || coalesce(' ' || a.registration_no, ''),
       a.fno::text, null, null, null, null,
       coalesce(a.finance_mode, 'CASH'), null, 0, a.finance_amount, 'old', a.sno::bigint, null,
       case when upper(btrim(coalesce(a.finance_mode, 'CASH'))) = 'CASH' then a.finance_amount else 0 end,
       case when upper(btrim(coalesce(a.finance_mode, 'CASH'))) = 'CASH' then 0 else a.finance_amount end
from public.legacy_accounts a
where a.agreement_date is not null and a.finance_amount > 0
union all
select l.agreement_date, 2, 'loan',
       b.full_name || coalesce(' ' || l.vehicle_no, ''),
       l.folio_no, null, null, null, null,
       l.loan_type, null, 0, l.finance_amount, 'new', l.id, null,
       case when upper(btrim(coalesce(l.loan_type, 'CASH'))) = 'CASH' then l.finance_amount else 0 end,
       case when upper(btrim(coalesce(l.loan_type, 'CASH'))) = 'CASH' then 0 else l.finance_amount end
from public.loans l
join public.borrowers b on b.id = l.borrower_id;

-- Totals of every entry before p_from, for one mode ('all', 'cash' or 'bank'), with the cash part of each side.
drop function if exists public.day_book_opening(date);
create function public.day_book_opening(p_from date, p_mode text default 'all')
returns table (debit numeric, credit numeric, cash_debit numeric, cash_credit numeric)
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(case p_mode when 'cash' then e.cash when 'bank' then e.bank else e.debit end) filter (where e.kind = 'receipt'), 0),
         coalesce(sum(case p_mode when 'cash' then e.cash when 'bank' then e.bank else e.credit end) filter (where e.kind = 'loan'), 0),
         coalesce(sum(case when p_mode = 'bank' then 0 else e.cash end) filter (where e.kind = 'receipt'), 0),
         coalesce(sum(case when p_mode = 'bank' then 0 else e.cash end) filter (where e.kind = 'loan'), 0)
  from public.day_book_entries e
  where e.entry_date < p_from;
$$;
revoke execute on function public.day_book_opening(date, text) from anon, public;
grant execute on function public.day_book_opening(date, text) to authenticated;
