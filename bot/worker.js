// Telegram-бот коллекции для Cloudflare Workers.
//
// Переменные окружения (Settings → Variables and Secrets):
//   BOT_TOKEN       — секрет, токен от @BotFather
//   WEBHOOK_SECRET  — секрет, любая длинная случайная строка (A-Z, a-z, 0-9, _ и -)
//   APP_URL         — текст, адрес сайта (по умолчанию GitHub Pages)
//   MINIAPP_URL     — текст, прямая ссылка на Mini App https://t.me/<бот>/<app> (необязательно)
//
// Маршруты:
//   POST /webhook             — сюда Telegram присылает сообщения
//   GET  /setup?key=SECRET    — один раз после деплоя: вебхук, кнопка меню, команды
//   GET  /f/42                — страница-превью фильма: в Telegram и других мессенджерах
//                               ссылка показывается с постером, оценкой и отзывом
//   GET  /c/handle            — то же для коллекции

const DEFAULT_APP_URL = 'https://h0usehome.github.io/top_films_by_me/';
// Публичные адрес и ключ Supabase (те же, что в config.js сайта)
const SUPABASE_URL = 'https://ktacbvcwsyajpeacdmwt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0YWNidmN3c3lhanBlYWNkbXd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NjM4NDgsImV4cCI6MjEwMDEzOTg0OH0.OhjANu7A7Wb7GUsBjVzrvjkGJlgVsehSf6EyC1DMxR8';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (request.method === 'POST' && url.pathname === '/webhook') {
            // Telegram подписывает каждый запрос секретом, указанным в setWebhook
            if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
                return new Response('Forbidden', { status: 403 });
            }
            const update = await request.json();
            // Отвечаем Telegram сразу, а сообщение отправляем в фоне
            ctx.waitUntil(handleUpdate(update, env).catch(err => console.error(err)));
            return new Response('ok');
        }

        if (request.method === 'GET' && url.pathname === '/setup') {
            if (!env.WEBHOOK_SECRET || url.searchParams.get('key') !== env.WEBHOOK_SECRET) {
                return new Response('Forbidden', { status: 403 });
            }
            try {
                return Response.json(await setup(env, `${url.origin}/webhook`));
            } catch (err) {
                return Response.json({ error: err.message }, { status: 500 });
            }
        }

        if (request.method === 'GET') {
            const film = url.pathname.match(/^\/f\/(\d+)\/?$/);
            const collection = url.pathname.match(/^\/c\/([a-z0-9_]{3,32})\/?$/i);
            try {
                if (film) return previewPage(env, await filmPreview(env, film[1]));
                if (collection) return previewPage(env, await collectionPreview(env, collection[1].toLowerCase()));
            } catch (err) {
                console.error(err);
                return Response.redirect(appUrl(env), 302);
            }
        }

        return new Response('Бот коллекции фильмов работает.', {
            headers: { 'content-type': 'text/plain; charset=utf-8' }
        });
    }
};

async function handleUpdate(update, env) {
    const message = update.message;
    // Кнопки web_app в сообщениях работают только в личных чатах с ботом
    if (!message || message.chat.type !== 'private') return;

    const text = message.text || '';
    if (text.startsWith('/start')) {
        await sendWelcome(env, message.chat.id, message.from, text.split(' ')[1]);
    } else {
        await tg(env, 'sendMessage', {
            chat_id: message.chat.id,
            text: 'Коллекция открывается кнопкой ниже 👇',
            reply_markup: openAppKeyboard(appUrl(env))
        });
    }
}

// /start film_42, /start u_handle или /start view_top100 — сразу открыть фильм, коллекцию или раздел
function appUrlFor(env, payload) {
    const base = appUrl(env);
    const film = payload && payload.match(/^film_(\d+)$/);
    const user = payload && payload.match(/^u_([a-z0-9_]{3,32})$/i);
    const view = payload && payload.match(/^view_([a-z0-9]+)$/);
    if (film) return `${base}?film=${film[1]}`;
    if (user) return `${base}?u=${user[1].toLowerCase()}`;
    if (view) return `${base}?view=${view[1]}`;
    return base;
}

async function sendWelcome(env, chatId, from, payload) {
    const name = escapeHtml(from?.first_name || 'друг');
    const shared = /^(film|u)_/.test(payload || '');
    const caption = shared
        ? `Привет, ${name}! 👋\n\nТобой поделились находкой из коллекции фильмов. Жми кнопку ниже, чтобы посмотреть 🍿`
        : `Привет, ${name}! 👋\n\n` +
          `Здесь можно собрать свою коллекцию фильмов, сериалов и мультфильмов: оценки, отзывы, трейлеры и личный <b>ТОП-100</b>.\n\n` +
          `Регистрироваться не нужно — аккаунт создаётся автоматически. Делись карточками с друзьями: зажми фильм и нажми «Поделиться».\n\n` +
          `Жми кнопку ниже 🍿`;
    const keyboard = openAppKeyboard(appUrlFor(env, payload), shared ? '🍿 Открыть' : '🎬 Открыть коллекцию');
    const photo = new URL('og-image.png', appUrl(env)).href;

    try {
        await tg(env, 'sendPhoto', { chat_id: chatId, photo, caption, parse_mode: 'HTML', reply_markup: keyboard });
    } catch (err) {
        // Если картинку загрузить не удалось, отправляем просто текст
        console.error(err);
        await tg(env, 'sendMessage', { chat_id: chatId, text: caption, parse_mode: 'HTML', reply_markup: keyboard });
    }
}

function openAppKeyboard(url, text = '🎬 Открыть коллекцию') {
    return { inline_keyboard: [[{ text, web_app: { url } }]] };
}

async function setup(env, webhookUrl) {
    const url = appUrl(env);
    return {
        webhook: await tg(env, 'setWebhook', {
            url: webhookUrl,
            secret_token: env.WEBHOOK_SECRET,
            allowed_updates: ['message'],
            drop_pending_updates: true
        }),
        menuButton: await tg(env, 'setChatMenuButton', {
            menu_button: { type: 'web_app', text: 'Коллекция', web_app: { url } }
        }),
        commands: await tg(env, 'setMyCommands', {
            commands: [{ command: 'start', description: 'Открыть коллекцию' }]
        }),
        description: await tg(env, 'setMyDescription', {
            description: 'Своя коллекция фильмов, сериалов и мультфильмов: оценки, отзывы, трейлеры и ТОП-100. Без регистрации — просто открой и добавляй.'
        }),
        shortDescription: await tg(env, 'setMyShortDescription', {
            short_description: 'Своя коллекция фильмов с оценками и трейлерами 🎬'
        })
    };
}

function appUrl(env) {
    const url = env.APP_URL || DEFAULT_APP_URL;
    return url.endsWith('/') ? url : `${url}/`;
}

async function tg(env, method, body) {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`${method}: ${data.description}`);
    return data.result;
}

function escapeHtml(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- Страницы-превью для ссылок ----------
// Telegram, WhatsApp и другие читают теги og:* и показывают карточку с картинкой.
// Человека страница сразу перенаправляет на сайт (или в Mini App).

const TYPE_NAMES = { movies: 'Фильм', series: 'Сериал', cartoons: 'Мультфильм' };

async function supabase(path) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        cf: { cacheTtl: 300, cacheEverything: true }
    });
    if (!res.ok) throw new Error(`Supabase: ${res.status}`);
    return res.json();
}

function cut(text, max) {
    const clean = String(text || '').replace(/\[img\].*?\[\/img\]/gi, '').replace(/\s+/g, ' ').trim();
    return clean.length > max ? clean.slice(0, max).replace(/\s+\S*$/, '') + '…' : clean;
}

function posterUrl(url) {
    const src = String(url || '').trim();
    const drive = src.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([\w-]+)/);
    if (drive) return `https://lh3.googleusercontent.com/d/${drive[1]}`;
    if (/image\.tmdb\.org\/t\/p\//.test(src)) return src.replace(/\/t\/p\/[^/]+\//, '/t/p/w780/');
    return src;
}

function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
}

const collectionName = (p) => p?.title || (p?.display_name ? `Коллекция ${p.display_name}` : 'Коллекция фильмов');

async function filmPreview(env, id) {
    const [film] = await supabase(`collection?select=id,type,title,poster,year,rating,genres,toprank,review,description,owner_id&id=eq.${id}`);
    if (!film) return null;
    const [owner] = await supabase(`profiles?select=handle,display_name,title&id=eq.${film.owner_id}`);
    const rating = film.rating !== null && film.rating !== undefined ? `★ ${film.rating}/10` : '';
    const genres = String(film.genres || '').split(',').map(g => g.trim()).filter(Boolean).slice(0, 3).join(', ');
    const review = cut(film.review, 200);
    return {
        title: `${film.title}${film.year ? ` (${film.year})` : ''}${rating ? ` — ${rating}` : ''}`,
        description: [
            [TYPE_NAMES[film.type], genres, film.toprank > 0 && film.toprank <= 100 ? `№${film.toprank} в ТОП-100` : ''].filter(Boolean).join(' · '),
            review ? `«${review}»` : cut(film.description, 200)
        ].filter(Boolean).join('\n'),
        image: posterUrl(film.poster) || new URL('og-image.png', appUrl(env)).href,
        siteName: collectionName(owner),
        url: `${appUrl(env)}?${owner?.handle ? `u=${owner.handle}&` : ''}film=${film.id}`,
        startParam: `film_${film.id}`
    };
}

async function collectionPreview(env, handle) {
    const [owner] = await supabase(`profiles?select=id,handle,display_name,title&handle=eq.${handle}`);
    if (!owner) return null;
    const rows = await supabase(`collection?select=title,rating&owner_id=eq.${owner.id}&order=rating.desc.nullslast&limit=500`);
    const best = rows.slice(0, 3).map(r => r.title).join(', ');
    return {
        title: `🍿 ${collectionName(owner)}`,
        description: `${rows.length} ${plural(rows.length, 'запись', 'записи', 'записей')}: фильмы, сериалы и мультфильмы с оценками и отзывами.${best ? ` Лучшее: ${best}.` : ''}`,
        image: new URL('og-image.png', appUrl(env)).href,
        siteName: 'MY COLLECTION',
        url: `${appUrl(env)}?u=${owner.handle}`,
        startParam: `u_${owner.handle}`
    };
}

function previewPage(env, p) {
    if (!p) return Response.redirect(appUrl(env), 302);
    // Во встроенном браузере Telegram сразу открываем Mini App, остальным — сайт
    const target = env.MINIAPP_URL ? `${env.MINIAPP_URL.replace(/\/+$/, '')}?startapp=${p.startParam}` : p.url;
    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(p.title)}</title>
<meta name="description" content="${escapeHtml(p.description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(p.siteName)}">
<meta property="og:title" content="${escapeHtml(p.title)}">
<meta property="og:description" content="${escapeHtml(p.description)}">
<meta property="og:image" content="${escapeHtml(p.image)}">
<meta property="og:url" content="${escapeHtml(p.url)}">
<meta property="og:locale" content="ru_RU">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0f0f13">
<meta http-equiv="refresh" content="0;url=${escapeHtml(p.url)}">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f0f13;color:#fff;font:16px system-ui,sans-serif}a{color:#e50914}</style>
</head>
<body>
<p>Открываем… <a href="${escapeHtml(p.url)}">${escapeHtml(p.title)}</a></p>
<script>
var miniApp = ${JSON.stringify(target)};
location.replace(/Telegram/i.test(navigator.userAgent) ? miniApp : ${JSON.stringify(p.url)});
</script>
</body>
</html>`;
    return new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' }
    });
}
