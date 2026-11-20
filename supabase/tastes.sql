-- =====================================================================
-- Интересы пользователя («пузырьки» при первом входе): по ним строятся
-- рекомендации, пока оценок мало. Нет строки — пользователь ещё не выбирал
-- и увидит экран выбора; пустой массив — нажал «Пропустить».
-- Видит и меняет только сам пользователь. Скрипт можно запускать повторно.
-- =====================================================================

create table if not exists public.profile_tastes (
  profile_id uuid primary key references public.profiles (id) on delete cascade default auth.uid(),
  tags text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.profile_tastes enable row level security;

drop policy if exists "Own tastes read"   on public.profile_tastes;
drop policy if exists "Own tastes insert" on public.profile_tastes;
drop policy if exists "Own tastes update" on public.profile_tastes;

create policy "Own tastes read" on public.profile_tastes
  for select to authenticated using ((select auth.uid()) = profile_id);
create policy "Own tastes insert" on public.profile_tastes
  for insert to authenticated with check ((select auth.uid()) = profile_id);
create policy "Own tastes update" on public.profile_tastes
  for update to authenticated using ((select auth.uid()) = profile_id) with check ((select auth.uid()) = profile_id);

revoke all on public.profile_tastes from anon;
grant select, insert, update on public.profile_tastes to authenticated;

alter table public.profile_tastes drop constraint if exists profile_tastes_tags_limit;
alter table public.profile_tastes add constraint profile_tastes_tags_limit check (cardinality(tags) <= 60);
