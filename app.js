const VIEW_TITLES = {
    main: 'Главная', movies: 'Фильмы', series: 'Сериалы', cartoons: 'Мультфильмы',
    top100: 'ТОП 100', new: 'Новинки', recent: 'Недавно добавлено', rewatch: 'Пересматриваем любимое',
    best: 'Лучшее', collections: 'Подборки', account: 'Аккаунт'
};
// Готовые подборки на вкладке «Подборки» (свои списки добавляются следом)
const COLLECTIONS = [
    ['top100', '🏆', 'Личный рейтинг по местам'],
    ['best', '⭐', 'Оценки 9 и 10'],
    ['new', '🆕', 'Вышли в этом году'],
    ['recent', '🕒', 'Последние добавленные'],
    ['rewatch', '🔁', 'То, к чему хочется вернуться']
];
// Описание и отзыв — самые тяжёлые поля, их грузим при открытии карточки
const LIST_FIELDS = 'id,type,title,poster,year,rating,genres,toprank,customlists,created_at,rewatch,trailer';
const PROFILE_FIELDS = 'id,handle,display_name,title,avatar_url';
const HOME_ROW_LIMIT = 10;
const RECENT_LIMIT = 24;
const LONG_PRESS_MS = 450;

let items = [];
let owner = null;        // чью коллекцию смотрим
let me = null;           // кто вошёл (Telegram или email владельца)
let state = { view: 'main', list: null, q: '', genre: 'all', sort: 'default', film: null, u: null };
let lastFocus = null;
let loadToken = 0;

const $ = (id) => document.getElementById(id);
const isTg = () => document.documentElement.classList.contains('tg');
const isMine = () => Boolean(me && owner && me.id === owner.id);

// ---------- Данные ----------

async function api(path, options = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...options,
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${options.token || SUPABASE_KEY}`,
            ...(options.body ? { 'content-type': 'application/json', Prefer: 'return=representation' } : {})
        }
    });
    if (!res.ok) throw new Error(`Supabase: ${res.status} ${await res.text()}`);
    return res.json();
}

async function fetchProfile(column, value) {
    const [row] = await api(`profiles?select=${PROFILE_FIELDS}&${column}=eq.${encodeURIComponent(value)}`);
    return row || null;
}

async function loadDetails(item) {
    if (item.details) return item.details;
    const [row] = await api(`collection?select=description,review&id=eq.${encodeURIComponent(item.id)}`);
    item.details = { description: row?.description || '', review: row?.review || '' };
    return item.details;
}

// Сессия владельца, вошедшего в админку по email (supabase-js хранит её в localStorage)
function webSession() {
    try {
        const raw = JSON.parse(localStorage.getItem(`sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`));
        if (raw?.user?.id && raw.access_token) return raw;
    } catch { /* нет сессии */ }
    return null;
}

// Токен для изменения своего профиля
async function myToken() {
    const tg = await window.tgAuth;
    if (tg && tg.expires_at * 1000 > Date.now()) return tg.access_token;
    const web = webSession();
    if (web && web.expires_at * 1000 > Date.now()) return web.access_token;
    return null;
}

async function resolveMe() {
    if (isTg()) {
        const session = await window.tgAuth;
        return session ? session.profile : null;
    }
    const web = webSession();
    return web ? fetchProfile('id', web.user.id).catch(() => null) : null;
}

// Чью коллекцию показывать: явно указанную, свою или коллекцию по умолчанию
function targetHandle(s) {
    return s.u || me?.handle || DEFAULT_HANDLE;
}

async function switchCollection(handle) {
    const token = ++loadToken;
    const profile = await fetchProfile('handle', handle);
    if (!profile) throw Object.assign(new Error('not found'), { notFound: true });
    const rows = await api(`collection?select=${LIST_FIELDS}&owner_id=eq.${profile.id}`);
    if (token !== loadToken) return false;
    owner = profile;
    items = rows;
    renderSidebarLists();
    renderGenreOptions();
    renderOwner();
    return true;
}

function customLists() {
    const names = new Set();
    items.forEach(i => splitList(i.customlists).forEach(n => names.add(n)));
    return [...names].sort((a, b) => a.localeCompare(b, 'ru'));
}

function topItems() {
    return items.filter(i => i.toprank > 0).sort((a, b) => a.toprank - b.toprank).slice(0, 100);
}

function itemsForView(view, list) {
    switch (view) {
        case 'movies':
        case 'series':
        case 'cartoons':
            return items.filter(i => i.type === view);
        case 'top100':
            return topItems();
        case 'new': {
            const year = new Date().getFullYear();
            return items.filter(i => Number(i.year) === year);
        }
        case 'recent':
            return items
                .filter(i => i.created_at)
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .slice(0, RECENT_LIMIT);
        case 'rewatch':
            return items.filter(i => i.rewatch === true);
        case 'best':
            return items.filter(i => Number(i.rating) >= 9).sort((a, b) => b.rating - a.rating);
        case 'list':
            return items.filter(i => splitList(i.customlists).includes(list));
        default:
            return items;
    }
}

function searchItems(query) {
    const q = normalizeSearch(query);
    return items.filter(i => normalizeSearch(i.title).includes(q));
}

// ---------- Имена ----------

function personName(p) {
    return p?.display_name || (p?.handle ? `@${p.handle}` : '');
}

function collectionTitle(p = owner) {
    if (!p) return 'Коллекция';
    if (p.title) return p.title;
    if (me && me.id === p.id) return 'Моя коллекция';
    if (p.display_name) return `Коллекция ${p.display_name}`;
    // Гость сайта видит коллекцию по умолчанию так же, как раньше
    return p.handle === DEFAULT_HANDLE && !me ? 'Моя коллекция' : `Коллекция @${p.handle}`;
}

function avatarHtml(p, cls = '') {
    const letter = escapeHtml((personName(p).replace('@', '')[0] || '?').toUpperCase());
    return p?.avatar_url
        ? `<img class="avatar ${cls}" src="${escapeHtml(p.avatar_url)}" alt="" referrerpolicy="no-referrer">`
        : `<span class="avatar avatar-letter ${cls}" aria-hidden="true">${letter}</span>`;
}

// ---------- Адрес страницы ----------

function stateFromUrl(search = location.search) {
    const p = new URLSearchParams(search);
    const list = p.get('list');
    const view = list ? 'list' : (VIEW_TITLES[p.get('view')] ? p.get('view') : 'main');
    const u = (p.get('u') || '').toLowerCase();
    return {
        view,
        list: list || null,
        q: p.get('q') || '',
        genre: p.get('genre') || 'all',
        sort: p.get('sort') || 'default',
        film: p.get('film') || null,
        u: /^[a-z0-9_]{3,32}$/.test(u) ? u : null
    };
}

function urlFor(s) {
    const p = new URLSearchParams();
    if (s.u) p.set('u', s.u);
    if (s.view === 'list' && s.list) p.set('list', s.list);
    else if (s.view !== 'main') p.set('view', s.view);
    if (s.q) p.set('q', s.q);
    if (s.genre !== 'all') p.set('genre', s.genre);
    if (s.sort !== 'default') p.set('sort', s.sort);
    if (s.film) p.set('film', s.film);
    const query = p.toString();
    // Внутри Telegram в адресе лежат параметры запуска (#tgWebAppData=…), их не трогаем
    const hash = /tgWebApp/.test(location.hash) ? location.hash : '';
    return (query ? `?${query}` : location.pathname) + hash;
}

function absoluteUrl(s) {
    const url = new URL(urlFor(s), location.href);
    url.hash = '';
    return url.href;
}

function viewKey(s) {
    return s.view === 'list' ? `list:${s.list}` : s.view;
}

function go(next, mode = 'push', historyState = {}) {
    const url = urlFor(next);
    if (mode === 'push') history.pushState(historyState, '', url);
    else history.replaceState({ ...history.state, ...historyState }, '', url);
    applyState(next);
}

function applyState(next) {
    // Другая коллекция — сначала загружаем её
    if (owner && targetHandle(next) !== owner.handle) {
        state = { ...next, film: null };
        showSkeleton();
        closeSheet(true);
        switchCollection(targetHandle(next))
            .then(ok => { if (ok) { $('contentGrid').dataset.ready = ''; state = { ...next, film: null, view: '_' }; applyState(next); } })
            .catch(err => showLoadError(err));
        return;
    }

    const prev = state;
    state = next;
    const viewChanged = viewKey(prev) !== viewKey(next) || prev.q !== next.q
        || prev.genre !== next.genre || prev.sort !== next.sort;
    if (viewChanged || !$('contentGrid').dataset.ready) renderView();
    if (viewKey(prev) !== viewKey(next)) window.scrollTo(0, 0);
    if (prev.film !== next.film || !$('modalOverlay').hidden !== Boolean(next.film)) syncModal();
    notifyChange();
}

// Сообщает tg.js, что изменилось то, от чего зависит кнопка «Назад» Telegram
function notifyChange() {
    document.dispatchEvent(new CustomEvent('app:change'));
}

const trailerOpen = () => $('trailerOverlay').classList.contains('active');
const drawerOpen = () => document.body.classList.contains('drawer-open');
const sheetOpen = () => $('sheetOverlay').classList.contains('active');

function canGoBack() {
    return sheetOpen() || trailerOpen() || Boolean(state.film) || drawerOpen() || state.view !== 'main' || Boolean(state.q);
}

// Шаг назад: меню действий → трейлер → карточка → меню → поиск → главная
function goBack() {
    if (sheetOpen()) closeSheet();
    else if (trailerOpen()) closeTrailer();
    else if (state.film) closeFilm();
    else if (drawerOpen()) closeDrawer();
    else if (document.activeElement === $('search') && state.q) go({ ...state, q: '' }, 'replace');
    else if (state.view !== 'main' || state.q) go({ ...stateFromUrl(''), u: state.u, film: null });
}

// Переход по ссылке из меню: новый раздел без поиска и фильтров, в той же коллекции
function navigateTo(href, fromDrawer) {
    const target = stateFromUrl(new URL(href, location.href).search);
    const next = { ...target, u: target.u || state.u, film: null };
    if (fromDrawer && history.state && history.state.drawer) {
        // Запись меню в истории превращаем в запись нового раздела
        hideDrawer();
        go(next, 'replace', { drawer: false });
    } else {
        hideDrawer();
        go(next, 'push');
    }
}

window.addEventListener('popstate', () => {
    hideDrawer();
    closeSheet(true);
    applyState(stateFromUrl());
});

// ---------- Отрисовка ----------

function showSkeleton() {
    const grid = $('contentGrid');
    grid.className = 'grid';
    grid.innerHTML = '<div class="skeleton"></div>'.repeat(6);
}

function showLoadError(err) {
    console.error(err);
    const grid = $('contentGrid');
    grid.className = 'grid';
    grid.innerHTML = err?.notFound
        ? `<div class="empty-state">Такой коллекции нет.<br><a class="btn-pill" href="./" data-nav data-home>На главную</a></div>`
        : '<div class="empty-state error">Не удалось загрузить коллекцию. Обновите страницу.</div>';
}

function renderView() {
    const grid = $('contentGrid');
    grid.dataset.ready = '1';
    updateChrome();

    if (state.view === 'account' && !state.q) {
        renderAccount();
        return;
    }
    if (state.view === 'collections' && !state.q && items.length) {
        renderCollections();
        return;
    }

    if (!items.length) {
        grid.className = 'grid';
        grid.innerHTML = emptyCollectionHtml();
        return;
    }

    if (!state.q && state.view === 'main') {
        renderHome();
        return;
    }

    let list = state.q ? searchItems(state.q) : itemsForView(state.view, state.list);
    if (state.genre !== 'all') list = list.filter(i => splitList(i.genres).includes(state.genre));
    list = sortItems(list, state.sort);
    $('resultCount').textContent = `${list.length} ${plural(list.length, 'запись', 'записи', 'записей')}`;

    if (!list.length) {
        grid.className = 'grid';
        grid.innerHTML = `<div class="empty-state">${state.q ? 'Ничего не найдено.' : 'В этой подборке пока ничего нет.'}</div>`;
        return;
    }

    if (state.view === 'top100' && !state.q) {
        const rank = new Map(topItems().map((i, idx) => [i.id, idx + 1]));
        grid.className = 'top-list';
        grid.innerHTML = list.map(i => topRow(i, rank.get(i.id))).join('');
    } else {
        grid.className = 'grid';
        grid.innerHTML = list.map((i, idx) => card(i, idx < 8)).join('');
    }
}

function emptyCollectionHtml() {
    if (isMine()) {
        return `<div class="empty-state welcome">
            <div class="welcome-emoji">🍿</div>
            <h2>Здесь будет ваша коллекция</h2>
            <p>Добавляйте фильмы, сериалы и мультфильмы, ставьте оценки и делитесь ими с друзьями.</p>
            <a class="btn-pill btn-pill-primary" href="admin.html">➕ Добавить первый фильм</a>
        </div>`;
    }
    return '<div class="empty-state">Коллекция пока пуста.</div>';
}

function updateChrome() {
    const isMain = state.view === 'main' && !state.q;
    const title = state.q ? `Поиск: «${state.q}»`
        : state.view === 'list' ? state.list
        : isMain && !isMine() && owner && owner.handle !== DEFAULT_HANDLE ? collectionTitle()
        : VIEW_TITLES[state.view];
    $('pageTitle').textContent = title;
    if (!state.film) document.title = isMain ? collectionTitle() : `${title} — ${collectionTitle()}`;

    $('filtersBar').hidden = isMain || ((state.view === 'account' || state.view === 'collections') && !state.q);
    $('backToMain').hidden = isMain;
    $('genreSelect').value = state.genre;
    $('sortSelect').value = state.sort;

    const search = $('search');
    if (document.activeElement !== search) search.value = state.q;
    $('header').classList.toggle('search-open', Boolean(state.q) || $('header').classList.contains('search-focus'));

    const key = state.q ? null : viewKey(state);
    document.querySelectorAll('[data-key]').forEach(el => {
        // Вкладка «Подборки» подсвечена и внутри подборки или своего списка
        const also = (el.dataset.also || '').split(' ');
        const active = el.dataset.key === key || Boolean(key && (also.includes(key) || (key.startsWith('list:') && also.includes('list'))));
        el.classList.toggle('active', active);
        if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
    syncNavHrefs();
}

// Ссылки меню ведут в ту же коллекцию, что открыта сейчас (важно для «открыть в новой вкладке»)
function syncNavHrefs() {
    document.querySelectorAll('a[data-nav][data-key]').forEach(a => {
        const key = a.dataset.key;
        const s = { ...stateFromUrl(''), u: state.u };
        if (key.startsWith('list:')) Object.assign(s, { view: 'list', list: key.slice(5) });
        else s.view = key;
        a.setAttribute('href', urlFor(s).replace(/#.*$/, '') || './');
    });
}

// Шапка коллекции в меню и аватар во вкладке «Аккаунт»
function renderOwner() {
    $('brandOwner').innerHTML = owner
        ? `${avatarHtml(owner, 'avatar-sm')}<span>${escapeHtml(collectionTitle())}</span>`
        : '';
    const tab = $('accountTabIcon');
    if (tab) tab.innerHTML = me?.avatar_url
        ? avatarHtml(me, 'avatar-tab')
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
}

function ownerBannerHtml() {
    if (!owner || isMine() || (!me && owner.handle === DEFAULT_HANDLE && !isTg())) return '';
    const action = me
        ? `<a class="btn-pill" href="./" data-nav data-mine>Моя коллекция</a>`
        : TG_BOT_URL ? `<a class="btn-pill btn-pill-primary" href="${escapeHtml(TG_BOT_URL)}" target="_blank" rel="noopener">Создать свою</a>` : '';
    return `
        <div class="owner-banner">
            ${avatarHtml(owner, 'avatar-lg')}
            <div class="owner-banner-text">
                <div class="owner-banner-title">${escapeHtml(collectionTitle())}</div>
                <div class="owner-banner-sub">${escapeHtml(personName(owner))} · ${items.length} ${plural(items.length, 'запись', 'записи', 'записей')}</div>
            </div>
            ${action}
        </div>`;
}

function renderHome() {
    const grid = $('contentGrid');
    grid.className = 'home';

    const rated = items.filter(i => i.rating !== null && i.rating !== '');
    const avg = rated.length ? (rated.reduce((s, i) => s + Number(i.rating), 0) / rated.length).toFixed(1) : '—';
    const count = (type) => items.filter(i => i.type === type).length;
    const stats = [
        [items.length, 'Всего'], [count('movies'), 'Фильмы'], [count('series'), 'Сериалы'],
        [count('cartoons'), 'Мульты'], [avg, 'Оценка']
    ];

    const sectionUrl = (patch) => urlFor({ ...stateFromUrl(''), u: state.u, ...patch });
    const sections = [
        ['Недавно добавлено', itemsForView('recent'), sectionUrl({ view: 'recent' })],
        ['Новинки', itemsForView('new'), sectionUrl({ view: 'new' })],
        ['ТОП 100', topItems(), sectionUrl({ view: 'top100' })],
        ['Пересматриваем любимое', itemsForView('rewatch'), sectionUrl({ view: 'rewatch' })],
        ...customLists().map(name => [name, itemsForView('list', name), sectionUrl({ view: 'list', list: name })])
    ].filter(([, list]) => list.length);

    grid.innerHTML = `
        ${ownerBannerHtml()}
        <div class="stats">${stats.map(([v, l]) => `<div class="stat"><div class="stat-value">${v}</div><div class="stat-label">${l}</div></div>`).join('')}</div>
        ${sections.map(([title, list, href], sIdx) => `
            <section class="home-section">
                <div class="home-section-header">
                    <h2><a href="${escapeHtml(href)}" data-nav>${escapeHtml(title)}</a></h2>
                    <a class="see-all" href="${escapeHtml(href)}" data-nav>Все ${list.length} →</a>
                </div>
                <div class="home-row">${list.slice(0, HOME_ROW_LIMIT).map((i, idx) => card(i, sIdx === 0 && idx < 6)).join('')}</div>
            </section>`).join('') || '<div class="empty-state">Пока нечего показать.</div>'}
    `;
    markScrollableRows();
}

function card(item, eager = false) {
    const label = [item.title, item.year].filter(Boolean).join(', ');
    return `
    <article class="card" data-item="${escapeHtml(item.id)}">
        <a class="card-link" href="${escapeHtml(urlFor({ ...state, film: item.id }))}" data-film="${escapeHtml(item.id)}" aria-label="${escapeHtml(label)}">
            ${posterImg(item.poster, { alt: '', lazy: !eager })}
            <div class="card-overlay">
                <div class="card-title">${escapeHtml(item.title)}</div>
                <div class="card-meta">${escapeHtml(item.year || '')} • ${typeName(item.type)}</div>
            </div>
        </a>
        ${item.rating !== null && item.rating !== '' ? `<span class="card-badge">★ ${escapeHtml(item.rating)}</span>` : ''}
        ${item.trailer ? `<button type="button" class="card-trailer" data-trailer="${escapeHtml(item.trailer)}" aria-label="Трейлер: ${escapeHtml(item.title)}">▶</button>` : ''}
        <button type="button" class="card-more" data-sheet="${escapeHtml(item.id)}" aria-label="Действия: ${escapeHtml(item.title)}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
        </button>
    </article>`;
}

function topRow(item, rank) {
    const medal = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
    return `
    <article class="top-row" data-item="${escapeHtml(item.id)}">
        <a class="top-link" href="${escapeHtml(urlFor({ ...state, film: item.id }))}" data-film="${escapeHtml(item.id)}">
            <span class="top-rank ${medal}">${rank || ''}</span>
            ${posterImg(item.poster, { size: 'small', cls: 'top-poster' })}
            <span class="top-info">
                <span class="top-title">${escapeHtml(item.title)}</span>
                <span class="top-meta">${escapeHtml(item.year || '')} • ${typeName(item.type)}
                    ${item.rating !== null && item.rating !== '' ? `<span class="rating">★ ${escapeHtml(item.rating)}</span>` : ''}</span>
            </span>
        </a>
        ${item.trailer ? `<button type="button" class="top-trailer" data-trailer="${escapeHtml(item.trailer)}" aria-label="Трейлер: ${escapeHtml(item.title)}">▶</button>` : ''}
    </article>`;
}

function markScrollableRows() {
    requestAnimationFrame(() => {
        document.querySelectorAll('.home-section').forEach(section => {
            const row = section.querySelector('.home-row');
            section.classList.toggle('scrollable', row.scrollWidth > row.clientWidth + 4);
        });
    });
}

function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
}

function renderSidebarLists() {
    const lists = customLists();
    $('listsHeading').hidden = !lists.length;
    $('dynamicLists').innerHTML = lists.map(name =>
        `<a class="nav-item" href="?list=${encodeURIComponent(name)}" data-nav data-key="${escapeHtml('list:' + name)}">📌 ${escapeHtml(name)}</a>`
    ).join('');
}

function renderGenreOptions() {
    const genres = new Set();
    items.forEach(i => splitList(i.genres).forEach(g => genres.add(g)));
    $('genreSelect').innerHTML = '<option value="all">Все жанры</option>' + [...genres]
        .sort((a, b) => a.localeCompare(b, 'ru'))
        .map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
}

// ---------- Подборки ----------

function collectionTile(href, emoji, title, hint, list) {
    const covers = list.slice(0, 3);
    return `
        <a class="coll-tile" href="${escapeHtml(href)}" data-nav>
            <span class="coll-covers" aria-hidden="true">
                ${covers.map((i, idx) => `<span class="coll-cover coll-cover-${idx}">${posterImg(i.poster, { size: 'small' })}</span>`).join('')
                    || '<span class="coll-cover coll-cover-0 coll-empty"></span>'}
            </span>
            <span class="coll-text">
                <span class="coll-title">${emoji} ${escapeHtml(title)}</span>
                <span class="coll-hint">${escapeHtml(hint)}</span>
            </span>
            <span class="coll-count">${list.length}</span>
        </a>`;
}

function renderCollections() {
    const grid = $('contentGrid');
    grid.className = 'collections';
    const base = { ...stateFromUrl(''), u: state.u };
    const ready = COLLECTIONS
        .map(([view, emoji, hint]) => [view, emoji, hint, itemsForView(view)])
        .filter(([, , , list]) => list.length)
        .map(([view, emoji, hint, list]) => collectionTile(urlFor({ ...base, view }), emoji, VIEW_TITLES[view], hint, list));
    const own = customLists().map(name => {
        const list = itemsForView('list', name);
        return collectionTile(urlFor({ ...base, view: 'list', list: name }), '📌', name, `${list.length} ${plural(list.length, 'запись', 'записи', 'записей')}`, list);
    });
    grid.innerHTML = `
        <h2 class="coll-heading">Готовые подборки</h2>
        <div class="coll-grid">${ready.join('') || '<div class="empty-state">Пока пусто.</div>'}</div>
        <h2 class="coll-heading">${isMine() ? 'Мои списки' : 'Списки'}</h2>
        <div class="coll-grid">${own.join('') || `<div class="empty-state">${isMine()
            ? 'Своих списков пока нет. <br><a class="btn-pill" href="lists.html">🗂️ Создать список</a>'
            : 'Своих списков пока нет.'}</div>`}</div>`;
}

// ---------- Аккаунт ----------

function renderAccount() {
    const grid = $('contentGrid');
    grid.className = 'account';

    if (!me) {
        const tgFailed = isTg();
        grid.innerHTML = `
            <section class="account-card account-hero">
                <div class="welcome-emoji">🎬</div>
                <h2>Своя коллекция фильмов</h2>
                <p class="muted">${tgFailed
                    ? `Не получилось войти через Telegram.${window.tgAuthError ? ` <br><small>${escapeHtml(window.tgAuthError)}</small>` : ''}`
                    : 'Откройте приложение в Telegram — аккаунт создастся сам, регистрироваться не нужно.'}</p>
                ${!tgFailed && TG_BOT_URL ? `<a class="btn-pill btn-pill-primary" href="${escapeHtml(TG_BOT_URL)}" target="_blank" rel="noopener">Открыть в Telegram</a>` : ''}
                ${tgFailed ? '<button type="button" class="btn-pill" data-action="reload">Попробовать ещё раз</button>' : ''}
            </section>
            ${!tgFailed ? `<a class="account-link muted-link" href="admin.html">🔑 Вход для владельца по email</a>` : ''}`;
        return;
    }

    const mine = isMine();
    grid.innerHTML = `
        <section class="account-card account-profile">
            ${avatarHtml(me, 'avatar-xl')}
            <div class="account-profile-text">
                <h2>${escapeHtml(personName(me) || 'Без имени')}</h2>
                <div class="muted">@${escapeHtml(me.handle || '')}</div>
            </div>
        </section>

        <div class="account-actions">
            ${mine ? '' : '<a class="account-tile" href="./" data-nav data-mine><span>🏠</span>Моя коллекция</a>'}
            <button type="button" class="account-tile" data-action="share-collection"><span>📤</span>Поделиться коллекцией</button>
        </div>

        <h3 class="account-heading">Админка</h3>
        <div class="account-menu">
            <a class="account-row" href="admin.html"><span>➕</span>Добавить фильм<i>›</i></a>
            <a class="account-row" href="database.html"><span>📋</span>Вся база<i>›</i></a>
            <a class="account-row" href="admin.html#top100"><span>🏆</span>Порядок ТОП-100<i>›</i></a>
            <a class="account-row" href="lists.html"><span>🗂️</span>Мои списки<i>›</i></a>
        </div>

        <h3 class="account-heading">Профиль</h3>
        <p class="account-note">Так вашу коллекцию видят друзья, когда вы делитесь ссылкой. Ниже — как это будет выглядеть.</p>
        <form class="account-card account-form" id="profileForm">
            <div class="profile-preview" id="profilePreview">${profilePreviewHtml(me)}</div>
            <label>Ваше имя
                <input name="display_name" maxlength="64" value="${escapeHtml(me.display_name || '')}" placeholder="Например, Богдан">
                <small>Подпись под коллекцией и в сообщениях «Поделиться»</small>
            </label>
            <label>Название коллекции
                <input name="title" maxlength="64" value="${escapeHtml(me.title || '')}" placeholder="${escapeHtml(defaultTitle(me))}">
                <small>Заголовок коллекции. Пусто — «${escapeHtml(defaultTitle(me))}»</small>
            </label>
            <label>Ссылка на коллекцию
                <span class="input-prefix"><b>@</b><input name="handle" maxlength="32" value="${escapeHtml(me.handle || '')}" autocapitalize="off" autocomplete="off" spellcheck="false"></span>
                <small>Короткое имя для ссылки: латиница, цифры и «_». Если сменить, старые ссылки перестанут открываться.</small>
            </label>
            <div class="profile-link">
                <span id="profileLink">${escapeHtml(profileLink(me.handle))}</span>
                <button type="button" class="btn-pill btn-sm" data-action="copy-profile-link">Скопировать</button>
            </div>
            <button type="submit" class="btn-pill btn-pill-primary">Сохранить</button>
            <div class="form-status" role="status"></div>
        </form>`;
}

function defaultTitle(p) {
    return p.display_name ? `Коллекция ${p.display_name}` : 'Моя коллекция';
}

function profileLink(handle) {
    if (SHARE_BASE) return `${SHARE_BASE.replace(/\/+$/, '')}/c/${handle}`;
    return absoluteUrl({ ...stateFromUrl(''), u: handle });
}

function profilePreviewHtml(p) {
    const count = isMine() ? items.length : 0;
    return `
        ${avatarHtml(p, 'avatar-lg')}
        <div class="owner-banner-text">
            <div class="owner-banner-title">${escapeHtml(p.title || defaultTitle(p))}</div>
            <div class="owner-banner-sub">${escapeHtml(personName(p))} · ${count} ${plural(count, 'запись', 'записи', 'записей')}</div>
        </div>`;
}

// Предпросмотр меняется прямо во время ввода
document.addEventListener('input', (e) => {
    const form = e.target.closest('#profileForm');
    if (!form || !me) return;
    if (e.target.name === 'handle') e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const draft = {
        ...me,
        display_name: form.display_name.value.trim() || null,
        title: form.title.value.trim() || null,
        handle: form.handle.value || me.handle
    };
    $('profilePreview').innerHTML = profilePreviewHtml(draft);
    $('profileLink').textContent = profileLink(draft.handle);
    form.title.placeholder = defaultTitle(draft);
});

async function saveProfile(form) {
    const status = form.querySelector('.form-status');
    const button = form.querySelector('button[type="submit"]');
    const patch = {
        display_name: form.display_name.value.trim() || null,
        title: form.title.value.trim() || null,
        handle: form.handle.value.trim().toLowerCase()
    };
    if (!/^[a-z0-9_]{3,32}$/.test(patch.handle)) { status.textContent = 'Адрес: латиница, цифры и «_», 3–32 символа'; return; }
    const token = await myToken();
    if (!token) { status.textContent = 'Сессия истекла — перезапустите приложение'; return; }

    button.disabled = true;
    status.textContent = 'Сохраняю…';
    try {
        const [row] = await api(`profiles?id=eq.${me.id}&select=${PROFILE_FIELDS}`, { method: 'PATCH', body: JSON.stringify(patch), token });
        const oldHandle = me.handle;
        me = row;
        if (owner?.id === me.id) owner = row;
        try {
            const tg = await window.tgAuth;
            if (tg?.tg_user_id) localStorage.setItem(`tg-profile:${tg.tg_user_id}`, JSON.stringify(row));
        } catch { /* приватный режим */ }
        if (state.u === oldHandle) state.u = row.handle;
        renderOwner();
        updateChrome();
        status.textContent = '✅ Сохранено';
        toast('Профиль сохранён');
    } catch (err) {
        console.error(err);
        status.textContent = /23505|duplicate/.test(err.message) ? 'Этот адрес уже занят' : 'Не удалось сохранить';
    } finally {
        button.disabled = false;
    }
}

// ---------- Карточка фильма ----------

// [img]https://...[/img] внутри описания; остальной текст выводится как есть
function richText(text) {
    return escapeHtml(text).replace(/\[img\](.*?)\[\/img\]/gi, (m, url) =>
        /^https?:\/\/[^\s"'<>]+$/i.test(url) ? `<img class="rich-img" src="${url}" alt="" loading="lazy">` : '');
}

const findItem = (id) => items.find(i => String(i.id) === String(id));

function openFilm(id) {
    lastFocus = document.activeElement;
    go({ ...state, film: String(id) }, 'push', { film: true });
}

function closeFilm() {
    if (history.state && history.state.film) history.back();
    else go({ ...state, film: null }, 'replace', { film: false });
}

function syncModal() {
    const overlay = $('modalOverlay');
    const item = state.film && findItem(state.film);

    if (!item) {
        if (overlay.hidden) return;
        overlay.classList.remove('active');
        setTimeout(() => { if (!state.film) overlay.hidden = true; }, 200);
        unlockScroll();
        updateChrome();
        if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
        return;
    }

    document.title = `${item.title} — ${collectionTitle()}`;
    $('modalBody').innerHTML = filmHtml(item);
    overlay.hidden = false;
    lockScroll();
    $('modalContent').scrollTop = 0;
    requestAnimationFrame(() => overlay.classList.add('active'));
    overlay.querySelector('.modal-close').focus({ preventScroll: true });

    if (!item.details) {
        loadDetails(item)
            .then(() => { if (String(state.film) === String(item.id)) $('filmText').innerHTML = filmTextHtml(item.details); })
            .catch(() => { if (String(state.film) === String(item.id)) $('filmText').innerHTML = '<p class="muted">Не удалось загрузить описание.</p>'; });
    }
}

function filmHtml(item) {
    const tags = [
        `<span class="tag tag-type">${typeName(item.type)}</span>`,
        item.year ? `<span class="tag">${escapeHtml(item.year)}</span>` : '',
        item.rating !== null && item.rating !== '' ? `<span class="tag tag-rating">★ ${escapeHtml(item.rating)}</span>` : '',
        item.toprank > 0 && item.toprank <= 100 ? `<span class="tag tag-top">🏆 №${escapeHtml(item.toprank)}</span>` : '',
        ...splitList(item.genres).map(g => `<span class="tag tag-genre">${escapeHtml(g)}</span>`)
    ].join('');

    return `
        <div class="film-poster">${posterImg(item.poster, { size: 'large', lazy: false })}</div>
        <div class="film-head">
            <h2 class="film-title" id="filmTitle">${escapeHtml(item.title)}</h2>
            <div class="film-tags">${tags}</div>
            <div class="film-actions">
                ${item.trailer ? `<button type="button" class="btn-trailer" data-trailer="${escapeHtml(item.trailer)}">▶ Трейлер</button>` : ''}
                <button type="button" class="btn-ghost" data-share="${escapeHtml(item.id)}">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>Поделиться
                </button>
                ${isMine() ? `<a class="btn-ghost btn-icon" href="${editUrl(item)}" aria-label="Редактировать">✏️</a>` : ''}
            </div>
        </div>
        <div class="film-text" id="filmText">${item.details ? filmTextHtml(item.details) : '<p class="muted">Загрузка описания…</p>'}</div>`;
}

function filmTextHtml({ description, review }) {
    const block = (title, text) => text ? `<section><h3>${title}</h3><p>${richText(text)}</p></section>` : '';
    const reviewTitle = isMine() ? 'Мой отзыв' : 'Отзыв';
    return block('Описание', description) + block(reviewTitle, review) || '<p class="muted">Описания пока нет.</p>';
}

const editUrl = (item) => `admin.html?edit=${encodeURIComponent(item.id)}&back=app`;

// ---------- Поделиться ----------

async function tgAppLink(payload) {
    const session = await window.tgAuth;
    if (!session?.app_link) return null;
    return `${session.app_link.base}?${session.app_link.param}=${encodeURIComponent(payload)}`;
}

async function filmLink(item) {
    if (isTg()) {
        const link = await tgAppLink(`film_${item.id}`);
        if (link) return link;
    }
    if (SHARE_BASE) return `${SHARE_BASE.replace(/\/+$/, '')}/f/${item.id}`;
    return absoluteUrl({ ...stateFromUrl(''), u: owner?.handle, film: item.id });
}

async function collectionLink() {
    if (isTg()) {
        const link = await tgAppLink(`u_${owner.handle}`);
        if (link) return link;
    }
    if (SHARE_BASE) return `${SHARE_BASE.replace(/\/+$/, '')}/c/${owner.handle}`;
    return absoluteUrl({ ...stateFromUrl(''), u: owner.handle });
}

function filmShareText(item) {
    const head = `${item.type === 'series' ? '📺' : item.type === 'cartoons' ? '🧸' : '🎬'} ${item.title}${item.year ? ` (${item.year})` : ''}`;
    const rating = item.rating !== null && item.rating !== '' ? ` — ⭐ ${item.rating}/10` : '';
    return head + rating;
}

// Telegram: сообщение с постером и кнопкой (shareMessage), иначе — системное «Поделиться» или копирование
async function shareFilm(item) {
    const tg = window.tgApp;
    if (tg && tg.isVersionAtLeast('8.0')) {
        try {
            const prepared = await window.tgPrepareShare(item.id);
            tg.shareMessage(prepared.id);
            return;
        } catch (err) {
            console.warn('shareMessage недоступен:', err);
        }
    }
    await shareLink(await filmLink(item), filmShareText(item), item.title);
}

async function shareCollection() {
    if (!owner) return;
    const title = collectionTitle();
    await shareLink(await collectionLink(), `🍿 ${title} — ${items.length} ${plural(items.length, 'фильм', 'фильма', 'фильмов')} с оценками и отзывами`, title);
}

async function shareLink(url, text, title) {
    const tg = window.tgApp;
    if (tg) {
        tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
        return;
    }
    if (navigator.share) {
        try { await navigator.share({ title, text, url }); return; }
        catch (err) { if (err.name === 'AbortError') return; }
    }
    await copyText(url);
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
    }
    window.tgApp?.HapticFeedback?.notificationOccurred('success');
    toast('Ссылка скопирована');
}

let toastTimer;
function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- Меню действий (долгое нажатие на карточку) ----------

let sheetItem = null;

function openSheet(id) {
    const item = findItem(id);
    if (!item || !$('sheetOverlay').hidden) return;
    sheetItem = item;
    window.tgApp?.HapticFeedback?.impactOccurred('medium');
    const meta = [item.year, typeName(item.type), item.rating !== null && item.rating !== '' ? `★ ${item.rating}` : ''].filter(Boolean).join(' • ');
    $('sheetBody').innerHTML = `
        <div class="sheet-head">
            ${posterImg(item.poster, { size: 'small', lazy: false, cls: 'sheet-poster' })}
            <div class="sheet-head-text">
                <div class="sheet-title">${escapeHtml(item.title)}</div>
                <div class="sheet-meta">${escapeHtml(meta)}</div>
            </div>
        </div>
        <div class="sheet-actions">
            <button type="button" class="sheet-btn sheet-btn-primary" data-sheet-action="share">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>Поделиться
            </button>
            <button type="button" class="sheet-btn" data-sheet-action="copy">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>Скопировать ссылку
            </button>
            ${item.trailer ? `<button type="button" class="sheet-btn" data-sheet-action="trailer">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>Смотреть трейлер
            </button>` : ''}
            <button type="button" class="sheet-btn" data-sheet-action="open">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>Открыть карточку
            </button>
            ${isMine() ? `<button type="button" class="sheet-btn" data-sheet-action="edit">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/></svg>Редактировать
            </button>` : ''}
        </div>
        <button type="button" class="sheet-cancel" data-sheet-action="close">Отмена</button>`;
    const overlay = $('sheetOverlay');
    overlay.hidden = false;
    lockScroll();
    requestAnimationFrame(() => { overlay.classList.add('active'); notifyChange(); });
    overlay.querySelector('.sheet').focus({ preventScroll: true });
}

function closeSheet(instant = false) {
    const overlay = $('sheetOverlay');
    if (overlay.hidden) return;
    overlay.classList.remove('active');
    notifyChange();
    const done = () => {
        overlay.hidden = true;
        if ($('modalOverlay').hidden && !trailerOpen()) unlockScroll();
    };
    if (instant) done(); else setTimeout(done, 220);
}

async function sheetAction(action) {
    const item = sheetItem;
    closeSheet();
    if (!item) return;
    switch (action) {
        case 'share': await shareFilm(item); break;
        case 'copy': await copyText(await filmLink(item)); break;
        case 'trailer': openTrailer(item.trailer); break;
        case 'open': openFilm(item.id); break;
        case 'edit': location.href = editUrl(item); break;
    }
}

// Долгое нажатие пальцем; на ПК — правая кнопка мыши
let press = null;
let suppressClick = false;

document.addEventListener('pointerdown', (e) => {
    suppressClick = false;
    if (e.pointerType === 'mouse') return;
    const el = e.target.closest('[data-item]');
    if (!el || e.target.closest('[data-trailer], [data-sheet]')) return;
    clearTimeout(press?.timer);
    el.classList.add('pressing');
    const rect = el.getBoundingClientRect();
    press = {
        el, x: e.clientX, y: e.clientY, left: rect.left, top: rect.top,
        timer: setTimeout(() => {
            el.classList.remove('pressing');
            suppressClick = true;
            openSheet(el.dataset.item);
            press = null;
        }, LONG_PRESS_MS)
    };
}, { passive: true });

function cancelPress() {
    if (!press) return;
    clearTimeout(press.timer);
    press.el.classList.remove('pressing');
    press = null;
}
document.addEventListener('pointermove', (e) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
}, { passive: true });
document.addEventListener('pointerup', cancelPress);
document.addEventListener('pointercancel', cancelPress);
// Прокрутка отменяет удержание, только если карточка действительно сдвинулась
window.addEventListener('scroll', () => {
    if (!press) return;
    const rect = press.el.getBoundingClientRect();
    if (Math.hypot(rect.left - press.left, rect.top - press.top) > 10) cancelPress();
}, { passive: true, capture: true });

document.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('[data-item]');
    if (!el) return;
    e.preventDefault();
    cancelPress();
    openSheet(el.dataset.item);
});

// ---------- Трейлер ----------

function youTubeId(url) {
    const value = String(url || '').trim();
    const m = value.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([\w-]{6,})/);
    if (m) return m[1];
    return /^[\w-]{6,}$/.test(value) ? value : null;
}

function openTrailer(url) {
    const id = youTubeId(url);
    if (!id) return;
    $('trailerFrame').innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0" title="Трейлер" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    const overlay = $('trailerOverlay');
    overlay.hidden = false;
    lockScroll();
    requestAnimationFrame(() => { overlay.classList.add('active'); notifyChange(); });
}

function closeTrailer() {
    const overlay = $('trailerOverlay');
    overlay.classList.remove('active');
    notifyChange();
    setTimeout(() => {
        overlay.hidden = true;
        $('trailerFrame').innerHTML = '';
        if ($('modalOverlay').hidden) unlockScroll();
    }, 200);
}

// ---------- Меню ----------

function openDrawer() {
    document.body.classList.add('drawer-open');
    $('burger').setAttribute('aria-expanded', 'true');
    history.pushState({ drawer: true }, '', location.href);
    notifyChange();
}

function hideDrawer() {
    document.body.classList.remove('drawer-open');
    $('burger').setAttribute('aria-expanded', 'false');
    notifyChange();
}

function closeDrawer() {
    hideDrawer();
    if (history.state && history.state.drawer) history.back();
}

function lockScroll() { document.documentElement.classList.add('no-scroll'); }
function unlockScroll() { document.documentElement.classList.remove('no-scroll'); }

// ---------- События ----------

document.addEventListener('click', (e) => {
    // Клик, который завершает долгое нажатие, не должен открывать фильм
    if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); return; }

    const trailer = e.target.closest('[data-trailer]');
    if (trailer) { e.preventDefault(); openTrailer(trailer.dataset.trailer); return; }

    const more = e.target.closest('[data-sheet]');
    if (more) { e.preventDefault(); openSheet(more.dataset.sheet); return; }

    const sheetBtn = e.target.closest('[data-sheet-action]');
    if (sheetBtn) { sheetAction(sheetBtn.dataset.sheetAction); return; }

    const share = e.target.closest('[data-share]');
    if (share) { const item = findItem(share.dataset.share); if (item) shareFilm(item); return; }

    const modified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;

    const film = e.target.closest('a[data-film]');
    if (film && !modified) { e.preventDefault(); openFilm(film.dataset.film); return; }

    const mine = e.target.closest('a[data-mine]');
    if (mine && !modified) { e.preventDefault(); hideDrawer(); go({ ...stateFromUrl(''), u: null }); return; }

    const home = e.target.closest('a[data-home]');
    if (home && !modified) { e.preventDefault(); go({ ...stateFromUrl(''), u: null }); return; }

    const nav = e.target.closest('a[data-nav]');
    if (nav && !modified) { e.preventDefault(); navigateTo(nav.href, Boolean(nav.closest('#sidebar'))); return; }

    const action = e.target.closest('[data-action]');
    if (!action) return;
    switch (action.dataset.action) {
        case 'drawer': drawerOpen() ? closeDrawer() : openDrawer(); break;
        case 'close-drawer': closeDrawer(); break;
        case 'close-film': closeFilm(); break;
        case 'close-trailer': closeTrailer(); break;
        case 'search': $('header').classList.add('search-open'); $('search').focus(); break;
        case 'share-collection': shareCollection(); break;
        case 'copy-profile-link': copyText($('profileLink').textContent); break;
        case 'reload': sessionStorage.removeItem('tg-auth'); location.reload(); break;
    }
}, true);

document.addEventListener('submit', (e) => {
    if (e.target.id !== 'profileForm') return;
    e.preventDefault();
    saveProfile(e.target);
});

// Клик по затемнению вокруг окна закрывает его
$('modalOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeFilm(); });
$('trailerOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeTrailer(); });
$('sheetOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeSheet(); });

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') goBack();
});

let searchTimer;
$('search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => go({ ...state, q: e.target.value.trim(), film: null }, 'replace'), 200);
});
$('search').addEventListener('focus', () => $('header').classList.add('search-focus'));
$('search').addEventListener('blur', () => {
    $('header').classList.remove('search-focus');
    if (!state.q) $('header').classList.remove('search-open');
});
$('searchForm').addEventListener('submit', (e) => { e.preventDefault(); $('search').blur(); });

$('genreSelect').addEventListener('change', (e) => go({ ...state, genre: e.target.value }, 'replace'));
$('sortSelect').addEventListener('change', (e) => go({ ...state, sort: e.target.value }, 'replace'));

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (state.view === 'main' && !state.q) markScrollableRows();
        if (window.innerWidth >= 1024) hideDrawer();
    }, 150);
});

// ---------- Запуск ----------

async function init() {
    applyStartParam();
    let start = stateFromUrl();
    state = { ...start, film: null };

    // В Telegram сразу показываем свою коллекцию по профилю с прошлого запуска,
    // а вход подтверждаем параллельно
    me = isTg() ? (window.tgCachedProfile || null) : null;
    const mePromise = resolveMe();
    if (!me) me = await mePromise;

    try {
        // Ссылка на фильм без ?u= — находим, чей он
        if (start.film && !start.u) {
            const [row] = await api(`collection?select=owner_id&id=eq.${encodeURIComponent(start.film)}`);
            if (row && row.owner_id !== me?.id) {
                const p = await fetchProfile('id', row.owner_id);
                if (p && p.handle !== targetHandle(start)) {
                    start = { ...start, u: p.handle };
                    history.replaceState(history.state, '', urlFor(start));
                }
            }
        }
        await switchCollection(targetHandle(start));
    } catch (err) {
        showLoadError(err);
        return;
    }
    state = { ...start, film: null };
    renderView();
    applyState(start);

    // Вход подтвердился (или сменился пользователь) — обновляем интерфейс
    mePromise.then(fresh => {
        const changed = (fresh?.id || null) !== (me?.id || null);
        me = fresh;
        renderOwner();
        if (changed) { $('contentGrid').dataset.ready = ''; applyState({ ...state }); }
        else if (state.view === 'account') renderView();
    });
}

// Ссылка вида t.me/бот/app?startapp=film_42 (u_handle, view_top100) открывает
// приложение сразу на нужном фильме, коллекции или разделе
function applyStartParam() {
    const param = new URLSearchParams(location.hash.slice(1)).get('tgWebAppStartParam');
    if (!param || location.search) return;
    const film = param.match(/^film_(\d+)$/);
    const user = param.match(/^u_([a-z0-9_]{3,32})$/i);
    const view = param.match(/^view_(\w+)$/);
    const base = stateFromUrl('');
    if (film) history.replaceState(null, '', urlFor({ ...base, film: film[1] }));
    else if (user) history.replaceState(null, '', urlFor({ ...base, u: user[1].toLowerCase() }));
    else if (view && VIEW_TITLES[view[1]]) history.replaceState(null, '', urlFor({ ...base, view: view[1] }));
}

init();
