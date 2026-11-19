-- =====================================================================
-- id фильма в TMDB у записей: по нему строятся рекомендации («похожие
-- на то, что вам понравилось») и видно, что фильм уже есть в коллекции.
-- У старых записей заполняется само, когда владелец открывает рекомендации.
-- Скрипт можно запускать повторно.
-- =====================================================================

alter table public.collection add column if not exists tmdb_id integer;
alter table public.collection add column if not exists tmdb_type text;

alter table public.collection drop constraint if exists collection_tmdb_type_check;
alter table public.collection
  add constraint collection_tmdb_type_check check (tmdb_type is null or tmdb_type in ('movie', 'tv'));

create index if not exists collection_owner_tmdb_idx on public.collection (owner_id, tmdb_type, tmdb_id);
