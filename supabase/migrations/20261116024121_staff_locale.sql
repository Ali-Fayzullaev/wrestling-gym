-- Interface language per employee (step 16, D-04).
--
-- STUB(D-13): until the owner decides who chooses the language, each employee picks their own on
-- the "More" screen; Russian by default. The proxy already calls current_staff_access() on every
-- request, so the language rides along with the role and costs no extra query.
--
-- Nobody writes the column through the table: authenticated has no column privilege on it (the
-- owner's update policy covers other columns only), and set_my_locale() changes the caller's own
-- row and nobody else's.

alter table public.staff
  add column locale text not null default 'ru' check (locale in ('ru', 'kk', 'uz'));

comment on column public.staff.locale is
  'Interface language of the employee: ru, kk or uz (Cyrillic).';

create or replace function public.current_staff_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'role', s.role,
    'must_change_password', s.must_change_password,
    'locale', s.locale
  )
  from public.staff s
  where s.id = (select auth.uid())
    and s.active;
$$;

comment on function public.current_staff_access() is
  'Role, must_change_password and locale of the signed-in active employee, otherwise null.';

-- The caller's own language. Any active employee with their own password; a guest, a deactivated
-- employee and one with a temporary password are refused like everywhere else. Not audited: it is a
-- display preference, not a change to the gym's data.
create function public.set_my_locale(p_locale text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_staff_role(array['owner', 'admin']);
  if p_locale is null or p_locale not in ('ru', 'kk', 'uz') then
    raise exception 'invalid_locale' using errcode = '22023';
  end if;
  update public.staff set locale = p_locale where id = (select auth.uid());
end;
$$;

comment on function public.set_my_locale(text) is
  'Sets the interface language of the signed-in employee only.';

revoke all on function public.set_my_locale(text) from public, anon;
grant execute on function public.set_my_locale(text) to authenticated, service_role;
