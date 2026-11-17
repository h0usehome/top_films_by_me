// Публичные ключи: защиту данных обеспечивает RLS в Supabase (supabase/rls.sql, supabase/multiuser.sql)
const SUPABASE_URL = 'https://ktacbvcwsyajpeacdmwt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0YWNidmN3c3lhanBlYWNkbXd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NjM4NDgsImV4cCI6MjEwMDEzOTg0OH0.OhjANu7A7Wb7GUsBjVzrvjkGJlgVsehSf6EyC1DMxR8';
const TMDB_API_KEY = '3a3430d210cbf6ae4ee54b1ffc523ddd';

// Чья коллекция открывается на сайте без ?u=… (вне Telegram или до входа)
const DEFAULT_HANDLE = 'h0usehome';

// Edge Function: вход из Telegram и карточки для «Поделиться» (supabase/functions/telegram)
const TG_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/telegram`;

// Адрес бота — для кнопки «Создать свою коллекцию» вне Telegram. Пусто — кнопка скрыта.
// Пример: 'https://t.me/myH0usecollection_bot'
const TG_BOT_URL = 'https://t.me/myH0usecollection_bot';

// Адрес Cloudflare Worker из bot/ — даёт ссылкам красивое превью с постером
// (https://<worker>/f/42). Пусто — делимся обычной ссылкой на сайт.
// Пример: 'https://mycollection.pinashin-official.workers.dev'
const SHARE_BASE = 'https://mycollection.pinashin-official.workers.dev';

// Клиент supabase-js нужен только админке; витрина обходится обычным fetch
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
