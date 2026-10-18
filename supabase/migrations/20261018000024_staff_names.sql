-- Names of the people (for the receipt-book and activity filters), for anyone who manages cash or reads the activity log.
create or replace function public.staff_names()
returns table (user_id uuid, full_name text, active boolean)
language sql stable security definer set search_path = '' as $$
  select s.user_id, s.full_name, s.active from public.staff s
   where public.has_perm('cash') or public.has_perm('activity') or public.has_perm('approve')
   order by s.active desc, s.full_name;
$$;
revoke execute on function public.staff_names() from anon, public;
grant execute on function public.staff_names() to authenticated;
