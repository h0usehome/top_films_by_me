-- =====================================================================
-- Много пользователей: у каждого своя коллекция и свои списки.
-- Пользователь Telegram получает аккаунт автоматически (Edge Function
-- supabase/functions/telegram), владелец сайта по-прежнему может входить
-- по email. Читать коллекции может кто угодно, изменять — только свою.
-- Применять после rls.sql и functions.sql. Скрипт можно запускать повторно.
-- =====================================================================

-- ---------- Профили ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  tg_id        bigint unique,                 -- id пользователя Telegram (не публичный)
  handle       text unique check (handle ~ '^[a-z0-9_]{3,32}$'),  -- адрес коллекции: ?u=handle
  display_name text check (char_length(display_name) <= 64),
  title        text check (char_length(title) <= 64),             -- своё название коллекции
  avatar_url   text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Public read profiles" on public.profiles;
drop policy if exists "Own update profile"   on public.profiles;

create policy "Public read profiles" on public.profiles
  for select to anon, authenticated using (true);

create policy "Own update profile" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- tg_id наружу не отдаём; менять пользователь может только имя, название и адрес.
-- Создаёт профили Edge Function с ключом service_role.
revoke all on public.profiles from anon, authenticated;
grant select (id, handle, display_name, title, avatar_url, created_at) on public.profiles to anon, authenticated;
grant update (handle, display_name, title) on public.profiles to authenticated;

-- Профиль владельца сайта (вход по email) — коллекция по адресу ?u=h0usehome
insert into public.profiles (id, handle)
values ('5669dd9d-cb7f-48cc-83c7-82a95e1a7c5b', 'h0usehome')
on conflict (id) do nothing;

-- ---------- Владелец у записей и списков ----------
alter table public.collection add column if not exists owner_id uuid;
update public.collection set owner_id = '5669dd9d-cb7f-48cc-83c7-82a95e1a7c5b' where owner_id is null;
alter table public.collection
  alter column owner_id set default auth.uid(),
  alter column owner_id set not null;
alter table public.collection drop constraint if exists collection_owner_id_fkey;
alter table public.collection
  add constraint collection_owner_id_fkey foreign key (owner_id) references public.profiles (id) on delete cascade;
create index if not exists collection_owner_id_idx on public.collection (owner_id);

alter table public.lists add column if not exists owner_id uuid;
update public.lists set owner_id = '5669dd9d-cb7f-48cc-83c7-82a95e1a7c5b' where owner_id is null;
alter table public.lists
  alter column owner_id set default auth.uid(),
  alter column owner_id set not null;
alter table public.lists drop constraint if exists lists_owner_id_fkey;
alter table public.lists
  add constraint lists_owner_id_fkey foreign key (owner_id) references public.profiles (id) on delete cascade;
-- Имя списка уникально в пределах одного пользователя
alter table public.lists drop constraint if exists lists_name_key;
alter table public.lists drop constraint if exists lists_owner_name_key;
alter table public.lists add constraint lists_owner_name_key unique (owner_id, name);

-- ---------- Права: каждый меняет только своё ----------
drop policy if exists "Owner insert collection" on public.collection;
drop policy if exists "Owner update collection" on public.collection;
drop policy if exists "Owner delete collection" on public.collection;

create policy "Owner insert collection" on public.collection
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owner update collection" on public.collection
  for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Owner delete collection" on public.collection
  for delete to authenticated using ((select auth.uid()) = owner_id);

drop policy if exists "Owner insert lists" on public.lists;
drop policy if exists "Owner update lists" on public.lists;
drop policy if exists "Owner delete lists" on public.lists;

create policy "Owner insert lists" on public.lists
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owner update lists" on public.lists
  for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Owner delete lists" on public.lists
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- ---------- Атомарные операции админки — только со своими записями ----------
create or replace function public.rename_list(old_name text, new_name text)
returns void language plpgsql security invoker set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'Нужно войти в админку'; end if;

  if exists (select 1 from public.lists where owner_id = me and name = old_name) then
    update public.lists set name = new_name where owner_id = me and name = old_name;
  else
    insert into public.lists (owner_id, name) values (me, new_name) on conflict (owner_id, name) do nothing;
  end if;

  update public.collection c
  set customlists = (
    select string_agg(case when trim(x) = old_name then new_name else trim(x) end, ', ' order by ord)
    from unnest(string_to_array(c.customlists, ',')) with ordinality as t(x, ord)
    where trim(x) <> ''
  )
  where c.owner_id = me
    and old_name in (select trim(x) from unnest(string_to_array(c.customlists, ',')) as x);
end;
$$;

create or replace function public.delete_list(list_name text)
returns void language plpgsql security invoker set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'Нужно войти в админку'; end if;

  update public.collection c
  set customlists = coalesce((
    select string_agg(trim(x), ', ' order by ord)
    from unnest(string_to_array(c.customlists, ',')) with ordinality as t(x, ord)
    where trim(x) <> '' and trim(x) <> list_name
  ), '')
  where c.owner_id = me
    and list_name in (select trim(x) from unnest(string_to_array(c.customlists, ',')) as x);

  delete from public.lists where owner_id = me and name = list_name;
end;
$$;

create or replace function public.set_top_order(ids bigint[])
returns void language plpgsql security invoker set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'Нужно войти в админку'; end if;

  update public.collection c
  set toprank = t.ord
  from unnest(ids) with ordinality as t(id, ord)
  where c.id = t.id and c.owner_id = me;
end;
$$;

revoke all on function public.rename_list(text, text) from public, anon;
revoke all on function public.delete_list(text) from public, anon;
revoke all on function public.set_top_order(bigint[]) from public, anon;
grant execute on function public.rename_list(text, text) to authenticated;
grant execute on function public.delete_list(text) to authenticated;
grant execute on function public.set_top_order(bigint[]) to authenticated;
