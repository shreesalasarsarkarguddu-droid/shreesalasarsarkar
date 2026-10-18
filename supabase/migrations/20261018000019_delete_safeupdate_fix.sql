-- Fix: deleting from the website failed. Supabase's API connection loads "safeupdate", which refuses a DELETE
-- without a WHERE clause (even inside a function). Whole-table deletes now say "where true" explicitly.

create or replace function public.admin_delete_data(p_scope text, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_rp bigint; before jsonb; after jsonb;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if p_scope not in ('old', 'new', 'all') then raise exception 'bad scope' using errcode = '22023'; end if;
  if p_confirm is distinct from 'DELETE' then raise exception 'type DELETE to confirm' using errcode = '22023'; end if;

  v_rp := app_private.make_restore_point('Before delete (' || p_scope || ')');
  before := app_private.data_counts();

  if p_scope in ('new', 'all') then
    delete from public.seizures where true;
    delete from public.payments where true;
    delete from public.loans where true;
    delete from public.borrowers where true;
  end if;
  if p_scope in ('old', 'all') then
    delete from public.seizures where legacy_account_id is not null;
    delete from public.payments where legacy_account_id is not null;
    delete from public.legacy_payments where true;
    delete from public.legacy_accounts where true;
    delete from public.import_batches where true;
  end if;

  after := app_private.data_counts();
  perform app_private.audit('delete', jsonb_build_object('scope', p_scope, 'restore_point', v_rp, 'before', before, 'after', after));
  return jsonb_build_object('restore_point', v_rp, 'before', before, 'after', after);
end;
$$;

alter function public.admin_delete_data(text, text) set statement_timeout = '120s';
