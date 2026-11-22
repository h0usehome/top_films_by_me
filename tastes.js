// Интересы пользователя — «пузырьки» с темами при первом входе.
// По ним строятся рекомендации, пока оценок мало (discover.js), и ряды
// «Вы любите: …». Хранятся в таблице profile_tastes (supabase/tastes.sql):
// нет строки — экран выбора ещё не показывали, пустой список — «Пропустить».
//
// Тема описывается фильтрами TMDB discover. Ключевые слова заданы английскими
// названиями TMDB и находятся по точному совпадению через search/keyword —
// найденные id запоминаются на устройстве.

const TASTE_GROUPS = [
    ['genres', 'Жанры'],
    ['themes', 'Темы'],
    ['origin', 'Откуда и когда'],
    ['format', 'Формат']
];

const THIS_YEAR = new Date().getFullYear();

// mt: где искать (фильмы, сериалы или оба); genres — все сразу, anyGenres — любой из;
// keywords — любое из ключевых слов; minVotes — порог известности для ряда
const TASTE_TAGS = [
    { id: 'comedy', group: 'genres', label: '😂 Комедии', genres: [35] },
    { id: 'drama', group: 'genres', label: '🎭 Драмы', genres: [18] },
    { id: 'horror', group: 'genres', label: '👻 Ужастики', genres: [27] },

    { id: 'superhero', group: 'themes', label: '🦸 Супергероика', keywords: ['superhero', 'based on comic'] },
    { id: 'love', group: 'themes', label: '💘 Про любовь', genres: [10749] },
    { id: 'space', group: 'themes', label: '🚀 Космос', keywords: ['space', 'outer space', 'space travel', 'astronaut'] },
    { id: 'heist', group: 'themes', label: '💰 Ограбления', keywords: ['heist', 'bank robbery'] },
    { id: 'timetravel', group: 'themes', label: '⏳ Путешествия во времени', keywords: ['time travel', 'time loop'] },
    { id: 'zombie', group: 'themes', label: '🧟 Зомби', keywords: ['zombie', 'zombie apocalypse'] },
    { id: 'apocalypse', group: 'themes', label: '☢️ Апокалипсис', keywords: ['post-apocalyptic future', 'dystopia', 'apocalypse'] },
    { id: 'truestory', group: 'themes', label: '📜 На реальных событиях', keywords: ['based on true story', 'biography'] },
    { id: 'sport', group: 'themes', label: '⚽ Спорт', keywords: ['sports', 'sport', 'boxing', 'football (soccer)'] },
    { id: 'mafia', group: 'themes', label: '🔫 Мафия и гангстеры', keywords: ['mafia', 'gangster', 'organized crime'] },
    { id: 'magic', group: 'themes', label: '🪄 Магия и волшебство', keywords: ['magic', 'wizard', 'witch'], fallbackGenres: [14] },
    { id: 'spy', group: 'themes', label: '🕵️ Шпионы', keywords: ['spy', 'espionage', 'secret agent'] },
    { id: 'maniac', group: 'themes', label: '🔪 Маньяки', keywords: ['serial killer'] },
    { id: 'vampire', group: 'themes', label: '🧛 Вампиры', keywords: ['vampire'] },
    { id: 'ai', group: 'themes', label: '🤖 Роботы и ИИ', keywords: ['artificial intelligence (a.i.)', 'robot', 'android'] },
    { id: 'survival', group: 'themes', label: '🏝 Выживание', keywords: ['survival', 'stranded'] },
    { id: 'school', group: 'themes', label: '🎒 Школа и взросление', keywords: ['high school', 'coming of age'] },
    { id: 'prison', group: 'themes', label: '⛓ Тюрьма и побег', keywords: ['prison', 'prison escape'] },
    { id: 'pirates', group: 'themes', label: '🏴‍☠️ Пираты', keywords: ['pirate'] },
    { id: 'dinosaurs', group: 'themes', label: '🦖 Динозавры', keywords: ['dinosaur'] },
    { id: 'martial', group: 'themes', label: '🥋 Боевые искусства', keywords: ['martial arts', 'kung fu'] },
    { id: 'ww2', group: 'themes', label: '🪖 Вторая мировая', keywords: ['world war ii'] },
    { id: 'medieval', group: 'themes', label: '🏰 Средневековье', keywords: ['medieval', 'knight'] },
    { id: 'cyberpunk', group: 'themes', label: '🌃 Киберпанк', keywords: ['cyberpunk'] },
    { id: 'whodunit', group: 'themes', label: '🔎 Детективные загадки', keywords: ['whodunit', 'murder mystery'] },
    { id: 'twist', group: 'themes', label: '🌀 Неожиданный финал', keywords: ['plot twist', 'twist ending'] },
    { id: 'roadtrip', group: 'themes', label: '🚗 Роуд-муви', keywords: ['road trip', 'road movie'] },
    { id: 'aliens', group: 'themes', label: '👽 Пришельцы', keywords: ['alien', 'alien invasion', 'extraterrestrial'] },
    { id: 'christmas', group: 'themes', label: '🎄 Новый год и Рождество', keywords: ['christmas', 'new year\'s eve'] },
    { id: 'music', group: 'themes', label: '🎸 Про музыку', keywords: ['musician', 'rock band', 'band'], fallbackGenres: [10402] },
    { id: 'disaster', group: 'themes', label: '🌋 Катастрофы', keywords: ['disaster', 'natural disaster'] },

    { id: 'russian', group: 'origin', label: '🪆 Русское', lang: 'ru', mt: ['movie', 'tv'], minVotes: 30 },
    { id: 'korean', group: 'origin', label: '🫰 Корейское', lang: 'ko', mt: ['movie', 'tv'], minVotes: 50 },
    { id: 'french', group: 'origin', label: '🥐 Французское', lang: 'fr', minVotes: 80 },
    { id: 'anime', group: 'origin', label: '🍥 Аниме', lang: 'ja', genres: [16], mt: ['tv', 'movie'], minVotes: 50 },
    { id: 'oldies', group: 'origin', label: '📼 Старое кино', to: '1985-12-31' },
    { id: 'nineties', group: 'origin', label: '💿 90-е и нулевые', from: '1990-01-01', to: '2009-12-31' },
    { id: 'tens', group: 'origin', label: '📱 Кино 2010-х', from: '2010-01-01', to: '2019-12-31' },
    { id: 'new', group: 'origin', label: '🆕 Новинки', from: `${THIS_YEAR - 1}-01-01`, sort: 'popularity.desc', minVotes: 80 },

    { id: 'cartoons', group: 'format', label: '🧸 Мультфильмы', genres: [16], notLang: 'ja' },
    { id: 'short', group: 'format', label: '⏱ До полутора часов', runtimeMax: 95 },
    { id: 'miniseries', group: 'format', label: '📺 Мини-сериалы', mt: ['tv'], tvType: 2, minVotes: 80 }
];

const TASTE_MIN = 3;
const KEYWORD_CACHE = 'tmdb-keywords-v1';

const TASTES_CACHE = 'tastes-v1';
const tastes = { owner: null, state: 'unknown', tags: [], promise: null };
let tasteDraft = new Set();

const tagById = (id) => TASTE_TAGS.find(t => t.id === id);
const tagTitle = (tag) => tag.label.replace(/^\S+\s/, ''); // без эмодзи
const myTasteTags = () => tastes.tags.map(tagById).filter(Boolean);

// ---------- Загрузка и сохранение ----------

// unknown → загружаем; missing → показать выбор; set → выбраны (или пропущено);
// unavailable → таблицы ещё нет или нет входа — работаем без интересов
// С прошлого раза интересы помним на устройстве — экран не ждёт сети,
// а свежие данные подтягиваются в фоне
function tasteState() {
    if (!me || !isMine()) return 'unavailable';
    if (tastes.owner !== me.id) {
        Object.assign(tastes, { owner: me.id, state: 'unknown', tags: [], promise: null });
        try {
            const cached = JSON.parse(localStorage.getItem(`${TASTES_CACHE}:${me.id}`));
            if (cached && (cached.state === 'set' || cached.state === 'missing')) {
                Object.assign(tastes, { state: cached.state, tags: (cached.tags || []).filter(tagById) });
                setTimeout(() => ensureTastes(true), 0);
            }
        } catch { /* нет сохранённых */ }
    }
    return tastes.state;
}

function rememberTastes() {
    try { localStorage.setItem(`${TASTES_CACHE}:${tastes.owner}`, JSON.stringify({ state: tastes.state, tags: tastes.tags })); } catch { /* недоступно */ }
}

function ensureTastes(refresh = false) {
    if (!refresh && tasteState() !== 'unknown') return Promise.resolve(tastes.state);
    if (tastes.promise) return tastes.promise;
    const before = `${tastes.state}:${tastes.tags.join(',')}`;
    const owner = me.id;
    tastes.promise = (async () => {
        try {
            const token = await myToken();
            if (!token) throw new Error('нет входа');
            const res = await fetch(`${SUPABASE_URL}/rest/v1/profile_tastes?select=tags&profile_id=eq.${encodeURIComponent(owner)}`, {
                headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const [row] = await res.json();
            if (tastes.owner !== owner) return tastes.state;
            tastes.tags = row ? (row.tags || []).filter(tagById) : [];
            tastes.state = row ? 'set' : 'missing';
            rememberTastes();
            // Изменились на другом устройстве — перерисуем
            if (refresh && before !== `${tastes.state}:${tastes.tags.join(',')}`) { recsMemo = null; rerenderView(); }
        } catch (err) {
            console.warn('Интересы недоступны:', err.message);
            if (tastes.owner === owner && !refresh) tastes.state = 'unavailable';
        } finally {
            tastes.promise = null;
        }
        return tastes.state;
    })();
    return tastes.promise;
}

async function saveTastes(tags) {
    const token = await myToken();
    if (!token) throw new Error('нужно войти через Telegram');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profile_tastes?on_conflict=profile_id`, {
        method: 'POST',
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({ profile_id: me.id, tags, updated_at: new Date().toISOString() })
    });
    if (!res.ok) throw new Error(`ошибка сервера ${res.status}`);
    tastes.tags = tags;
    tastes.state = 'set';
    rememberTastes();
    recsMemo = null;
}

// ---------- Экран выбора ----------

function renderTastes(first) {
    const grid = $('contentGrid');
    grid.className = 'tastes';
    if (!isMine()) { grid.innerHTML = needOwnCollectionHtml(); return; }
    if (tasteState() === 'unknown') {
        grid.innerHTML = `<div class="grid">${dcSkeleton(4)}</div>`;
        ensureTastes().then(rerenderView);
        return;
    }
    if (tasteState() === 'unavailable') {
        grid.innerHTML = '<div class="empty-state">Выбор интересов пока недоступен.</div>';
        return;
    }
    tasteDraft = new Set(tastes.tags);
    grid.innerHTML = `
        <section class="dc-hero">
            <h2>${first ? '👋 Что вам интересно?' : '🏷 Мои интересы'}</h2>
            <p>Выберите темы, которые любите${first ? ` — хотя бы ${TASTE_MIN}` : ''}. По ним подберём фильмы и сериалы, а когда появятся оценки — будем учитывать и их.</p>
        </section>
        ${TASTE_GROUPS.map(([group, title]) => `
            <section class="taste-group">
                <h3>${title}</h3>
                <div class="bubble-cloud">
                    ${TASTE_TAGS.filter(t => t.group === group).map(bubbleHtml).join('')}
                </div>
            </section>`).join('')}
        <div class="dc-bar taste-bar">
            <span id="tasteCount"></span>
            ${first ? '<button type="button" class="btn-pill" data-taste-skip>Пропустить</button>' : ''}
            <button type="button" class="btn-pill btn-pill-primary" data-taste-save>${first ? 'Дальше' : 'Сохранить'}</button>
        </div>`;
    updateTasteBar(first);
}

// Размер и небольшой сдвиг у каждого пузырька свои, но постоянные —
// облако выглядит живым и не прыгает между открытиями
function bubbleHtml(tag, index) {
    let h = 0;
    for (const ch of tag.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const [emoji, ...words] = tag.label.split(' ');
    const label = words.join(' ');
    const longest = Math.max(...words.map(w => w.length));
    // Пузырёк подбирается под самое длинное слово, чтобы слова не ломались
    const size = Math.max(h % 3, longest >= 11 ? 2 : longest >= 8 ? 1 : 0);
    const dy = ((h >>> 3) % 17) - 8;
    const dx = (h >>> 7) % 7;
    const on = tasteDraft.has(tag.id);
    return `
        <button type="button" class="bubble bubble-${size}${longest >= 13 ? ' bubble-tight' : ''}${on ? ' active' : ''}" data-taste="${tag.id}" aria-pressed="${on}"
            style="--dy: ${dy}px; --dx: ${dx}px; --delay: ${Math.min(index, 20) * 25}ms">
            <span class="bubble-emoji" aria-hidden="true">${emoji}</span>
            <span class="bubble-label">${escapeHtml(label)}</span>
        </button>`;
}

function updateTasteBar(first = state.view !== 'tastes') {
    const count = $('tasteCount');
    if (!count) return;
    const n = tasteDraft.size;
    count.textContent = n === 0 ? (first ? `Выберите от ${TASTE_MIN}` : 'Ничего не выбрано')
        : n < TASTE_MIN && first ? `Выбрано ${n} — ещё ${TASTE_MIN - n}`
        : `Выбрано ${n} ${plural(n, 'тема', 'темы', 'тем')}`;
    const save = document.querySelector('[data-taste-save]');
    if (save) save.disabled = first ? n < TASTE_MIN : false;
    // Выбрал хоть что-то — «Пропустить» уже не нужна
    const skip = document.querySelector('[data-taste-skip]');
    if (skip) skip.hidden = n > 0;
}

function rerenderView() {
    $('contentGrid').dataset.ready = '';
    renderView();
}

async function submitTastes(tags, button) {
    if (button) { button.disabled = true; button.textContent = 'Сохраняем…'; }
    try {
        await saveTastes(tags);
        window.tgApp?.HapticFeedback?.notificationOccurred?.('success');
        if (tags.length) toast('Подбираем фильмы под ваши интересы');
        if (state.view === 'tastes') go({ ...stateFromUrl(''), u: null });
        else rerenderView();
        window.scrollTo(0, 0);
    } catch (err) {
        toast(`Не получилось сохранить: ${err.message}`);
        if (button) { button.disabled = false; button.textContent = 'Сохранить'; }
    }
}

document.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-taste]');
    if (chip) {
        const id = chip.dataset.taste;
        if (tasteDraft.has(id)) tasteDraft.delete(id); else tasteDraft.add(id);
        chip.classList.toggle('active', tasteDraft.has(id));
        chip.setAttribute('aria-pressed', String(tasteDraft.has(id)));
        window.tgApp?.HapticFeedback?.selectionChanged();
        updateTasteBar();
        return;
    }
    const save = e.target.closest('[data-taste-save]');
    if (save) { submitTastes([...tasteDraft], save); return; }
    if (e.target.closest('[data-taste-skip]')) submitTastes([], null);
});

// ---------- Запросы к TMDB по темам ----------

function keywordCache() {
    try { return JSON.parse(localStorage.getItem(KEYWORD_CACHE)) || {}; } catch { return {}; }
}

// Названия ключевых слов → id TMDB (точное совпадение; 0 — не нашлось)
async function resolveKeywords(names) {
    const cache = keywordCache();
    const missing = [...new Set(names)].filter(n => !(n in cache));
    for (let i = 0; i < missing.length; i += 12) {
        const chunk = missing.slice(i, i + 12);
        const results = await tmdbBatch(chunk.map(query => ({ path: 'search/keyword', params: { query } })));
        chunk.forEach((name, idx) => {
            const exact = (results[idx]?.results || []).find(k => k.name.toLowerCase() === name.toLowerCase());
            if (!results[idx]?.error) cache[name] = exact ? exact.id : 0;
        });
    }
    try { localStorage.setItem(KEYWORD_CACHE, JSON.stringify(cache)); } catch { /* недоступно */ }
    return cache;
}

function tagRequests(tag, keywordIds, discoverType) {
    const params = { language: 'ru-RU', include_adult: 'false', sort_by: tag.sort || 'vote_count.desc' };
    const genres = [...(tag.genres || [])];
    if (tag.keywords) {
        const ids = tag.keywords.map(k => keywordIds[k]).filter(Boolean);
        if (ids.length) params.with_keywords = ids.join('|');
        else if (tag.fallbackGenres) genres.push(...tag.fallbackGenres);
        else return [];
    }
    if (tag.lang) params.with_original_language = tag.lang;
    if (tag.runtimeMax) { params['with_runtime.lte'] = tag.runtimeMax; params['with_runtime.gte'] = 60; }
    if (tag.minVotes && params.sort_by === 'popularity.desc') params['vote_count.gte'] = tag.minVotes;
    const discoverMedia = discoverType && DISCOVER_TYPES[discoverType].media;
    const media = discoverMedia ? discoverMedia.filter(mt => !tag.mt || tag.mt.includes(mt)) : tag.mt || ['movie'];
    return media.flatMap(mt => {
        const p = { ...params };
        let mediaGenres = genres;
        if (discoverType && mt === 'tv') {
            mediaGenres = genres.map(genre => discoverGenreId(genre, mt));
            if (mediaGenres.some(genre => !DC_GENRES.tv.some(([id]) => id === genre) && !Object.hasOwn(TV_GENRE_MAP, genre))) return [];
        }
        if (discoverType === 'animation') mediaGenres = [...new Set([16, ...mediaGenres])];
        else if (discoverType && !mediaGenres.includes(16)) p.without_genres = 16;
        if (mediaGenres.length) p.with_genres = mediaGenres.join(',');
        const dateKey = mt === 'tv' ? 'first_air_date' : 'primary_release_date';
        if (tag.from) p[`${dateKey}.gte`] = tag.from;
        if (tag.to) p[`${dateKey}.lte`] = tag.to;
        if (mt === 'tv' && tag.tvType) p.with_type = tag.tvType;
        return { tag, mt, request: { path: `discover/${mt}`, params: p } };
    });
}

// Ряды по выбранным темам: до 6 тем, порядок меняется каждый день
async function loadTasteRows(limit = 6, discoverType) {
    const picked = myTasteTags()
        .filter(tag => !discoverType || !tag.mt || tag.mt.some(mt => DISCOVER_TYPES[discoverType].media.includes(mt)))
        .map(tag => ({ tag, order: dailyRandom(`tag:${tag.id}`) }))
        .sort((a, b) => a.order - b.order)
        .slice(0, limit)
        .map(x => x.tag);
    if (!picked.length) return [];
    const keywordIds = await resolveKeywords(picked.flatMap(t => t.keywords || []));
    const plans = picked.flatMap(tag => tagRequests(tag, keywordIds, discoverType)).slice(0, 12);
    if (!plans.length) return [];
    const results = await tmdbBatch(plans.map(p => p.request));

    const rows = new Map();
    plans.forEach((plan, idx) => {
        // Исключить язык в TMDB discover нельзя — отсекаем здесь (мультфильмы без аниме)
        const list = cleanResults(results[idx], plan.mt, 20, true, plan.tag.minVotes)
            .filter(r => (!plan.tag.notLang || r.lang !== plan.tag.notLang)
                && (!discoverType || (r.mt === plan.mt && r.cartoon === (discoverType === 'animation'))));
        const row = rows.get(plan.tag.id) || { tag: plan.tag, items: [] };
        // фильмы и сериалы одной темы — вперемешку
        const merged = [];
        for (let i = 0; i < Math.max(row.items.length, list.length); i++) {
            if (row.items[i]) merged.push(row.items[i]);
            if (list[i]) merged.push(list[i]);
        }
        row.items = merged;
        rows.set(plan.tag.id, row);
    });
    return [...rows.values()]
        .filter(row => row.items.length >= (discoverType ? 1 : 4))
        .map(row => ({ kicker: 'Вы любите', title: row.tag.label, tagId: row.tag.id, items: row.items.slice(0, 20) }));
}

// Подборка из всех тем по очереди — для «Для вас», пока оценок мало
function mixTasteRows(rows, limit = 30) {
    const seen = new Set();
    const mix = [];
    for (let i = 0; mix.length < limit && rows.some(r => r.items[i]); i++) {
        rows.forEach(row => {
            const r = row.items[i];
            if (r && !seen.has(r.key) && mix.length < limit) {
                seen.add(r.key);
                mix.push({ ...r, reason: `Вы любите: ${tagTitle(tagById(row.tagId)).toLowerCase()}` });
            }
        });
    }
    return mix;
}

// Строка «Интересы: … · Изменить» над рекомендациями
function tasteSummaryHtml() {
    if (tasteState() !== 'set') return '';
    const tags = myTasteTags();
    return `<p class="taste-summary">${tags.length
        ? `Интересы: ${escapeHtml(tags.slice(0, 5).map(tagTitle).join(', ').toLowerCase())}${tags.length > 5 ? ` и ещё ${tags.length - 5}` : ''}`
        : 'Интересы не выбраны'} · <a href="?view=tastes" data-nav>${tags.length ? 'Изменить' : 'Выбрать'}</a></p>`;
}
