-- Admin edit of a payment can make it a split payment (cash + online on one receipt), change the parts,
-- or turn a split back into one mode. The parts must add up to the amount.

do $$
declare d text;
begin
  d := pg_get_functiondef('public.admin_edit_payment(bigint, jsonb, text)'::regprocedure);
  if position($m$  if v_mode = 'SPLIT' and (o.payment_mode <> 'SPLIT' or v_amount <> o.paid_amount) then
    raise exception 'to change a split payment''s amount, cancel it and enter it again' using errcode = '22023';
  end if;$m$ in d) = 0
     or position('o public.payments; n public.payments; r jsonb; d jsonb;' in d) = 0
     or position('receipt_no = v_rno, installments_covered = v_im, parts = case when v_mode = ''SPLIT'' then parts end' in d) = 0
     or position('reference_no = nullif(btrim(p ->> ''reference_no''), ''''),' in d) = 0
     or position('''receipt_no'', ''installments_covered'']' in d) = 0 then
    raise exception 'admin_edit_payment: marker not found';
  end if;

  d := replace(d, 'o public.payments; n public.payments; r jsonb; d jsonb;', 'o public.payments; n public.payments; r jsonb; d jsonb; v_parts jsonb;');
  d := replace(d, $m$  if v_mode = 'SPLIT' and (o.payment_mode <> 'SPLIT' or v_amount <> o.paid_amount) then
    raise exception 'to change a split payment''s amount, cancel it and enter it again' using errcode = '22023';
  end if;$m$, $m$  if v_mode = 'SPLIT' then
    v_parts := app_private.check_parts(p -> 'parts');
    if (select sum((x ->> 'amount')::numeric) from jsonb_array_elements(v_parts) x) <> round(v_amount, 2) then
      raise exception 'the parts must add up to the amount' using errcode = '22023';
    end if;
  end if;$m$);
  d := replace(d, 'reference_no = nullif(btrim(p ->> ''reference_no''), ''''),',
                  'reference_no = case when v_mode = ''SPLIT'' then null else nullif(btrim(p ->> ''reference_no''), '''') end,');
  d := replace(d, 'receipt_no = v_rno, installments_covered = v_im, parts = case when v_mode = ''SPLIT'' then parts end',
                  'receipt_no = v_rno, installments_covered = v_im, parts = v_parts');
  d := replace(d, '''receipt_no'', ''installments_covered'']', '''receipt_no'', ''installments_covered'', ''parts'']');
  execute d;
end $$;
