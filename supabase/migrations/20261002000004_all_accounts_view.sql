-- One list for the Accounts screen: legacy accounts (source 'old') + loans entered in the new system (source 'new').
-- New loans have no payments yet, so paid = 0 and balance = total payable.
create view public.all_accounts
with (security_invoker = true)
as
select
  'old'::text                 as source,
  s.sno::bigint               as ref_id,          -- link: /accounts/{ref_id}
  s.fno::text                 as folio,
  s.ledger,
  s.borrower_name, s.borrower_father, s.borrower_mobile,
  s.registration_no, s.vehicle_model, s.tenure_months,
  s.payments_count, s.seized,
  s.total_amount, s.emi_amount, s.total_paid, s.balance,
  s.search_text,
  s.sno::bigint               as sort_key
from public.legacy_account_summary s
union all
select
  'new'::text,
  l.id,                                            -- link: /loans/{ref_id}
  l.folio_no,
  case when l.status = 'closed' then 'closed' else 'pending' end,
  b.full_name, b.father_name, b.mobile,
  l.vehicle_no, l.vehicle_model, l.installments,
  0::bigint, l.status = 'seized',
  l.total_amount, l.emi_amount, 0::numeric(14,2), l.total_amount,
  lower(l.folio_no || ' ' || b.full_name || ' ' || coalesce(b.mobile, '') || ' ' ||
        coalesce(l.vehicle_no, '') || ' ' || coalesce(b.father_name, '')),
  1000000000 + l.id                                -- new loans list first, newest on top
from public.loans l
join public.borrowers b on b.id = l.borrower_id;

revoke all on public.all_accounts from anon;
grant select on public.all_accounts to authenticated;
