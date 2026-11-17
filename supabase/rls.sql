-- =====================================================================
-- Защита данных (Row Level Security)
-- Читать коллекцию и списки может кто угодно (это публичный сайт),
-- изменять — только владелец, вошедший в админку.
-- OWNER_ID — id пользователя из Supabase → Authentication → Users.
-- =====================================================================

-- ---------- collection ----------
alter table public.collection enable row level security;

drop policy if exists "Public read collection" on public.collection;
drop policy if exists "Owner insert collection" on public.collection;
drop policy if exists "Owner update collection" on public.collection;
drop policy if exists "Owner delete collection" on public.collection;

create policy "Public read collection" on public.collection
  for select to anon, authenticated using (true);

create policy "Owner insert collection" on public.collection
  for insert to authenticated
  with check ((select auth.uid()) = '5669dd9d-cb7f-48cc-83c7-82a95e1a7c5b');

create policy "Owner update collection" on public.collection
  for update to authenticated
  using ((select auth.uid()) = '5669dd9d-cb7f-48cc-83c7-82a95e1a7c5b')
  with check ((select auth.uid()) = '5669dd9d-cb7f-48cc-83c7-82a95e1a7c5b');

create policy "Owner delete collection" on public.collection
  for delete to authenticated
  using ((select auth.uid()) = '5669dd9d-cb7f-48cc-83c7-82a95e1a7c5b');

-- ---------- lists ----------
-- Старые политики разрешали изменения всем подряд
drop policy if exists "Allow public read"   on public.lists;
drop policy if exists "Allow public insert" on public.lists;
drop policy if exists "Allow public update" on public.lists;
drop policy if exists "Allow public delete" on public.lists;
drop policy if exists "Public read lists"   on public.lists;
drop policy if exists "Owner insert lists"  on public.lists;
drop policy if exists "Owner update lists"  on public.lists;
drop policy if exists "Owner delete lists"  on public.lists;

alter table public.lists enable row level security;

create policy "Public read lists" on public.lists
  for select to anon, authenticated using (true);

create policy "Owner insert lists" on public.lists
  for insert to authenticated
  with check ((select auth.uid()) = '5669dd9d-cb7f-48cc-83c7-82a95e1a7c5b');

create policy "Owner update lists" on public.lists
  for update to authenticated
  using ((select auth.uid()) = '5669dd9d-cb7f-48cc-83c7-82a95e1a7c5b')
  with check ((select auth.uid()) = '5669dd9d-cb7f-48cc-83c7-82a95e1a7c5b');

create policy "Owner delete lists" on public.lists
  for delete to authenticated
  using ((select auth.uid()) = '5669dd9d-cb7f-48cc-83c7-82a95e1a7c5b');

-- ---------- мелочь из Security Advisor ----------
alter function public.set_updated_at() set search_path = '';
