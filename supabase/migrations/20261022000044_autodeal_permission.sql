-- Auto Deal (used-vehicle stock and sales, on the Laravel site under /autodeal): a new "autodeal" extra power.
create or replace function app_private.clean_perms(p text[])
returns text[] language sql immutable set search_path = '' as $$
  select case when cardinality(x) = 0 then x else (select array_agg(distinct k order by k) from unnest(x || array['view_accounts']) k) end
  from (select coalesce(array(select k from unnest(p) k where k = any (array[
          'view_accounts','collect','new_loan','seize','reports','backdate','fix_entries','money','cash','approve','backup','activity','assign',
          'autodeal'])), '{}') as x) q;
$$;
