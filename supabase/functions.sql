-- =====================================================================
-- Операции админки, которые должны выполняться целиком или не выполняться
-- вовсе. security invoker: функции работают с правами вошедшего
-- пользователя, поэтому RLS из rls.sql действует и здесь.
-- =====================================================================

-- Переименовать список: и в таблице lists, и у всех фильмов
create or replace function public.rename_list(old_name text, new_name text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Нужно войти в админку';
  end if;

  if exists (select 1 from public.lists where name = old_name) then
    update public.lists set name = new_name where name = old_name;
  else
    insert into public.lists (name) values (new_name) on conflict (name) do nothing;
  end if;

  update public.collection c
  set customlists = (
    select string_agg(case when trim(x) = old_name then new_name else trim(x) end, ', ' order by ord)
    from unnest(string_to_array(c.customlists, ',')) with ordinality as t(x, ord)
    where trim(x) <> ''
  )
  where old_name in (select trim(x) from unnest(string_to_array(c.customlists, ',')) as x);
end;
$$;

-- Удалить список: убрать его у всех фильмов и из таблицы lists
create or replace function public.delete_list(list_name text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Нужно войти в админку';
  end if;

  update public.collection c
  set customlists = coalesce((
    select string_agg(trim(x), ', ' order by ord)
    from unnest(string_to_array(c.customlists, ',')) with ordinality as t(x, ord)
    where trim(x) <> '' and trim(x) <> list_name
  ), '')
  where list_name in (select trim(x) from unnest(string_to_array(c.customlists, ',')) as x);

  delete from public.lists where name = list_name;
end;
$$;

-- Сохранить порядок ТОП-100: место = позиция id в массиве
create or replace function public.set_top_order(ids bigint[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Нужно войти в админку';
  end if;

  update public.collection c
  set toprank = t.ord
  from unnest(ids) with ordinality as t(id, ord)
  where c.id = t.id;
end;
$$;

revoke all on function public.rename_list(text, text) from public, anon;
revoke all on function public.delete_list(text) from public, anon;
revoke all on function public.set_top_order(bigint[]) from public, anon;
grant execute on function public.rename_list(text, text) to authenticated;
grant execute on function public.delete_list(text) to authenticated;
grant execute on function public.set_top_order(bigint[]) to authenticated;
