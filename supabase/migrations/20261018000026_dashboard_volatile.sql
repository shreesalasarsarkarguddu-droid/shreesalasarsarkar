-- dashboard() builds temp tables, which a "stable" function may not do.
alter function public.dashboard(date) volatile;
