-- The language of one reminder, chosen when it is sent (step 20, D-17).
--
-- The client's card keeps the default language (clients.message_locale, step 19). Before opening
-- WhatsApp the admin may send this one message in another language; the card does not change. The
-- "chat opened" event names the template that actually went out, so it takes the chosen language.

-- A new argument changes the signature: the old functions are dropped rather than overloaded (an
-- overload with a default is ambiguous). record_reminder_opened() goes first, it calls the other.
drop function public.record_reminder_opened(uuid, text);
drop function public.reminder_template_for(uuid, text);

-- The template of this kind in p_locale (the client's language when null), or the Russian one.
-- The screens apply the same rule (pickTemplate() in src/features/reminders/template.ts).
create function public.reminder_template_for(
  p_client_id uuid,
  p_kind text,
  p_locale text default null
)
returns uuid
language sql
stable
set search_path = ''
as $$
  select t.id
  from public.message_templates t
  join public.clients c on c.id = p_client_id
  where t.kind = p_kind and t.locale in (coalesce(p_locale, c.message_locale), 'ru')
  order by t.locale = coalesce(p_locale, c.message_locale) desc
  limit 1;
$$;

comment on function public.reminder_template_for(uuid, text, text) is
  'Template of p_kind in p_locale (default: the client''s message language), falling back to Russian.';

-- As in *_message_languages.sql, plus the language this message was sent in. Null: the client's.
-- A repeat keeps the first event whatever its language (unique (payment_id, kind)).
create function public.record_reminder_opened(
  p_payment_id uuid,
  p_kind text,
  p_locale text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_client_id uuid;
  v_template_id uuid;
  v_event public.reminder_events;
  v_created boolean := true;
begin
  perform public.require_staff_role(array['owner', 'admin']);
  if p_kind is null or p_kind not in ('before_7', 'before_1', 'overdue') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if p_locale is not null and p_locale not in ('ru', 'kk', 'uz') then
    raise exception 'invalid_locale' using errcode = '22023';
  end if;

  select p.client_id into v_client_id
  from public.payments p
  where p.id = p_payment_id and p.kind in ('payment', 'import_balance');
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;

  v_template_id := public.reminder_template_for(v_client_id, p_kind, p_locale);
  if v_template_id is null then
    raise exception 'template_not_found' using errcode = 'P0002';
  end if;

  insert into public.reminder_events (client_id, payment_id, kind, template_id, opened_by)
  values (v_client_id, p_payment_id, p_kind, v_template_id, (select auth.uid()))
  on conflict (payment_id, kind) do nothing
  returning * into v_event;

  if not found then
    v_created := false;
    select * into v_event
    from public.reminder_events re
    where re.payment_id = p_payment_id and re.kind = p_kind;
  end if;

  return jsonb_build_object(
    'id', v_event.id,
    'client_id', v_event.client_id,
    'opened_at', v_event.opened_at,
    'status', v_event.status,
    'created', v_created
  );
end;
$$;

grant execute on function public.reminder_template_for(uuid, text, text)
  to authenticated, service_role;
grant execute on function public.record_reminder_opened(uuid, text, text)
  to authenticated, service_role;
