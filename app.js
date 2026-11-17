const VIEW_TITLES = {
    main: 'Главная', movies: 'Фильмы', series: 'Сериалы', cartoons: 'Мультфильмы',
    top100: 'ТОП 100', new: 'Новинки', recent: 'Недавно добавлено', rewatch: 'Пересматриваем любимое'
};
const SITE_TITLE = 'Моя коллекция';
// Описание и отзыв — самые тяжёлые поля, их грузим при открытии карточки
const LIST_FIELDS = 'id,type,title,poster,year,rating,genres,toprank,customlists,created_at,rewatch,trailer';
const HOME_ROW_LIMIT = 10;
const RECENT_LIMIT = 24;

let items = [];
let state = { view: 'main', list: null, q: '', genre: 'all', sort: 'default', film: null };
let lastFocus = null;

const $ = (id) => document.getElementById(id);

// ---------- Данные ----------

async function api(path) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    if (!res.ok) throw new Error(`Supabase: ${res.status}`);
    return res.json();
}

async function loadDetails(item) {
    if (item.details) return item.details;
    const [row] = await api(`collection?select=description,review&id=eq.${encodeURIComponent(item.id)}`);
    item.details = { description: row?.description || '', review: row?.review || '' };
    return item.details;
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

// ---------- Адрес страницы ----------

function stateFromUrl(search = location.search) {
    const p = new URLSearchParams(search);
    const list = p.get('list');
    const view = list ? 'list' : (VIEW_TITLES[p.get('view')] ? p.get('view') : 'main');
    return {
        view,
        list: list || null,
        q: p.get('q') || '',
        genre: p.get('genre') || 'all',
        sort: p.get('sort') || 'default',
        film: p.get('film') || null
    };
}

function urlFor(s) {
    const p = new URLSearchParams();
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

function canGoBack() {
    return trailerOpen() || Boolean(state.film) || drawerOpen() || state.view !== 'main' || Boolean(state.q);
}

// Шаг назад: закрыть трейлер → карточку → меню → поиск → вернуться на главную
function goBack() {
    if (trailerOpen()) closeTrailer();
    else if (state.film) closeFilm();
    else if (drawerOpen()) closeDrawer();
    else if (document.activeElement === $('search') && state.q) go({ ...state, q: '' }, 'replace');
    else if (state.view !== 'main' || state.q) go({ ...stateFromUrl(''), film: null });
}

// Переход по ссылке из меню: новый раздел без поиска и фильтров
function navigateTo(href, fromDrawer) {
    const next = { ...stateFromUrl(new URL(href, location.href).search), film: null };
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
    applyState(stateFromUrl());
});

// ---------- Отрисовка ----------

function renderView() {
    const grid = $('contentGrid');
    grid.dataset.ready = '1';
    updateChrome();

    if (!items.length) {
        grid.className = 'grid';
        grid.innerHTML = '<div class="empty-state">Коллекция пока пуста.</div>';
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

function updateChrome() {
    const title = state.q ? `Поиск: «${state.q}»` : (state.view === 'list' ? state.list : VIEW_TITLES[state.view]);
    $('pageTitle').textContent = title;
    if (!state.film) document.title = state.view === 'main' && !state.q ? SITE_TITLE : `${title} — ${SITE_TITLE}`;

    const isMain = state.view === 'main' && !state.q;
    $('filtersBar').hidden = isMain;
    $('backToMain').hidden = isMain;
    $('genreSelect').value = state.genre;
    $('sortSelect').value = state.sort;

    const search = $('search');
    if (document.activeElement !== search) search.value = state.q;
    $('header').classList.toggle('search-open', Boolean(state.q) || $('header').classList.contains('search-focus'));

    const key = state.q ? null : viewKey(state);
    document.querySelectorAll('[data-key]').forEach(el => {
        const active = el.dataset.key === key;
        el.classList.toggle('active', active);
        if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
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

    const sections = [
        ['Недавно добавлено', itemsForView('recent'), '?view=recent', 'recent'],
        ['Новинки', itemsForView('new'), '?view=new', 'new'],
        ['ТОП 100', topItems(), '?view=top100', 'top100'],
        ['Пересматриваем любимое', itemsForView('rewatch'), '?view=rewatch', 'rewatch'],
        ...customLists().map(name => [name, itemsForView('list', name), `?list=${encodeURIComponent(name)}`, `list:${name}`])
    ].filter(([, list]) => list.length);

    grid.innerHTML = `
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
    <article class="card">
        <a class="card-link" href="${escapeHtml(urlFor({ ...state, film: item.id }))}" data-film="${escapeHtml(item.id)}" aria-label="${escapeHtml(label)}">
            ${posterImg(item.poster, { alt: '', lazy: !eager })}
            <div class="card-overlay">
                <div class="card-title">${escapeHtml(item.title)}</div>
                <div class="card-meta">${escapeHtml(item.year || '')} • ${typeName(item.type)}</div>
            </div>
        </a>
        ${item.rating !== null && item.rating !== '' ? `<span class="card-badge">★ ${escapeHtml(item.rating)}</span>` : ''}
        ${item.trailer ? `<button type="button" class="card-trailer" data-trailer="${escapeHtml(item.trailer)}" aria-label="Трейлер: ${escapeHtml(item.title)}">▶</button>` : ''}
    </article>`;
}

function topRow(item, rank) {
    const medal = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
    return `
    <article class="top-row">
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
    $('genreSelect').insertAdjacentHTML('beforeend', [...genres]
        .sort((a, b) => a.localeCompare(b, 'ru'))
        .map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join(''));
}

// ---------- Карточка фильма ----------

// [img]https://...[/img] внутри описания; остальной текст выводится как есть
function richText(text) {
    return escapeHtml(text).replace(/\[img\](.*?)\[\/img\]/gi, (m, url) =>
        /^https?:\/\/[^\s"'<>]+$/i.test(url) ? `<img class="rich-img" src="${url}" alt="" loading="lazy">` : '');
}

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
    const item = state.film && items.find(i => String(i.id) === String(state.film));

    if (!item) {
        if (overlay.hidden) return;
        overlay.classList.remove('active');
        setTimeout(() => { if (!state.film) overlay.hidden = true; }, 200);
        unlockScroll();
        updateChrome();
        if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
        return;
    }

    document.title = `${item.title} — ${SITE_TITLE}`;
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
        ...splitList(item.genres).map(g => `<span class="tag tag-genre">${escapeHtml(g)}</span>`)
    ].join('');

    return `
        <div class="film-poster">${posterImg(item.poster, { size: 'large', lazy: false })}</div>
        <div class="film-head">
            <h2 class="film-title" id="filmTitle">${escapeHtml(item.title)}</h2>
            <div class="film-tags">${tags}</div>
            ${item.trailer ? `<button type="button" class="btn-trailer" data-trailer="${escapeHtml(item.trailer)}">▶ Трейлер</button>` : ''}
        </div>
        <div class="film-text" id="filmText">${item.details ? filmTextHtml(item.details) : '<p class="muted">Загрузка описания…</p>'}</div>`;
}

function filmTextHtml({ description, review }) {
    const block = (title, text) => text ? `<section><h3>${title}</h3><p>${richText(text)}</p></section>` : '';
    return block('Описание', description) + block('Мой отзыв', review) || '<p class="muted">Описания пока нет.</p>';
}

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
    const trailer = e.target.closest('[data-trailer]');
    if (trailer) { e.preventDefault(); openTrailer(trailer.dataset.trailer); return; }

    const modified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;

    const film = e.target.closest('a[data-film]');
    if (film && !modified) { e.preventDefault(); openFilm(film.dataset.film); return; }

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
    }
});

// Клик по затемнению вокруг окна закрывает его
$('modalOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeFilm(); });
$('trailerOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeTrailer(); });

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
    state = { ...stateFromUrl(), film: null };
    try {
        items = await api(`collection?select=${LIST_FIELDS}`);
    } catch (err) {
        console.error(err);
        $('contentGrid').className = 'grid';
        $('contentGrid').innerHTML = '<div class="empty-state error">Не удалось загрузить коллекцию. Обновите страницу.</div>';
        return;
    }
    renderSidebarLists();
    renderGenreOptions();
    renderView();
    applyStartParam();
    applyState(stateFromUrl());
}

// Ссылка вида t.me/бот/app?startapp=film_42 (или view_top100) открывает
// приложение сразу на нужном фильме или разделе
function applyStartParam() {
    const param = new URLSearchParams(location.hash.slice(1)).get('tgWebAppStartParam');
    if (!param || location.search) return;
    const film = param.match(/^film_(\d+)$/);
    const view = param.match(/^view_(\w+)$/);
    if (film) history.replaceState(null, '', urlFor({ ...stateFromUrl(''), film: film[1] }));
    else if (view && VIEW_TITLES[view[1]]) history.replaceState(null, '', urlFor({ ...stateFromUrl(''), view: view[1] }));
}

init();
