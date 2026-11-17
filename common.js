// Общие функции витрины и админки

const TYPE_NAMES = { movies: 'Фильм', series: 'Сериал', cartoons: 'Мультфильм' };

function typeName(type) {
    return TYPE_NAMES[type] || 'Неизвестно';
}

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// "Драма, Триллер" → ['Драма', 'Триллер']
function splitList(value) {
    return (value || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Регистр и «ё» не мешают поиску
function normalizeSearch(value) {
    return String(value || '').toLowerCase().replace(/ё/g, 'е').trim();
}

function sortItems(items, sortKey) {
    const list = [...items];
    const num = (v, fallback) => (v === null || v === undefined || v === '') ? fallback : Number(v);
    if (sortKey === 'rating_desc') list.sort((a, b) => num(b.rating, -1) - num(a.rating, -1));
    else if (sortKey === 'rating_asc') list.sort((a, b) => num(a.rating, 99) - num(b.rating, 99));
    else if (sortKey === 'year_desc') list.sort((a, b) => num(b.year, 0) - num(a.year, 0));
    else if (sortKey === 'year_asc') list.sort((a, b) => num(a.year, 9999) - num(b.year, 9999));
    else if (sortKey === 'title') list.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
    return list;
}

// ---------- Постеры ----------

const FALLBACK_POSTER = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="200" height="300" fill="#1f1f1f"/>' +
    '<text x="50%" y="50%" fill="#555" font-size="16" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">Нет постера</text></svg>'
);

// TMDB и Кинопоиск отдают постеры в разных размерах: для карточек берём уменьшенный
const POSTER_SIZES = {
    small: { tmdb: 'w154', kp: '300x450' },
    card:  { tmdb: 'w342', kp: '300x450' },
    large: { tmdb: 'w500', kp: '600x900' }
};

function posterSrc(url, size = 'card') {
    const src = String(url || '').trim();
    if (!src) return FALLBACK_POSTER;

    const drive = src.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([\w-]+)/);
    if (drive) return `https://lh3.googleusercontent.com/d/${drive[1]}`;

    const s = POSTER_SIZES[size] || POSTER_SIZES.card;
    if (/image\.tmdb\.org\/t\/p\//.test(src)) return src.replace(/\/t\/p\/[^/]+\//, `/t/p/${s.tmdb}/`);
    if (/avatars\.mds\.yandex\.net\/get-kinopoisk-image\//.test(src)) return src.replace(/\/[^/]+$/, `/${s.kp}`);
    return src;
}

function posterImg(url, { size = 'card', alt = '', lazy = true, cls = '' } = {}) {
    return `<img class="poster ${cls}" src="${escapeHtml(posterSrc(url, size))}" data-original="${escapeHtml(url || '')}"` +
        ` alt="${escapeHtml(alt)}" decoding="async"${lazy ? ' loading="lazy"' : ''}>`;
}

// Если постер не загрузился: исходный размер → прокси wsrv.nl (выручает, когда
// источник блокируется сетью) → заглушка
document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('poster')) return;
    const original = img.dataset.original;
    const stage = img.dataset.stage || '';

    if (!stage && original && img.src !== original) {
        img.dataset.stage = 'original';
        img.src = original;
    } else if (stage !== 'proxy' && stage !== 'fallback' && original && /^https?:\/\//.test(original)) {
        img.dataset.stage = 'proxy';
        img.src = 'https://wsrv.nl/?url=' + encodeURIComponent(original.replace(/^https?:\/\//, ''));
    } else if (stage !== 'fallback') {
        img.dataset.stage = 'fallback';
        img.src = FALLBACK_POSTER;
    }
}, true);
