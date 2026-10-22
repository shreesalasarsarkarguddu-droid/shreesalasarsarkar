-- Admin: delete a loan made in this app completely, with everything on it (payments, payments waiting for approval,
-- late fees / discounts, seize / release, visit remarks, collection lists). Asked for: the reason, the folio no. typed
-- again, and the delete PIN. A restore point is saved first and the whole loan is copied into the activity log.

-- secrets kept away from every screen (only SECURITY DEFINER functions read them)
create table if not exists app_private.secrets (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
insert into app_private.secrets (key, value)
values ('delete_pin', extensions.crypt('334455', extensions.gen_salt('bf')))
on conflict (key) do nothing;

create or replace function public.admin_purge_loan(p_loan bigint, p_reason text, p_folio text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := app_private.need_reason(p_reason);
  l public.loans; b public.borrowers; r jsonb; v_rp bigint; v_hash text;
  v_pays jsonb; v_pending jsonb; v_adj jsonb; v_seiz jsonb; v_rem jsonb; v_asg jsonb; v_paid numeric;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('payment:new:' || p_loan));
  select * into l from public.loans where id = p_loan for update;
  if not found then raise exception 'loan not found' using errcode = 'P0002'; end if;
  if upper(btrim(coalesce(p_folio, ''))) <> upper(btrim(l.folio_no)) then
    raise exception 'type the folio number % to confirm', l.folio_no using errcode = '22023';
  end if;
  select value into v_hash from app_private.secrets where key = 'delete_pin';
  if v_hash is null or extensions.crypt(coalesce(p_pin, ''), v_hash) <> v_hash then
    raise exception 'wrong PIN' using errcode = '22023';
  end if;

  select * into b from public.borrowers where id = l.borrower_id;
  r := app_private.acct_ref(null, p_loan);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.installment_no), '[]'), coalesce(sum(x.paid_amount), 0)
    into v_pays, v_paid from public.payments x where x.loan_id = p_loan;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_pending from public.pending_payments x where x.source = 'new' and x.ref_id = p_loan;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_adj from public.adjustments x where x.loan_id = p_loan;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_seiz from public.seizures x where x.loan_id = p_loan;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_rem from public.visit_remarks x where x.source = 'new' and x.ref_id = p_loan;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_asg from public.collection_assignments x where x.source = 'new' and x.ref_id = p_loan;

  v_rp := app_private.make_restore_point('Before deleting loan folio ' || l.folio_no);

  delete from public.payments where loan_id = p_loan;
  delete from public.pending_payments where source = 'new' and ref_id = p_loan;
  delete from public.adjustments where loan_id = p_loan;
  delete from public.seizures where loan_id = p_loan;
  delete from public.visit_remarks where source = 'new' and ref_id = p_loan;
  delete from public.collection_assignments where source = 'new' and ref_id = p_loan;
  delete from public.loans where id = p_loan;
  if not exists (select 1 from public.loans where borrower_id = b.id) then delete from public.borrowers where id = b.id; end if;
  delete from app_private.dashboard_cache;

  perform app_private.log('loan_purged', r ->> 'subject', null,
    jsonb_build_object('reason', v_reason, 'restore_point', v_rp, 'paid', v_paid,
      'counts', jsonb_build_object('payments', jsonb_array_length(v_pays), 'waiting', jsonb_array_length(v_pending),
                                   'adjustments', jsonb_array_length(v_adj), 'seizures', jsonb_array_length(v_seiz),
                                   'remarks', jsonb_array_length(v_rem), 'assignments', jsonb_array_length(v_asg)),
      'loan', to_jsonb(l), 'borrower', to_jsonb(b), 'payments', v_pays, 'waiting', v_pending, 'adjustments', v_adj,
      'seizures', v_seiz, 'remarks', v_rem, 'assignments', v_asg));
  perform app_private.tg_quiet((select tg_on_new_loan from public.app_settings where id = 1),
    '🗑 Loan deleted completely' || chr(10) || coalesce(r ->> 'subject', '?') || chr(10) ||
    'Total ' || app_private.inr(l.total_amount) || ' · ' || jsonb_array_length(v_pays) || ' payment(s) ' || app_private.inr(v_paid) || chr(10) ||
    'Reason: ' || v_reason || chr(10) || 'By ' || app_private.staff_name((select auth.uid())),
    'loan_purged');
  return jsonb_build_object('deleted', p_loan, 'payments', jsonb_array_length(v_pays), 'paid', v_paid, 'restore_point', v_rp);
end;
$$;
revoke execute on function public.admin_purge_loan(bigint, text, text, text) from anon, public;
grant execute on function public.admin_purge_loan(bigint, text, text, text) to authenticated;
