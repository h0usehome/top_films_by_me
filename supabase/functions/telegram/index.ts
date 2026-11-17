// Edge Function «telegram»: вход из Telegram Mini App и карточки для «Поделиться».
//
// POST { action: 'auth',  initData }          → сессия Supabase + профиль
// POST { action: 'share', initData, filmId }  → id подготовленного сообщения для Telegram.WebApp.shareMessage
//
// Подлинность пользователя проверяется подписью initData (HMAC токеном бота),
// поэтому проверка JWT у функции выключена.
//
// Секреты (Supabase → Edge Functions → Secrets):
//   TELEGRAM_BOT_TOKEN  — токен от @BotFather (обязательно)
//   TELEGRAM_APP_URL    — прямая ссылка на Mini App вида https://t.me/<бот>/<app> (необязательно;
//                         без неё кнопки ведут на https://t.me/<бот>?start=…)
// SUPABASE_URL, SUPABASE_ANON_KEY и SUPABASE_SERVICE_ROLE_KEY Supabase задаёт сам.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const APP_URL = (Deno.env.get('TELEGRAM_APP_URL') ?? '').replace(/\/+$/, '');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INIT_DATA_TTL = 24 * 60 * 60; // initData старше суток не принимаем

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    try {
        if (!BOT_TOKEN) throw new HttpError(500, 'TELEGRAM_BOT_TOKEN не задан в секретах функции');
        const body = await req.json().catch(() => ({}));
        const tgUser = await verifyInitData(String(body.initData ?? ''));

        if (body.action === 'auth') return json(await auth(tgUser));
        if (body.action === 'share') return json(await prepareShare(tgUser, Number(body.filmId)));
        throw new HttpError(400, 'Неизвестное действие');
    } catch (err) {
        const status = err instanceof HttpError ? err.status : 500;
        console.error(err);
        return json({ error: err instanceof Error ? err.message : String(err) }, status);
    }
});

// ---------- Проверка initData ----------
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

type TgUser = { id: number; first_name?: string; last_name?: string; username?: string; photo_url?: string };

async function hmac(key: ArrayBuffer | Uint8Array, data: string) {
    const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data));
}

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

async function verifyInitData(initData: string): Promise<TgUser> {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) throw new HttpError(401, 'Нет подписи Telegram');
    params.delete('hash');

    const checkString = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = await hmac(new TextEncoder().encode('WebAppData'), BOT_TOKEN);
    if (toHex(await hmac(secret, checkString)) !== hash) throw new HttpError(401, 'Неверная подпись Telegram');

    const authDate = Number(params.get('auth_date'));
    if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_TTL) throw new HttpError(401, 'Сессия Telegram устарела, перезапустите приложение');

    const user = JSON.parse(params.get('user') || 'null');
    if (!user?.id) throw new HttpError(401, 'Нет данных пользователя');
    return user;
}

// ---------- Вход ----------

const PROFILE_FIELDS = 'id, handle, display_name, title, avatar_url';

async function auth(tg: TgUser) {
    const name = [tg.first_name, tg.last_name].filter(Boolean).join(' ').slice(0, 64) || null;
    let { data: profile } = await admin.from('profiles').select(PROFILE_FIELDS).eq('tg_id', tg.id).maybeSingle();

    let email: string;
    if (profile) {
        const { data, error } = await admin.auth.admin.getUserById(profile.id);
        if (error || !data.user?.email) throw new HttpError(500, 'Аккаунт не найден');
        email = data.user.email;
        // Аватар и имя подтягиваем из Telegram, если человек не задал своё
        const patch: Record<string, string> = {};
        if (tg.photo_url && tg.photo_url !== profile.avatar_url) patch.avatar_url = tg.photo_url;
        if (!profile.display_name && name) patch.display_name = name;
        if (Object.keys(patch).length) {
            await admin.from('profiles').update(patch).eq('id', profile.id);
            profile = { ...profile, ...patch };
        }
    } else {
        email = `tg${tg.id}@telegram.user`;
        const { data, error } = await admin.auth.admin.createUser({
            email, email_confirm: true, user_metadata: { tg_id: tg.id, name }
        });
        if (error || !data.user) throw new HttpError(500, `Не удалось создать аккаунт: ${error?.message}`);
        const handle = await freeHandle(tg.username);
        const row = { id: data.user.id, tg_id: tg.id, handle, display_name: name, avatar_url: tg.photo_url ?? null };
        const { error: insertError } = await admin.from('profiles').insert(row);
        if (insertError) throw new HttpError(500, `Не удалось создать профиль: ${insertError.message}`);
        profile = { id: row.id, handle, display_name: name, title: null, avatar_url: row.avatar_url };
    }

    // Сессию выдаём через одноразовую ссылку входа: письмо при этом не отправляется
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (linkError) throw new HttpError(500, linkError.message);
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: otp, error: otpError } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
    if (otpError || !otp.session) throw new HttpError(500, otpError?.message ?? 'Не удалось выдать сессию');

    const { access_token, refresh_token, expires_at } = otp.session;
    return { access_token, refresh_token, expires_at, profile, app_link: await appLink() };
}

// Адрес коллекции: ник в Telegram, если свободен, иначе случайный
async function freeHandle(username?: string) {
    const nick = (username || '').toLowerCase();
    if (/^[a-z0-9_]{3,32}$/.test(nick)) {
        const { data } = await admin.from('profiles').select('id').eq('handle', nick).maybeSingle();
        if (!data) return nick;
    }
    for (;;) {
        const candidate = 'id' + crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
        const { data } = await admin.from('profiles').select('id').eq('handle', candidate).maybeSingle();
        if (!data) return candidate;
    }
}

// ---------- Ссылки на приложение ----------

let botUsername: string | null = null;

async function appLink() {
    if (APP_URL) return { base: APP_URL, param: 'startapp' };
    if (!botUsername) botUsername = (await tgApi('getMe', {})).username;
    return { base: `https://t.me/${botUsername}`, param: 'start' };
}

async function startLink(payload: string) {
    const { base, param } = await appLink();
    return `${base}?${param}=${encodeURIComponent(payload)}`;
}

// ---------- Поделиться ----------

const TYPE_NAMES: Record<string, string> = { movies: 'Фильм', series: 'Сериал', cartoons: 'Мультфильм' };
const TYPE_EMOJI: Record<string, string> = { movies: '🎬', series: '📺', cartoons: '🧸' };

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cut(text: string, max: number) {
    const clean = text.replace(/\[img\].*?\[\/img\]/gi, '').replace(/\s+/g, ' ').trim();
    return clean.length > max ? clean.slice(0, max).replace(/\s+\S*$/, '') + '…' : clean;
}

// Постеры TMDB уменьшаем до разумного размера, ссылки Google Drive делаем прямыми
function posterUrl(url: string | null, size: 'w500' | 'w185') {
    const src = String(url || '').trim();
    const drive = src.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([\w-]+)/);
    if (drive) return `https://lh3.googleusercontent.com/d/${drive[1]}`;
    if (/image\.tmdb\.org\/t\/p\//.test(src)) return src.replace(/\/t\/p\/[^/]+\//, `/t/p/${size}/`);
    return src;
}

async function prepareShare(tg: TgUser, filmId: number) {
    if (!Number.isFinite(filmId)) throw new HttpError(400, 'Не указан фильм');
    const { data: film } = await admin.from('collection')
        .select('id, type, title, poster, year, rating, genres, toprank, review, description, owner_id')
        .eq('id', filmId).maybeSingle();
    if (!film) throw new HttpError(404, 'Фильм не найден');
    const { data: owner } = await admin.from('profiles').select('handle, display_name, title').eq('id', film.owner_id).maybeSingle();

    const meta = [
        film.rating !== null && film.rating !== undefined ? `⭐ <b>${esc(film.rating)}/10</b>` : '',
        esc(TYPE_NAMES[film.type] || ''),
        esc(String(film.genres || '').split(',').map((g: string) => g.trim()).filter(Boolean).slice(0, 3).join(', '))
    ].filter(Boolean).join(' · ');

    const review = cut(film.review || '', 280);
    const about = review ? '' : cut(film.description || '', 200);
    const collection = owner?.title || (owner?.display_name ? `Коллекция ${owner.display_name}` : 'Моя коллекция');

    const caption = [
        `${TYPE_EMOJI[film.type] || '🎬'} <b>${esc(film.title)}</b>${film.year ? ` (${esc(film.year)})` : ''}`,
        meta,
        film.toprank > 0 && film.toprank <= 100 ? `🏆 №${film.toprank} в ТОП-100` : '',
        review ? `\n<blockquote expandable>💬 ${esc(review)}</blockquote>` : about ? `\n<i>${esc(about)}</i>` : '',
        `\n🍿 ${esc(collection)}`
    ].filter(Boolean).join('\n');

    const button = { text: '🍿 Открыть карточку', url: await startLink(`film_${film.id}`) };
    const keyboard = { inline_keyboard: [[button]] };
    const photo = posterUrl(film.poster, 'w500');

    const result = photo
        ? {
            type: 'photo', id: `film_${film.id}`,
            photo_url: photo, thumbnail_url: posterUrl(film.poster, 'w185'),
            title: film.title, caption, parse_mode: 'HTML', reply_markup: keyboard
        }
        : {
            type: 'article', id: `film_${film.id}`, title: film.title,
            input_message_content: { message_text: caption, parse_mode: 'HTML' }, reply_markup: keyboard
        };

    const prepared = await tgApi('savePreparedInlineMessage', {
        user_id: tg.id, result,
        allow_user_chats: true, allow_bot_chats: true, allow_group_chats: true, allow_channel_chats: true
    });
    return { id: prepared.id, link: button.url };
}

async function tgApi(method: string, body: unknown) {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!data.ok) throw new HttpError(502, `Telegram ${method}: ${data.description}`);
    return data.result;
}
