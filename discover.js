// Быстрое добавление фильмов и рекомендации — только для своей коллекции.
//
// «Добавить фильмы» (?view=discover, а для пустой коллекции — главная):
//   популярные фильмы и сериалы по жанрам и поиск; нажал на постер —
//   поставил оценку 1–10 или отложил в список «Хочу посмотреть».
// «Рекомендации» (?view=recs и ряд на главной):
//   пока коллекция пуста — тренды и самое известное; дальше — похожие на то,
//   что оценено на 7+, и лучшее в любимом жанре.
//
// Данные TMDB идут через Edge Function «tmdb» (tmdb-helper.js), запись —
// напрямую в Supabase с токеном пользователя (RLS: только своё).

const WANT_LIST = 'Хочу посмотреть';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const RECS_TTL_MS = 6 * 60 * 60 * 1000;

const DC_GENRES = {
    movie: [[35, 'Комедии'], [28, 'Боевики'], [18, 'Драмы'], [878, 'Фантастика'], [53, 'Триллеры'], [27, 'Ужасы'],
        [10749, 'Мелодрамы'], [9648, 'Детективы'], [12, 'Приключения'], [16, 'Мультфильмы'], [14, 'Фэнтези'], [80, 'Криминал'], [10751, 'Семейные']],
    tv: [[35, 'Комедии'], [18, 'Драмы'], [80, 'Криминал'], [9648, 'Детективы'], [10765, 'Фантастика'],
        [10759, 'Экшен'], [16, 'Мультсериалы'], [10751, 'Семейные']]
};

// Жанры коллекции → id жанров фильмов TMDB (для «Лучшее в жанре…»)
const GENRE_IDS = {
    'Комедия': 35, 'Боевик': 28, 'Драма': 18, 'Фантастика': 878, 'Триллер': 53, 'Ужасы': 27, 'Мелодрама': 10749,
    'Детектив': 9648, 'Приключения': 12, 'Фэнтези': 14, 'Криминал': 80, 'Семейный': 10751, 'Мюзикл': 10402,
    'Военный': 10752, 'История': 36, 'Вестерн': 37, 'Мультфильм': 16
};
const GENRE_TITLES = {
    35: 'Лучшие комедии', 28: 'Лучшие боевики', 18: 'Лучшие драмы', 878: 'Лучшая фантастика', 53: 'Лучшие триллеры',
    27: 'Лучшие ужасы', 10749: 'Лучшие мелодрамы', 9648: 'Лучшие детективы', 12: 'Лучшие приключения', 14: 'Лучшее фэнтези',
    80: 'Лучшие криминальные фильмы', 10751: 'Лучшие семейные фильмы', 10402: 'Лучшие мюзиклы', 10752: 'Лучшие военные фильмы',
    36: 'Лучшие исторические фильмы', 37: 'Лучшие вестерны', 16: 'Лучшие мультфильмы'
};

const dc = { mt: 'movie', genre: 0, page: 1, more: false, q: '', token: 0, added: 0, trendKeys: new Set() };
const dcSeen = new Map();      // key → данные TMDB карточки на экране
const dcPending = new Map();   // key → { rating, want } пока запись сохраняется
let dcSheet = null;            // карточка, открытая в меню оценки
let recsMemo = null;
let recsToken = 0;

// ---------- Данные ----------

async function tmdbBatch(requests) {
    const { results } = await tmdbProxy({ action: 'batch', requests });
    return results || [];
}

function tmdbItem(raw, mt) {
    const date = raw.release_date || raw.first_air_date || '';
    const item = {
        key: `${mt}:${raw.id}`,
        id: raw.id,
        mt,
        title: raw.title || raw.name || '',
        year: date.slice(0, 4),
        poster: raw.poster_path ? TMDB_IMG + raw.poster_path : '',
        overview: raw.overview || '',
        vote: raw.vote_average ? Math.round(raw.vote_average * 10) / 10 : null,
        votes: raw.vote_count || 0,
        genres: raw.genre_ids || [],
        lang: raw.original_language || '',
        cartoon: (raw.genre_ids || []).includes(16)
    };
    dcSeen.set(item.key, item);
    return item;
}

// Только фильмы и сериалы с постером, которых ещё нет в коллекции
const TV_MOVIE_GENRE = 10770;

// Отсекаем телефильмы и малоизвестное с низким рейтингом — TMDB любит их подмешивать
function goodEnough(raw, mt, minVotes) {
    if (!raw.poster_path || raw.adult || (raw.genre_ids || []).includes(TV_MOVIE_GENRE)) return false;
    return (raw.vote_count || 0) >= (minVotes ?? (mt === 'tv' ? 80 : 150)) && (raw.vote_average || 0) >= 6.2;
}

function cleanResults(data, mt, limit = 20, strict = true, minVotes) {
    return (data?.results || [])
        .map(raw => ({ raw, mt: raw.media_type || mt }))
        .filter(({ raw, mt }) => (mt === 'movie' || mt === 'tv') && raw.poster_path && !raw.adult
            && !(raw.genre_ids || []).includes(TV_MOVIE_GENRE) && (!strict || goodEnough(raw, mt, minVotes)))
        .map(({ raw, mt }) => tmdbItem(raw, mt))
        .filter(r => !findOwned(r))
        .slice(0, limit);
}

const dcTypeName = (r) => r.cartoon ? 'Мультфильм' : r.mt === 'tv' ? 'Сериал' : 'Фильм';
const titleKey = (title, year) => `${normalizeSearch(title).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}|${year || ''}`;

// Есть ли фильм в коллекции: по id TMDB, а у старых записей — по названию и году
function findOwned(r) {
    const pending = dcPending.get(r.key);
    if (pending) return { pending: true, rating: pending.rating, customlists: pending.want ? WANT_LIST : '' };
    const byTitle = titleKey(r.title, r.year);
    return items.find(i => (i.tmdb_id && i.tmdb_id === r.id && (i.tmdb_type || 'movie') === r.mt)
        || (!i.tmdb_id && titleKey(i.title, i.year) === byTitle)) || null;
}

const inWantList = (item) => splitList(item?.customlists).includes(WANT_LIST);

async function dbWrite(method, path, body) {
    const token = await myToken();
    if (!token) throw new Error('нужно войти через Telegram');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        method,
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            Prefer: 'return=representation'
        },
        body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error(`ошибка сервера ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

// ---------- Добавление и оценка ----------

async function addFromTmdb(r, { rating = null, want = false }) {
    if (dcPending.has(r.key)) return;
    dcPending.set(r.key, { rating, want });
    refreshCards(r.key);
    try {
        let d = null;
        try { d = await tmdbDetails(r.id, r.mt); } catch { /* сохраним то, что уже известно */ }
        const payload = {
            type: d?.type || (r.cartoon ? 'cartoons' : r.mt === 'tv' ? 'series' : 'movies'),
            title: d?.title || r.title,
            poster: d?.poster || r.poster,
            year: parseInt(d?.year || r.year, 10) || null,
            rating,
            genres: (d?.genres || []).join(', '),
            description: d ? detailsDescription(d) : r.overview,
            trailer: d?.trailer || '',
            customlists: want ? WANT_LIST : '',
            review: '',
            rewatch: false,
            tmdb_id: r.id,
            tmdb_type: r.mt
        };
        const [row] = await dbWrite('POST', 'collection', payload);
        row.details = { description: row.description || '', review: '' };
        items.unshift(row);
        dc.added++;
        onItemsChanged();
        if (want) toast('Добавлено в «Хочу посмотреть»', true);
        window.tgApp?.HapticFeedback?.notificationOccurred?.('success');
    } catch (err) {
        console.error(err);
        toast(`Не получилось добавить «${r.title}»: ${err.message}`);
    } finally {
        dcPending.delete(r.key);
        refreshCards(r.key);
        updateDcBar();
    }
}

async function updateOwned(item, patch, r) {
    const before = { ...item };
    Object.assign(item, patch);
    if (r) refreshCards(r.key);
    try {
        const [row] = await dbWrite('PATCH', `collection?id=eq.${encodeURIComponent(item.id)}`, patch);
        if (row) Object.assign(item, row);
        onItemsChanged();
        if (!inWantList(before) && inWantList(item)) toast('Добавлено в «Хочу посмотреть»', true);
    } catch (err) {
        Object.assign(item, before);
        toast(`Не получилось сохранить: ${err.message}`);
    }
    if (r) refreshCards(r.key);
}

async function removeOwned(item, r) {
    try {
        await dbWrite('DELETE', `collection?id=eq.${encodeURIComponent(item.id)}`);
        items = items.filter(i => i !== item);
        onItemsChanged();
        toast(`«${item.title}» удалён из коллекции`);
    } catch (err) {
        toast(`Не получилось удалить: ${err.message}`);
    }
    if (r) refreshCards(r.key);
}

function rate(r, rating) {
    const owned = findOwned(r);
    if (owned?.pending) return;
    // Посмотрел то, что откладывал, — убираем из «Хочу посмотреть»
    if (owned) updateOwned(owned, { rating, customlists: splitList(owned.customlists).filter(n => n !== WANT_LIST).join(', ') }, r);
    else addFromTmdb(r, { rating });
}

function toggleWant(r) {
    const owned = findOwned(r);
    if (owned?.pending) return;
    if (!owned) { addFromTmdb(r, { want: true }); return; }
    const lists = splitList(owned.customlists);
    const next = inWantList(owned) ? lists.filter(n => n !== WANT_LIST) : [...lists, WANT_LIST];
    // Без оценки и без списка запись не нужна
    if (!next.length && owned.rating == null) removeOwned(owned, r);
    else updateOwned(owned, { customlists: next.join(', ') }, r);
}

function onItemsChanged() {
    renderSidebarLists();
    renderGenreOptions();
    recsMemo = null;
    try { localStorage.removeItem(recsStorageKey()); } catch { /* недоступно */ }
}

// ---------- Карточка TMDB ----------

function tcard(r, reason = '') {
    const owned = findOwned(r);
    const mark = owned?.pending ? '<span class="tcard-mark is-busy" aria-hidden="true"></span>'
        : owned?.rating != null ? `<span class="tcard-mark is-rated">★ ${escapeHtml(owned.rating)}</span>`
        : '';
    const saved = inWantList(owned);
    const label = [r.title, r.year, owned?.rating != null ? `ваша оценка ${owned.rating}` : ''].filter(Boolean).join(', ');
    return `
    <article class="tcard${owned ? ' is-owned' : ''}" data-tkey="${escapeHtml(r.key)}" data-reason="${escapeHtml(reason)}">
        <button type="button" class="tcard-btn" data-dc-pick="${escapeHtml(r.key)}" aria-label="${escapeHtml(label)}">
            ${posterImg(r.poster, { alt: '' })}
            <span class="tcard-caption">
                <span class="tcard-title">${escapeHtml(r.title)}</span>
                <span class="tcard-meta">${escapeHtml([r.year, dcTypeName(r)].filter(Boolean).join(' • '))}</span>
                ${reason ? `<span class="tcard-reason">${escapeHtml(reason)}</span>` : ''}
            </span>
            ${mark}
        </button>
        ${!mark && isMine() ? `<button class="tcard-mark tcard-save film-bookmark${saved ? ' is-saved' : ''}" type="button"
            data-quick-watch="${escapeHtml(r.key)}" aria-pressed="${saved}" aria-label="${saved ? 'Убрать из списка' : 'Хочу посмотреть'}">${BOOKMARK_ICON}</button>` : ''}
    </article>`;
}

function refreshCards(key) {
    const r = dcSeen.get(key);
    if (!r) return;
    document.querySelectorAll(`.tcard[data-tkey="${CSS.escape(key)}"]`).forEach(el => {
        el.outerHTML = tcard(r, el.dataset.reason || '');
    });
}

// ---------- Меню оценки ----------

function openPickSheet(r) {
    dcSheet = r;
    const owned = findOwned(r);
    const meta = [r.year, dcTypeName(r), r.vote ? `TMDB ★ ${r.vote}` : ''].filter(Boolean).join(' • ');
    const rated = owned?.rating != null;
    showSheet(`
        <div class="sheet-head">
            ${posterImg(r.poster, { size: 'small', lazy: false, cls: 'sheet-poster' })}
            <div class="sheet-head-text">
                <div class="sheet-title">${escapeHtml(r.title)}</div>
                <div class="sheet-meta">${escapeHtml(meta)}</div>
            </div>
        </div>
        ${r.overview ? `<p class="pick-overview">${escapeHtml(r.overview)}</p>` : ''}
        ${isMine() ? `<div class="pick-label">${rated ? 'Ваша оценка' : 'Смотрели? Поставьте оценку'}</div>
        <div class="rate-row" role="group" aria-label="Оценка от 1 до 10">
            ${Array.from({ length: 10 }, (_, i) => i + 1).map(n =>
                `<button type="button" class="rate-btn${owned?.rating === n ? ' active' : ''}" data-dc-rate="${n}">${n}</button>`).join('')}
        </div>` : ''}
        <div class="sheet-actions">
            ${rated || !isMine() ? '' : `<button type="button" class="sheet-btn${inWantList(owned) ? ' is-on' : ''}" data-dc-want>
                🔖 ${inWantList(owned) ? 'В списке «Хочу посмотреть»' : 'Хочу посмотреть'}</button>`}
            <button type="button" class="sheet-btn" data-dc-trailer>▶ Трейлер</button>
            ${owned && !owned.pending ? `<button type="button" class="sheet-btn" data-dc-open="${escapeHtml(owned.id)}">Открыть карточку</button>
                ${isMine() ? '<button type="button" class="sheet-btn sheet-btn-danger" data-dc-remove>Удалить из коллекции</button>' : ''}` : ''}
        </div>
        <button type="button" class="sheet-cancel" data-sheet-action="close">${owned || !isMine() ? 'Закрыть' : 'Не смотрел'}</button>`, 'Оценка фильма');
}

// То же нижнее меню, что и у карточек коллекции (кнопка «Назад» и Esc его закрывают)
function showSheet(html, label) {
    const overlay = $('sheetOverlay');
    if (!overlay.hidden) closeSheet(true);
    sheetItem = null;
    $('sheetBody').innerHTML = html;
    overlay.querySelector('.sheet').setAttribute('aria-label', label);
    overlay.hidden = false;
    lockScroll();
    window.tgApp?.HapticFeedback?.impactOccurred('light');
    requestAnimationFrame(() => { overlay.classList.add('active'); notifyChange(); });
    overlay.querySelector('.sheet').focus({ preventScroll: true });
}

async function playTrailer(r) {
    toast('Ищу трейлер…');
    try {
        const trailer = await findTrailerForTmdbItem(r.id, r.mt);
        if (trailer) openTrailer(`https://www.youtube.com/watch?v=${trailer.key}`);
        else toast('Трейлер не найден');
    } catch {
        toast('Не удалось загрузить трейлер');
    }
}

// ---------- «Добавить фильмы» ----------

function needOwnCollectionHtml() {
    return me
        ? `<div class="empty-state">Добавлять и получать рекомендации можно в своей коллекции.<br>
            <a class="btn-pill btn-pill-primary" href="./" data-nav data-mine>Моя коллекция</a></div>`
        : `<div class="empty-state welcome">
            <div class="welcome-emoji">🎬</div>
            <h2>Своя коллекция фильмов</h2>
            <p>Откройте приложение в Telegram — аккаунт создастся сам, регистрироваться не нужно.</p>
            ${TG_BOT_URL ? `<a class="btn-pill btn-pill-primary" href="${escapeHtml(TG_BOT_URL)}" target="_blank" rel="noopener">Открыть в Telegram</a>` : ''}
        </div>`;
}

function renderDiscover() {
    const grid = $('contentGrid');
    grid.className = 'discover';
    if (!isMine()) { grid.innerHTML = needOwnCollectionHtml(); return; }

    const empty = !items.length;
    dc.added = 0;
    grid.innerHTML = `
        ${empty ? `
        <section class="dc-hero">
            <h2>Найдите фильм или сериал</h2>
            <p>Оцените просмотренное или сохраните на потом.</p>
        </section>` : '<p class="dc-lead">Нажмите на постер, чтобы поставить оценку или отложить фильм на потом.</p>'}
        <form class="dc-search" id="dcSearchForm" role="search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            <input type="search" id="dcSearch" placeholder="Найти фильм или сериал" aria-label="Найти фильм или сериал" autocomplete="off" enterkeyhint="search" value="${escapeHtml(dc.q)}">
        </form>
        <div class="dc-browse" id="dcBrowse">
            <div class="dc-tabs" role="tablist">
                <button type="button" role="tab" data-dc-mt="movie">Фильмы</button>
                <button type="button" role="tab" data-dc-mt="tv">Сериалы</button>
            </div>
            <div class="dc-chips" id="dcChips"></div>
        </div>
        <section class="home-section" id="dcTaste" hidden></section>
        <section class="home-section" id="dcTrend" hidden>
            <div class="home-section-header"><div class="section-heading">
                <span class="section-kicker">Новинки, которые смотрят сейчас</span>
                <h2 id="dcTrendTitle">🔥 Сейчас в тренде</h2>
            </div></div>
            <div class="home-row" id="dcTrendRow"></div>
        </section>
        <div class="section-heading dc-grid-heading" id="dcGridHeading">
            <span class="section-kicker">Самые известные за всё время</span>
            <h2 id="dcGridTitle">🏆 Культовые фильмы</h2>
        </div>
        <div class="grid dc-grid" id="dcGrid"></div>
        <div class="dc-more"><button type="button" class="btn-pill" id="dcMore" data-dc-more hidden>Показать ещё</button></div>
        <div class="dc-bar" id="dcBar" hidden>
            <span id="dcBarText"></span>
            <button type="button" class="btn-pill btn-pill-primary" data-dc-done>Готово</button>
        </div>`;
    syncDcControls();
    if (dc.q) runSearch(dc.q); else loadDiscover(true);
}

function syncDcControls() {
    document.querySelectorAll('[data-dc-mt]').forEach(b => {
        const on = b.dataset.dcMt === dc.mt;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
    });
    const chips = $('dcChips');
    if (chips) chips.innerHTML = [[0, 'Всё'], ...DC_GENRES[dc.mt]].map(([id, name]) =>
        `<button type="button" class="dc-chip${dc.genre === id ? ' active' : ''}" data-dc-genre="${id}">${escapeHtml(name)}</button>`).join('');
    const browse = $('dcBrowse');
    if (browse) browse.hidden = Boolean(dc.q);
    // В поиске — только результаты, без подборок
    if ($('dcTrend') && dc.q) $('dcTrend').hidden = true;
    if ($('dcTaste') && (dc.q || dc.genre)) $('dcTaste').hidden = true;
    if ($('dcGridHeading')) {
        $('dcGridHeading').hidden = Boolean(dc.q);
        const genre = DC_GENRES[dc.mt].find(([id]) => id === dc.genre);
        $('dcGridTitle').textContent = genre ? `🏆 Культовые: ${genre[1].toLowerCase()}` : `🏆 Культовые ${dc.mt === 'tv' ? 'сериалы' : 'фильмы'}`;
        $('dcTrendTitle').textContent = genre ? `🔥 Популярно сейчас: ${genre[1].toLowerCase()}` : '🔥 Сейчас в тренде';
    }
}

// Карточки TMDB без телефильмов и без постера (уже добавленные — с отметкой)
function browseItems(data, mt) {
    return (data?.results || [])
        .filter(raw => raw.poster_path && !raw.adult && !(raw.genre_ids || []).includes(TV_MOVIE_GENRE))
        .map(raw => tmdbItem(raw, raw.media_type || mt));
}

function dcSkeleton(n = 12) {
    return '<div class="skeleton"></div>'.repeat(n);
}

// Сверху — что смотрят сейчас (тренды недели или популярное в жанре),
// ниже — культовое: самое известное за всё время, его чаще всего уже видели
function trendRequest() {
    return dc.genre
        ? { path: `discover/${dc.mt}`, params: { language: 'ru-RU', sort_by: 'popularity.desc', with_genres: dc.genre, 'vote_count.gte': dc.mt === 'tv' ? 50 : 100, include_adult: 'false' } }
        : { path: `trending/${dc.mt}/week`, params: { language: 'ru-RU' } };
}

function cultRequest() {
    const params = { language: 'ru-RU', sort_by: 'vote_count.desc', include_adult: 'false', page: dc.page };
    if (dc.genre) params.with_genres = dc.genre;
    return { path: `discover/${dc.mt}`, params };
}

async function loadDiscover(reset) {
    const grid = $('dcGrid');
    if (!grid) return;
    const token = ++dc.token;
    if (reset) {
        $('dcTaste').hidden = true;
        dc.page = 1;
        grid.innerHTML = dcSkeleton();
        $('dcTrend').hidden = false;
        $('dcTrendRow').innerHTML = dcSkeleton(4);
    }
    $('dcMore').hidden = true;
    try {
        let cult;
        if (reset) {
            const [trend, first] = await tmdbBatch([trendRequest(), cultRequest()]);
            if (token !== dc.token || !$('dcGrid')?.isSameNode(grid)) return;
            if (first?.error) throw new Error(first.error);
            const trendList = trend?.error ? [] : browseItems(trend, dc.mt).slice(0, 20);
            dc.trendKeys = new Set(trendList.map(r => r.key));
            $('dcTrendRow').innerHTML = trendList.map(r => tcard(r)).join('');
            $('dcTrend').hidden = !trendList.length;
            markScrollableRows();
            if (!dc.genre) fillDiscoverTastes(token);
            cult = first;
            grid.innerHTML = '';
        } else {
            cult = await tmdbGet(cultRequest().path, cultRequest().params);
            if (token !== dc.token || !$('dcGrid')?.isSameNode(grid)) return;
        }
        // То, что уже есть в ряду трендов, в сетке не повторяем
        const fresh = browseItems(cult, dc.mt).filter(r => !dc.trendKeys.has(r.key));
        dc.more = cult.page < Math.min(cult.total_pages || 1, 15);
        grid.insertAdjacentHTML('beforeend', fresh.map(r => tcard(r)).join(''));
        $('dcMore').hidden = !dc.more;
    } catch (err) {
        if (token !== dc.token || !$('dcGrid')?.isSameNode(grid)) return;
        console.error(err);
        $('dcTrend').hidden = true;
        grid.innerHTML = `<div class="empty-state error">Не удалось загрузить каталог.<br><button type="button" class="btn-pill" data-dc-retry>Попробовать ещё раз</button></div>`;
    }
    updateDcBar();
}

// «Под ваши интересы» — по выбранному типу, без фильтра жанра
async function fillDiscoverTastes(token) {
    const el = $('dcTaste');
    if (!el || tasteState() !== 'set' || !tastes.tags.length) return;
    try {
        const mediaType = dc.mt;
        const rows = await loadTasteRows(6, mediaType);
        if (token !== dc.token || !document.contains(el) || dc.q) return;
        const list = mixTasteRows(rows).filter(r => r.mt === mediaType && !dc.trendKeys.has(r.key)).slice(0, 20);
        if (!list.length) return;
        el.innerHTML = `
            <div class="home-section-header">
                <div class="section-heading">
                    <span class="section-kicker">По вашим интересам</span>
                    <h2>✨ Вам может понравиться</h2>
                </div>
                <a class="see-all" href="?view=tastes" data-nav>Изменить</a>
            </div>
            <div class="home-row">${list.map(r => tcard(r, r.reason)).join('')}</div>`;
        el.hidden = false;
        markScrollableRows();
    } catch (err) {
        console.error(err);
    }
}

async function runSearch(q) {
    const grid = $('dcGrid');
    if (!grid) return;
    const token = ++dc.token;
    $('dcMore').hidden = true;
    grid.innerHTML = dcSkeleton(6);
    try {
        let results = await tmdbSearchMulti(q, 'ru-RU');
        if (!results.length) results = await tmdbSearchMulti(q, 'en-US');
        if (token !== dc.token || !$('dcGrid')?.isSameNode(grid)) return;
        const list = results.map(raw => tmdbItem(raw, raw.media_type));
        grid.innerHTML = list.length ? list.map(r => tcard(r)).join('') : '<div class="empty-state">Ничего не нашлось. Попробуйте оригинальное название.</div>';
    } catch (err) {
        if (token !== dc.token || !$('dcGrid')?.isSameNode(grid)) return;
        grid.innerHTML = `<div class="empty-state error">${escapeHtml(err.message)}</div>`;
    }
}

function updateDcBar() {
    const bar = $('dcBar');
    if (!bar) return;
    bar.hidden = dc.added < 1;
    const rated = items.filter(i => i.rating != null).length;
    $('dcBarText').textContent = rated < 3
        ? `Оценено ${rated} из 3 — ещё немного, и рекомендации станут точнее`
        : `В коллекции ${items.length} ${plural(items.length, 'запись', 'записи', 'записей')}`;
}

// Закончили — показываем коллекцию с рекомендациями
function finishDiscover() {
    dc.q = '';
    if (state.view === 'main' && !state.q) {
        $('contentGrid').dataset.ready = '';
        renderView();
        window.scrollTo(0, 0);
    } else {
        go({ ...stateFromUrl(''), u: null });
    }
}

// ---------- Рекомендации ----------

const recsStorageKey = () => `recs2:${me?.id || ''}`;
const today = () => new Date().toISOString().slice(0, 10);

// «Случайность», одинаковая в течение дня: подборка не прыгает при каждом открытии,
// но назавтра основа другая
function dailyRandom(salt) {
    const str = `${today()}:${me?.id || ''}:${salt}`;
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967296;
}

function recsSignature() {
    const s = items.map(i => `${i.id}:${i.rating ?? ''}:${inWantList(i) ? 1 : 0}`).sort().join(',');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return `${today()}:${items.length}:${h}:${tastes.tags.join(',')}`;
}

function getRecs() {
    const sig = recsSignature();
    if (recsMemo && recsMemo.sig === sig && Date.now() - recsMemo.at < RECS_TTL_MS) return recsMemo.promise;
    try {
        const saved = JSON.parse(localStorage.getItem(recsStorageKey()));
        if (saved && saved.sig === sig && Date.now() - saved.at < RECS_TTL_MS) {
            Object.values(saved.data).flat().forEach(entry => [entry, ...(entry?.items || [])].forEach(r => r?.key && dcSeen.set(r.key, r)));
            recsMemo = { sig, at: saved.at, promise: Promise.resolve(saved.data) };
            return recsMemo.promise;
        }
    } catch { /* нет сохранённых */ }
    const promise = buildRecs().then(data => {
        try { localStorage.setItem(recsStorageKey(), JSON.stringify({ sig, at: Date.now(), data })); } catch { /* переполнено */ }
        return data;
    });
    recsMemo = { sig, at: Date.now(), promise };
    promise.catch(() => { if (recsMemo?.promise === promise) recsMemo = null; });
    return promise;
}

const byRecent = (a, b) => new Date(b.created_at) - new Date(a.created_at);

// На чём строить: оценки 7+, затем отложенное и недавнее
const SEED_COUNT = 9;
const DAY_MS = 24 * 60 * 60 * 1000;

// Основа подборки: из всех оценённых на 7+. Шанс выше у высоких оценок и свежих
// добавлений, но состав меняется каждый день; не больше трёх фильмов одного жанра
// и не только фильмы, если есть сериалы и мультфильмы.
function pickSeeds() {
    const liked = items.filter(i => i.rating >= 7);
    if (liked.length < 3) {
        const extra = items.filter(i => !liked.includes(i) && (i.rating == null || i.rating >= 6)).sort(byRecent);
        return [...liked, ...extra].slice(0, Math.max(liked.length, 4));
    }
    const ranked = liked.map(i => {
        const recent = Date.now() - new Date(i.created_at) < 45 * DAY_MS ? 1.4 : 1;
        return { i, w: (1 + 0.6 * (i.rating - 7)) * recent * (0.2 + dailyRandom(i.id)) };
    }).sort((a, b) => b.w - a.w);

    const picked = [];
    const perGenre = new Map(), perType = new Map();
    const maxPerType = Math.ceil(SEED_COUNT * 0.6);
    for (const { i } of ranked) {
        if (picked.length >= SEED_COUNT) break;
        const genre = splitList(i.genres)[0] || '';
        if ((perGenre.get(genre) || 0) >= 3 || (perType.get(i.type) || 0) >= maxPerType) continue;
        picked.push(i);
        perGenre.set(genre, (perGenre.get(genre) || 0) + 1);
        perType.set(i.type, (perType.get(i.type) || 0) + 1);
    }
    for (const { i } of ranked) {
        if (picked.length >= SEED_COUNT) break;
        if (!picked.includes(i)) picked.push(i);
    }
    return picked;
}

// Сериальные жанры TMDB → жанры фильмов, чтобы сравнивать с предпочтениями
const TV_GENRE_MAP = { 10759: [28, 12], 10765: [878, 14], 10768: [10752], 10762: [10751] };

// Вес жанров по оценкам: понравившееся — плюс, разочаровавшее — минус (от −1 до 1)
function genreWeights() {
    const raw = new Map();
    items.forEach(i => {
        if (i.rating == null) return;
        const names = splitList(i.genres);
        if (i.type === 'cartoons') names.push('Мультфильм');
        names.forEach(n => { const id = GENRE_IDS[n]; if (id) raw.set(id, (raw.get(id) || 0) + (i.rating - 6.5)); });
    });
    const max = Math.max(1, ...[...raw.values()].map(Math.abs));
    return new Map([...raw].map(([id, w]) => [id, w / max]));
}

function genreAffinity(genres, weights) {
    const ids = genres.flatMap(g => TV_GENRE_MAP[g] || [g]).filter(g => weights.has(g));
    return ids.length ? ids.reduce((sum, g) => sum + weights.get(g), 0) / ids.length : 0;
}

// У записей, добавленных вручную, нет id TMDB — находим по названию и году и запоминаем
async function resolveTmdbIds(seeds) {
    const missing = seeds.filter(s => !s.tmdb_id);
    missing.forEach(s => {
        const cached = localStorage.getItem(`tmdbid:${s.id}`);
        if (cached) [s.tmdb_type, s.tmdb_id] = [cached.split(':')[0], Number(cached.split(':')[1])];
    });
    const unresolved = missing.filter(s => !s.tmdb_id);
    if (!unresolved.length) return;
    const results = await tmdbBatch(unresolved.map(s => ({ path: 'search/multi', params: { query: s.title, language: 'ru-RU', include_adult: 'false' } })));
    unresolved.forEach((s, idx) => {
        const options = (results[idx]?.results || []).filter(r => (r.media_type === 'movie' || r.media_type === 'tv') && r.poster_path);
        const [best] = rankTmdbResults(options, s.type === 'series' ? 'tv' : 'movie', s.year);
        if (!best) return;
        const year = Number((best.release_date || best.first_air_date || '').slice(0, 4));
        if (s.year && year && Math.abs(year - s.year) > 1) return; // скорее всего, другой фильм
        s.tmdb_id = best.id;
        s.tmdb_type = best.media_type;
        try { localStorage.setItem(`tmdbid:${s.id}`, `${s.tmdb_type}:${s.tmdb_id}`); } catch { /* недоступно */ }
        if (isMine()) dbWrite('PATCH', `collection?id=eq.${s.id}`, { tmdb_id: s.tmdb_id, tmdb_type: s.tmdb_type }).catch(() => {});
    });
}

// Любимый жанр: оценки выше 6 добавляют вес, ниже — отнимают
function favoriteGenre() {
    const weight = new Map();
    items.forEach(i => {
        const w = i.rating == null ? (inWantList(i) ? 0.5 : 0) : i.rating - 6;
        const names = splitList(i.genres);
        if (i.type === 'cartoons') names.push('Мультфильм');
        names.forEach(n => { if (GENRE_IDS[n]) weight.set(n, (weight.get(n) || 0) + w); });
    });
    const [best] = [...weight.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]);
    if (!best) return null;
    const id = GENRE_IDS[best[0]];
    return { id, title: GENRE_TITLES[id] || `Лучшее: ${best[0].toLowerCase()}` };
}

async function buildRecs() {
    // Ряды по интересам грузятся параллельно с остальным
    const tastePromise = tasteState() === 'set' && tastes.tags.length
        ? loadTasteRows().catch(err => { console.error(err); return []; })
        : Promise.resolve([]);

    if (!items.length) {
        const [[trending, movies, tv], tasteRows] = await Promise.all([tmdbBatch([
            { path: 'trending/all/week', params: { language: 'ru-RU' } },
            { path: 'discover/movie', params: { language: 'ru-RU', sort_by: 'vote_count.desc' } },
            { path: 'discover/tv', params: { language: 'ru-RU', sort_by: 'vote_count.desc' } }
        ]), tastePromise]);
        const tasteMix = mixTasteRows(tasteRows);
        return {
            cold: true,
            forYou: tasteMix,
            tasteMix,
            because: [],
            rows: [
                ...tasteRows.slice(0, 3),
                { title: '🔥 Сейчас в тренде', items: cleanResults(trending, 'movie', 20, false) },
                { kicker: 'Самое известное', title: '🏆 Фильмы, которые видели все', items: cleanResults(movies, 'movie') },
                { kicker: 'Самое известное', title: '🏆 Сериалы, которые видели все', items: cleanResults(tv, 'tv') }
            ]
        };
    }

    const seeds = pickSeeds();
    await resolveTmdbIds(seeds);
    const ready = seeds.filter(s => s.tmdb_id);
    const genre = favoriteGenre();
    const requests = [
        ...ready.map(s => ({ path: `${s.tmdb_type || 'movie'}/${s.tmdb_id}/recommendations`, params: { language: 'ru-RU' } })),
        { path: 'trending/all/week', params: { language: 'ru-RU' } },
        { path: 'discover/movie', params: { language: 'ru-RU', sort_by: 'vote_count.desc' } }
    ];
    if (genre) requests.push({ path: 'discover/movie', params: { language: 'ru-RU', with_genres: genre.id, sort_by: 'vote_average.desc', 'vote_count.gte': 1500 } });
    const [results, tasteRows] = await Promise.all([tmdbBatch(requests), tastePromise]);

    // Вклад «источника»: оценка (7 → 0.6, 10 → 1) и место в его списке похожих.
    // Похожее сразу на несколько ваших фильмов и любимые жанры поднимаются выше.
    const weights = genreWeights();
    const scores = new Map();
    ready.forEach((seed, si) => {
        const weight = seed.rating != null ? 0.6 + 0.13 * Math.max(0, seed.rating - 7) : 0.45;
        (results[si]?.results || []).forEach((raw, idx) => {
            const mt = raw.media_type || seed.tmdb_type || 'movie';
            if ((mt !== 'movie' && mt !== 'tv') || !goodEnough(raw, mt)) return;
            const r = tmdbItem(raw, mt);
            if (findOwned(r)) return;
            const add = weight * (1 - idx / 25);
            const entry = scores.get(r.key) || { r, score: 0, best: 0, seeds: [] };
            entry.score += add;
            if (!entry.seeds.includes(seed)) entry.seeds.push(seed);
            if (add > entry.best) { entry.best = add; entry.seeds = [seed, ...entry.seeds.filter(s => s !== seed)]; }
            scores.set(r.key, entry);
        });
    });
    scores.forEach(e => {
        e.score += 0.3 * (e.seeds.length - 1) + 0.3 * genreAffinity(e.r.genres, weights) + 0.1 * (e.r.vote || 0) / 10;
    });

    // Один фильм-источник — не больше двух карточек в первой дюжине
    const sorted = [...scores.values()].sort((a, b) => b.score - a.score);
    const perSeed = new Map(), head = [], tail = [];
    sorted.forEach(e => {
        const n = perSeed.get(e.seeds[0]) || 0;
        if (head.length < 12 && n < 2) { head.push(e); perSeed.set(e.seeds[0], n + 1); } else tail.push(e);
    });
    const byRatings = [...head, ...tail].slice(0, 30).map(e => ({
        ...e.r,
        reason: e.seeds.length > 1 ? `Похоже на «${e.seeds[0].title}» и «${e.seeds[1].title}»` : `Похоже на «${e.seeds[0].title}»`
    }));

    // Пока оценок мало, интересы идут через одну карточку; дальше — каждая четвёртая
    const tasteMix = mixTasteRows(tasteRows).filter(r => !scores.has(r.key));
    const rated = items.filter(i => i.rating != null).length;
    const step = rated < 3 ? 2 : 4;
    const forYou = [];
    for (let i = 0, t = 0; forYou.length < 30 && (i < byRatings.length || t < tasteMix.length);) {
        if ((forYou.length + 1) % step === 0 && t < tasteMix.length) forYou.push(tasteMix[t++]);
        else if (i < byRatings.length) forYou.push(byRatings[i++]);
        else forYou.push(tasteMix[t++]);
    }

    // Ряды «Потому что вам понравился…» — каждый день про разные фильмы
    const because = ready
        .map((seed, si) => ({ kicker: 'Потому что вам понравился', title: `«${seed.title}»`, items: cleanResults(results[si], seed.tmdb_type || 'movie', 12), order: dailyRandom(`row:${seed.id}`) }))
        .filter(b => b.items.length >= 4)
        .sort((a, b) => a.order - b.order)
        .slice(0, 2);
    const rows = [...tasteRows.slice(0, 3)];
    if (genre) rows.push({ kicker: 'Ваш любимый жанр', title: genre.title, items: cleanResults(results[ready.length + 2], 'movie') });
    rows.push({ title: '🔥 Сейчас в тренде', items: cleanResults(results[ready.length], 'movie', 20, false) });
    rows.push({ kicker: 'Если вдруг пропустили', title: '🏆 Культовые фильмы', items: cleanResults(results[ready.length + 1], 'movie') });

    return { cold: !ready.length, forYou, tasteMix, because, rows: rows.filter(r => r.items.length) };
}

// Убираем то, что успели добавить после расчёта
const notOwned = (list) => (list || []).filter(r => !findOwned(r) || dcPending.has(r.key));

function recsRowHtml({ title, kicker = '', items: list }) {
    const shown = notOwned(list);
    if (!shown.length) return '';
    return `
        <section class="home-section">
            <div class="home-section-header">
                <div class="section-heading">
                    ${kicker ? `<span class="section-kicker">${escapeHtml(kicker)}</span>` : ''}
                    <h2>${escapeHtml(title)}</h2>
                </div>
            </div>
            <div class="home-row">${shown.slice(0, 15).map(r => tcard(r)).join('')}</div>
        </section>`;
}

async function renderRecs() {
    const grid = $('contentGrid');
    grid.className = 'recs';
    if (!isMine()) { grid.innerHTML = needOwnCollectionHtml(); return; }

    const token = ++recsToken;
    grid.innerHTML = `<p class="dc-lead">Подбираем по вашим оценкам…</p><div class="grid">${dcSkeleton(8)}</div>`;
    let data;
    try {
        data = await getRecs();
    } catch (err) {
        console.error(err);
        if (token === recsToken && state.view === 'recs') {
            grid.innerHTML = `<div class="empty-state error">Не удалось подобрать рекомендации.<br><button type="button" class="btn-pill" data-dc-retry>Попробовать ещё раз</button></div>`;
        }
        return;
    }
    if (token !== recsToken || state.view !== 'recs') return;

    const rated = items.filter(i => i.rating != null).length;
    const hint = rated < 3 ? `
        <section class="dc-hint">
            <div><b>${rated ? 'Оцените ещё пару фильмов' : 'Оцените 3–5 фильмов'}</b> — и подборка станет точнее.</div>
            <a class="btn-pill btn-pill-primary" href="?view=discover" data-nav>➕ Отметить</a>
        </section>` : '';
    const forYou = notOwned(data.forYou);
    grid.innerHTML = `
        ${tasteSummaryHtml()}
        ${hint}
        ${forYou.length ? `<h2 class="coll-heading">✨ Для вас</h2>
            <div class="grid recs-grid">${forYou.slice(0, 12).map(r => tcard(r, r.reason)).join('')}</div>` : ''}
        ${data.because.map(recsRowHtml).join('')}
        ${data.rows.map(recsRowHtml).join('')}`;
    markScrollableRows();
}

// Ряд «Рекомендуем вам» на главной своей коллекции
async function fillSimilar(item) {
    const section = $('filmSimilar');
    if (!section) return;
    const preferredType = item.tmdb_type || (item.type === 'series' ? 'tv' : 'movie');
    item.similarRequest ||= (async () => {
        let id = item.tmdb_id;
        let mediaType = preferredType;
        if (!id) {
            const candidates = await tmdbSearchMulti(item.title, 'ru-RU');
            const match = rankTmdbResults(candidates, preferredType, item.year).find(result =>
                result.media_type === preferredType
                && [result.title, result.name, result.original_title, result.original_name]
                    .some(title => normalizeSearch(title) === normalizeSearch(item.title))
                && (!item.year || String(item.year) === (result.release_date || result.first_air_date || '').slice(0, 4)));
            if (!match) return [];
            id = match.id;
            mediaType = match.media_type;
        }
        const results = await tmdbGet(`${mediaType}/${id}/recommendations`, { language: 'ru-RU' });
        return browseItems(results, mediaType).filter(result => result.mt === mediaType && result.id !== id).slice(0, 10);
    })();
    try {
        const similar = await item.similarRequest;
        if (!similar.length || !section.isConnected || String(state.film) !== String(item.id)) return;
        section.innerHTML = `<h3>Похожее</h3><div class="home-row">${similar.map(result => {
            const owned = findOwned(result);
            return owned && !owned.pending ? card(owned) : tcard(result);
        }).join('')}</div>`;
        section.hidden = false;
        markScrollableRows();
    } catch {
        delete item.similarRequest;
    }
}

// ---------- События ----------

document.addEventListener('click', (e) => {
    const quickWatch = e.target.closest('[data-quick-watch]');
    if (quickWatch && isMine()) {
        const result = dcSeen.get(quickWatch.dataset.quickWatch);
        if (result) {
            const item = findOwned(result);
            if (item && !item.pending) toggleFilmWatch(item, quickWatch);
            else if (!item) addFromTmdb(result, { want: true });
        }
        return;
    }
    const pick = e.target.closest('[data-dc-pick]');
    if (pick) { const r = dcSeen.get(pick.dataset.dcPick); if (r) openPickSheet(r); return; }

    const rateBtn = e.target.closest('[data-dc-rate]');
    if (rateBtn && dcSheet) {
        const r = dcSheet;
        rateBtn.classList.add('active');
        closeSheet();
        rate(r, Number(rateBtn.dataset.dcRate));
        return;
    }
    if (e.target.closest('[data-dc-want]') && dcSheet) { const r = dcSheet; closeSheet(); toggleWant(r); return; }
    if (e.target.closest('[data-dc-trailer]') && dcSheet) { const r = dcSheet; closeSheet(); playTrailer(r); return; }
    const openBtn = e.target.closest('[data-dc-open]');
    if (openBtn) { closeSheet(true); openFilm(openBtn.dataset.dcOpen); return; }
    const removeBtn = e.target.closest('[data-dc-remove]');
    if (removeBtn && dcSheet) {
        // Второе нажатие подтверждает удаление
        if (!removeBtn.dataset.confirm) { removeBtn.dataset.confirm = '1'; removeBtn.textContent = 'Нажмите ещё раз, чтобы удалить'; return; }
        const r = dcSheet, owned = findOwned(r);
        closeSheet();
        if (owned && !owned.pending) removeOwned(owned, r);
        return;
    }

    const mt = e.target.closest('[data-dc-mt]');
    if (mt && mt.dataset.dcMt !== dc.mt) { dc.mt = mt.dataset.dcMt; dc.genre = 0; syncDcControls(); loadDiscover(true); return; }
    const genre = e.target.closest('[data-dc-genre]');
    if (genre) { dc.genre = Number(genre.dataset.dcGenre); syncDcControls(); loadDiscover(true); return; }
    if (e.target.closest('[data-dc-more]')) { dc.page++; loadDiscover(false); return; }
    if (e.target.closest('[data-dc-done]')) { finishDiscover(); return; }
    if (e.target.closest('[data-dc-retry]')) {
        recsMemo = null;
        if (state.view === 'recs') renderRecs(); else loadDiscover(true);
    }
});

let dcSearchTimer;
document.addEventListener('input', (e) => {
    if (e.target.id !== 'dcSearch') return;
    clearTimeout(dcSearchTimer);
    const q = e.target.value.trim();
    dcSearchTimer = setTimeout(() => {
        dc.q = q.length >= 2 ? q : '';
        syncDcControls();
        if (dc.q) runSearch(dc.q); else loadDiscover(true);
    }, 350);
});

document.addEventListener('submit', (e) => {
    if (e.target.id !== 'dcSearchForm') return;
    e.preventDefault();
    e.target.querySelector('input').blur();
});
