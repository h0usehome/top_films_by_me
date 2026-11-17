// Telegram-бот коллекции для Cloudflare Workers.
//
// Переменные окружения (Settings → Variables and Secrets):
//   BOT_TOKEN       — секрет, токен от @BotFather
//   WEBHOOK_SECRET  — секрет, любая длинная случайная строка (A-Z, a-z, 0-9, _ и -)
//   APP_URL         — текст, адрес сайта (по умолчанию GitHub Pages)
//
// Маршруты:
//   POST /webhook             — сюда Telegram присылает сообщения (подойдёт и любой другой путь)
//   GET  /setup?key=SECRET    — один раз после деплоя: вебхук, кнопка меню, команды

const DEFAULT_APP_URL = 'https://h0usehome.github.io/top_films_by_me/';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (request.method === 'POST') {
            // Telegram подписывает каждый запрос секретом, указанным в setWebhook.
            // Если вебхук настроен не через /setup, секрета не будет — откройте /setup
            if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
                return new Response('Forbidden: откройте /setup?key=WEBHOOK_SECRET', { status: 403 });
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

// /start film_42 или /start view_top100 — сразу открыть нужный фильм или раздел
function appUrlFor(env, payload) {
    const base = appUrl(env);
    const film = payload && payload.match(/^film_(\d+)$/);
    const view = payload && payload.match(/^view_([a-z0-9]+)$/);
    if (film) return `${base}?film=${film[1]}`;
    if (view) return `${base}?view=${view[1]}`;
    return base;
}

async function sendWelcome(env, chatId, from, payload) {
    const name = escapeHtml(from?.first_name || 'друг');
    const caption =
        `Привет, ${name}! 👋\n\n` +
        `Это моя коллекция фильмов, сериалов и мультфильмов: оценки, отзывы, трейлеры и личный <b>ТОП-100</b>.\n\n` +
        `Жми кнопку ниже, чтобы открыть 🍿`;
    const keyboard = openAppKeyboard(appUrlFor(env, payload));
    const photo = new URL('og-image.png', appUrl(env)).href;

    try {
        await tg(env, 'sendPhoto', { chat_id: chatId, photo, caption, parse_mode: 'HTML', reply_markup: keyboard });
    } catch (err) {
        // Если картинку загрузить не удалось, отправляем просто текст
        console.error(err);
        await tg(env, 'sendMessage', { chat_id: chatId, text: caption, parse_mode: 'HTML', reply_markup: keyboard });
    }
}

function openAppKeyboard(url) {
    return { inline_keyboard: [[{ text: '🎬 Открыть коллекцию', web_app: { url } }]] };
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
            description: 'Личная коллекция фильмов, сериалов и мультфильмов: оценки, отзывы, трейлеры и ТОП-100.'
        }),
        shortDescription: await tg(env, 'setMyShortDescription', {
            short_description: 'Моя коллекция фильмов с оценками и трейлерами 🎬'
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
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
