-- OD on a payment: every collector may change it (more, less or 0) while app_settings.collectors_change_od is on
-- (admin and "Late fees & discounts" always may). A changed OD is written to the activity log ("od_changed").
-- Admin "Edit payment" can also change the charges (OD, seize, other) of a receipt.

alter table public.app_settings add column collectors_change_od boolean not null default true;

do $$
declare d text; o text;
begin
  -- record_payment: who may change the OD, and the log line
  d := pg_get_functiondef('public.record_payment(jsonb)'::regprocedure); o := d;
  d := replace(d, '  v_charges numeric;
begin', '  v_charges numeric;
  v_od_auto numeric;
begin');
  d := replace(d, '    if round((p->>''od_amount'')::numeric, 2) <> v_od then
      if not public.is_admin() then raise exception ''only the admin can change the OD amount'' using errcode = ''22023''; end if;
      v_od := round((p->>''od_amount'')::numeric, 2);
    end if;',
'    if round((p->>''od_amount'')::numeric, 2) <> v_od then
      if not (public.is_admin() or public.has_perm(''money'') or (select collectors_change_od from public.app_settings where id = 1)) then
        raise exception ''you are not allowed to change the OD amount'' using errcode = ''22023'';
      end if;
      v_od_auto := v_od;
      v_od := round((p->>''od_amount'')::numeric, 2);
      perform app_private.log(''od_changed'',
        (app_private.acct_ref((select id from public.legacy_accounts where v_source = ''old'' and sno = v_ref),
                              case when v_source = ''new'' then v_ref end)) ->> ''subject'',
        jsonb_build_object(''source'', v_source, ''ref_id'', v_ref),
        jsonb_build_object(''suggested'', v_od_auto, ''taken'', v_od, ''days'', v_odd, ''rate'', (select od_per_day from public.app_settings where id = 1),
                           ''receipt_no'', v_rno, ''paid_date'', v_date));
    end if;');
  if position('v_od_auto := v_od;' in d) = 0 or position('v_od_auto numeric;' in d) = 0 then
    raise exception 'record_payment: marker not found';
  end if;
  execute d;

  -- Settings: the switch
  d := pg_get_functiondef('public.save_notification_settings(jsonb)'::regprocedure); o := d;
  d := replace(d, '    od_per_day              = coalesce((p ->> ''od_per_day'')::numeric, od_per_day),',
                  '    od_per_day              = coalesce((p ->> ''od_per_day'')::numeric, od_per_day),
    collectors_change_od    = coalesce((p ->> ''collectors_change_od'')::boolean, collectors_change_od),');
  if d = o then raise exception 'save_notification_settings: marker not found'; end if;
  execute d;
end $$;

-- the payment window: may this person change the OD, give the vehicle back
create or replace function public.charge_info(p_source text, p_ref bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_seized boolean; v_on date; v_acct bigint;
begin
  if not (public.has_perm('collect') or public.has_perm('view_accounts')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_source = 'old' then
    select id, public.legacy_is_seized(id, seized) into v_acct, v_seized from public.legacy_accounts where sno = p_ref;
    select action_date into v_on from public.seizures where legacy_account_id = v_acct order by created_at desc, id desc limit 1;
  else
    select status = 'seized' into v_seized from public.loans where id = p_ref;
    select action_date into v_on from public.seizures where loan_id = p_ref order by created_at desc, id desc limit 1;
  end if;
  return jsonb_build_object(
    'od_rate', (select od_per_day from public.app_settings where id = 1),
    'od_from', app_private.od_from(p_source, p_ref),
    'seized', coalesce(v_seized, false),
    'seized_on', case when v_seized then v_on end,
    'admin', public.is_admin(),
    'can_change_od', public.is_admin() or public.has_perm('money') or (select collectors_change_od from public.app_settings where id = 1),
    'can_release', public.has_perm('seize'));
end $$;

-- admin edit: the charges of a receipt can be changed too (not sent = kept); a SPLIT's parts cover EMI + charges
create or replace function public.admin_edit_payment(p_id bigint, p jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_reason text := app_private.need_reason(p_reason);
  o public.payments; n public.payments; r jsonb; d jsonb; v_parts jsonb;
  v_amount numeric := (p ->> 'paid_amount')::numeric;
  v_date date := (p ->> 'paid_date')::date;
  v_mode text := p ->> 'payment_mode';
  v_rno bigint := (p ->> 'receipt_no')::bigint;
  v_im int := coalesce((p ->> 'installments_covered')::int, 1);
  v_od numeric; v_seize numeric; v_other numeric; v_onote text;
begin
  if not public.has_perm('fix_entries') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into o from public.payments where id = p_id;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  perform app_private.payment_lock(o);
  select * into o from public.payments where id = p_id for update;

  v_od    := coalesce(round(nullif(p ->> 'od_amount', '')::numeric, 2), o.od_amount);
  v_seize := coalesce(round(nullif(p ->> 'seize_amount', '')::numeric, 2), o.seize_amount);
  v_other := coalesce(round(nullif(p ->> 'other_amount', '')::numeric, 2), o.other_amount);
  v_onote := case when p ? 'other_note' then nullif(btrim(p ->> 'other_note'), '') else o.other_note end;
  if v_od < 0 or v_seize < 0 or v_other < 0 then raise exception 'charges cannot be less than 0' using errcode = '22023'; end if;
  if v_other > 0 and v_onote is null then raise exception 'write what the other charge is for' using errcode = '22023'; end if;
  if length(v_onote) > 100 then raise exception 'the other charge note is too long' using errcode = '22023'; end if;

  if v_amount is null or v_amount <= 0 then raise exception 'amount must be more than 0' using errcode = '22023'; end if;
  if v_date is null or v_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'paid date cannot be in the future' using errcode = '22023'; end if;
  if v_mode = 'SPLIT' then
    v_parts := app_private.check_parts(p -> 'parts');
    if (select sum((x ->> 'amount')::numeric) from jsonb_array_elements(v_parts) x) <> round(v_amount + v_od + v_seize + v_other, 2) then
      raise exception 'the parts must add up to the EMI amount and the charges' using errcode = '22023';
    end if;
  end if;
  if v_mode is null or v_mode not in ('CASH', 'CHEQUE', 'SBI', 'BANK', 'SPLIT') then raise exception 'choose the payment mode' using errcode = '22023'; end if;
  if v_mode = 'BANK' and nullif(btrim(p ->> 'bank_name'), '') is null then raise exception 'enter the bank name' using errcode = '22023'; end if;
  if v_rno is null or v_rno <= 0 then raise exception 'enter the receipt number' using errcode = '22023'; end if;
  if v_im < 1 or v_im > 360 then raise exception 'EMIs covered must be 1 or more' using errcode = '22023'; end if;
  if v_rno <> o.receipt_no and exists (select 1 from public.pending_payments where series_id = o.series_id and receipt_no = v_rno) then
    raise exception 'receipt no. % is already used by a payment waiting for approval', v_rno using errcode = '22023';
  end if;
  if v_rno <> o.receipt_no and exists (select 1 from public.legacy_payments where series_id = o.series_id and receipt_no = v_rno) then
    raise exception 'receipt no. % was already used in the old software', v_rno using errcode = '22023';
  end if;

  update public.payments
     set paid_amount = v_amount, paid_date = v_date, payment_mode = v_mode,
         reference_no = case when v_mode = 'SPLIT' then null else nullif(btrim(p ->> 'reference_no'), '') end,
         bank_name = case when v_mode = 'BANK' then nullif(btrim(p ->> 'bank_name'), '') end,
         receipt_no = v_rno, installments_covered = v_im, parts = v_parts,
         od_amount = v_od, seize_amount = v_seize, other_amount = v_other,
         other_note = case when v_other > 0 then v_onote end, charges = v_od + v_seize + v_other
   where id = p_id;
  perform app_private.reflow_payments(o.legacy_account_id, o.loan_id);
  select * into n from public.payments where id = p_id;

  d := app_private.diff(to_jsonb(o), to_jsonb(n),
         array['paid_amount', 'paid_date', 'payment_mode', 'reference_no', 'bank_name', 'receipt_no', 'installments_covered', 'parts',
               'od_amount', 'seize_amount', 'other_amount', 'other_note']);
  if d = '{}' then raise exception 'nothing was changed' using errcode = '22023'; end if;
  r := app_private.acct_ref(o.legacy_account_id, o.loan_id);
  perform app_private.log('payment_edited', r ->> 'subject', r - 'subject',
    jsonb_build_object('reason', v_reason, 'receipt_no', o.receipt_no, 'changes', d));
  perform app_private.tg_quiet((select tg_on_payment from public.app_settings where id = 1),
    '✏️ Payment edited' || chr(10) || coalesce(r ->> 'subject', '?') || chr(10) ||
    'Rcpt ' || o.receipt_no || ': ' || app_private.inr(o.paid_amount + o.charges) || ' on ' || to_char(o.paid_date, 'DD/MM/YYYY') ||
    ' → Rcpt ' || n.receipt_no || ': ' || app_private.inr(n.paid_amount + n.charges) || ' on ' || to_char(n.paid_date, 'DD/MM/YYYY') || chr(10) ||
    'Reason: ' || v_reason || chr(10) || 'By ' || app_private.staff_name((select auth.uid())),
    'payment_edited');
  return jsonb_build_object('id', n.id, 'receipt_no', n.receipt_no, 'balance_after', n.balance_after);
end;
$function$;
