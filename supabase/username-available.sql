-- RPC for username availability (returns boolean).
-- Run this in Supabase SQL editor.

create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_username is null then false
    when trim(p_username) = '' then false
    when trim(p_username) !~ '^[a-z0-9._-]+$' then false
    else not exists (
      select 1
      from public.profiles
      where username = lower(trim(p_username))
    )
  end;
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
