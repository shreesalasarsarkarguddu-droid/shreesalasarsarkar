-- Import preview: besides the broad "receipts on/after the first app payment" warning, list the receipts in the files
-- that look like the SAME money as a payment taken in this app: same receipt number, or same date and same amount.

create or replace function public.admin_import_preview(p_job uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j app_private.import_jobs := app_private.my_job(p_job); v jsonb;
begin
  with s as (select file, (a).* from app_private.staged_accounts(p_job)),
       sa as (select x.a from app_private.staged_accounts(p_job) x),
       e as (select la.* from public.legacy_accounts la),
       dup as (select sno from s group by sno having count(*) > 1),
       cmp as (
         select s.sno, s.ledger as new_ledger, e.ledger as old_ledger, s.borrower_name,
                case when e.id is null then 'new'
                     when app_private.acc_business(sa.a) = app_private.acc_business(e) then 'same' else 'changed' end as kind
           from sa join s on s.sno = (sa.a).sno
           left join public.legacy_accounts e on e.sno = s.sno),
       sp as (select (p).* from app_private.staged_payments(p_job)),
       snos as (select sno from s union select sno from sp),
       old_r as (select ledger, sno, installment_no, paid_date, paid_amount from public.legacy_payments where sno in (select sno from snos)),
       new_r as (select ledger, sno, installment_no, paid_date, paid_amount from sp),
       risk as (   -- receipts in the files dated on/after the first payment taken in this app for that account
         select e.sno, e.borrower_name, min(ap.paid_date) as app_first, count(distinct nr.installment_no) as file_receipts_after
           from public.legacy_accounts e
           join public.payments ap on ap.legacy_account_id = e.id
           join new_r nr on nr.sno = e.sno and nr.paid_date >= (select min(paid_date) from public.payments where legacy_account_id = e.id)
          group by e.sno, e.borrower_name),
       likely as ( -- a receipt in the files that matches an app payment: same receipt no., or same date + amount
         select e.sno, e.borrower_name,
                ap.receipt_no as app_receipt, ap.paid_date as app_date, ap.paid_amount as app_amount,
                f.receipt_no as file_receipt, f.paid_date as file_date, f.paid_amount as file_amount,
                case when f.receipt_no = ap.receipt_no then 'same receipt no.' else 'same date and amount' end as why
           from public.legacy_accounts e
           join public.payments ap on ap.legacy_account_id = e.id
           join sp f on f.sno = e.sno
                    and (f.receipt_no = ap.receipt_no or (f.paid_date = ap.paid_date and f.paid_amount = ap.paid_amount)))
  select jsonb_build_object(
    'files', j.batches,
    'checks', j.checks,
    'duplicate_snos', (select coalesce(jsonb_agg(sno), '[]') from dup),
    'accounts', jsonb_build_object(
        'in_files', (select count(*) from s),
        'new', (select count(*) from cmp where kind = 'new'),
        'changed', (select count(*) from cmp where kind = 'changed'),
        'same', (select count(*) from cmp where kind = 'same'),
        'moved', (select count(*) from cmp where kind <> 'new' and new_ledger <> old_ledger),
        'not_in_files', (select count(*) from e where e.sno not in (select sno from s)),
        'examples_new', (select coalesce(jsonb_agg(jsonb_build_object('sno', sno, 'name', borrower_name)), '[]') from (select * from cmp where kind = 'new' order by sno limit 10) x),
        'examples_changed', (select coalesce(jsonb_agg(jsonb_build_object('sno', sno, 'name', borrower_name)), '[]') from (select * from cmp where kind = 'changed' order by sno limit 10) x),
        'examples_moved', (select coalesce(jsonb_agg(jsonb_build_object('sno', sno, 'name', borrower_name, 'from', old_ledger, 'to', new_ledger)), '[]') from (select * from cmp where kind <> 'new' and new_ledger <> old_ledger order by sno limit 10) x),
        'examples_not_in_files', (select coalesce(jsonb_agg(jsonb_build_object('sno', sno, 'name', borrower_name, 'ledger', ledger)), '[]') from (select * from e where e.sno not in (select sno from s) order by sno limit 10) x)),
    'receipts', jsonb_build_object(
        'in_files', (select count(*) from sp),
        'now_for_these_accounts', (select count(*) from old_r),
        'added', (select count(*) from (select * from new_r except all select * from old_r) x),
        'removed', (select count(*) from (select * from old_r except all select * from new_r) x)),
    'double_entry_risk', (select coalesce(jsonb_agg(jsonb_build_object('sno', sno, 'name', borrower_name, 'app_first', app_first, 'file_receipts_after', file_receipts_after) order by sno), '[]') from risk),
    'double_entry_likely', (select coalesce(jsonb_agg(to_jsonb(l) order by l.sno, l.app_date), '[]') from likely l)
  ) into v;
  update app_private.import_jobs set preview = v where id = p_job;
  return v;
end;
$$;

alter function public.admin_import_preview(uuid) set statement_timeout = '120s';
revoke execute on function public.admin_import_preview(uuid) from anon, public;
grant execute on function public.admin_import_preview(uuid) to authenticated;
