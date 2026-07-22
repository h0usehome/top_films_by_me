// =====================================================================
// ОБЩИЕ ФУНКЦИИ ПОИСКА ПОСТЕРОВ ЧЕРЕЗ TMDB
// Используются и в admin.html (поиск при добавлении/редактировании),
// и в database.html (массовый поиск для уже добавленных фильмов),
// чтобы логика поиска не расходилась между страницами.
// =====================================================================

async function tmdbSearchMulti(title, language) {
    const url = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=${language}&include_adult=false&query=${encodeURIComponent(title)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || data.success === false) {
        throw new Error(data.status_message || ('TMDB request failed: ' + res.status));
    }
    return (data.results || []).filter(r => (r.media_type === 'movie' || r.media_type === 'tv') && r.poster_path);
}

function rankTmdbResults(results, preferredType, year) {
    return [...results].sort((a, b) => {
        // Сначала совпадение по нужному типу (фильм/сериал)
        const aTypeMatch = a.media_type === preferredType ? 1 : 0;
        const bTypeMatch = b.media_type === preferredType ? 1 : 0;
        if (aTypeMatch !== bTypeMatch) return bTypeMatch - aTypeMatch;

        // Затем совпадение по году, если он указан
        if (year) {
            const aYear = (a.release_date || a.first_air_date || '').slice(0, 4);
            const bYear = (b.release_date || b.first_air_date || '').slice(0, 4);
            const aYearMatch = aYear === String(year) ? 1 : 0;
            const bYearMatch = bYear === String(year) ? 1 : 0;
            if (aYearMatch !== bYearMatch) return bYearMatch - aYearMatch;
        }

        // Затем по популярности
        return (b.popularity || 0) - (a.popularity || 0);
    });
}

// =====================================================================
// ПОИСК ТРЕЙЛЕРА НА YOUTUBE ЧЕРЕЗ TMDB
// Используем тот же tmdbId/media_type, что уже получен при поиске
// постера, чтобы не делать повторный запрос по названию.
// =====================================================================

async function tmdbFetchVideos(tmdbId, mediaType, language) {
    const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/videos?api_key=${TMDB_API_KEY}&language=${language}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
        throw new Error(data.status_message || ('TMDB request failed: ' + res.status));
    }
    return data.results || [];
}

// Сортирует ролики с YouTube по приоритету: сначала официальный трейлер,
// потом любой трейлер, потом тизер.
function sortTrailerCandidates(videos) {
    const yt = (videos || []).filter(v => v.site === 'YouTube' && v.key);
    const priority = v => {
        if (v.type === 'Trailer' && v.official) return 0;
        if (v.type === 'Trailer') return 1;
        if (v.type === 'Teaser') return 2;
        return 3;
    };
    yt.sort((a, b) => priority(a) - priority(b));
    return yt;
}

// TMDB иногда хранит ссылки на ролики, которые на самом YouTube уже удалены
// или закрыты (как было с одним из трейлеров «Мстители: Финал») — TMDB это
// не отслеживает. Проверяем реальную доступность через публичный oEmbed
// YouTube (не требует API-ключа): если видео недоступно, он отвечает не-200.
async function isYouTubeVideoAvailable(videoId) {
    try {
        const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}&format=json`);
        return res.ok;
    } catch (e) {
        // Если проверка не удалась из-за сети — не блокируем выбор, лучше
        // предложить ролик, чем не предложить ничего.
        return true;
    }
}

// Перебирает кандидатов по приоритету и возвращает первый реально доступный.
async function pickBestAvailableTrailer(videos) {
    const candidates = sortTrailerCandidates(videos);
    for (const v of candidates) {
        if (await isYouTubeVideoAvailable(v.key)) return v;
    }
    return null;
}



// =====================================================================
// ОБХОД БЛОКИРОВКИ ПОСТЕРОВ TMDB НА МОБИЛЬНЫХ СЕТЯХ
// У некоторых мобильных операторов домен image.tmdb.org блокируется
// (или блокируется сильнее, чем на Wi-Fi/десктопе), из-за чего постеры,
// добавленные через автопоиск TMDB, на телефоне не грузятся.
//
// Раньше все TMDB-постеры сразу грузились через прокси wsrv.nl — это
// решало проблему блокировки, но добавляло лишний прыжок (браузер →
// wsrv.nl → TMDB → обратно) для ВСЕХ пользователей, из-за чего постеры
// грузились заметно медленнее даже там, где блокировки нет.
//
// Теперь грузим напрямую с TMDB (быстрый путь для большинства), а прокси
// подключаем только как fallback — если прямая ссылка не загрузилась.
// =====================================================================

function posterSrc(url) {
    return url || '';
}

// Вешается через onerror="handlePosterError(this)" на <img>, у которого
// в data-original лежит исходная ссылка на постер. Первая ошибка загрузки
// (например, из-за блокировки на мобильной сети) — пробуем через прокси
// wsrv.nl. Если и прокси не помог — оставляем пустой тёмный блок вместо
// сломанной иконки картинки.
function handlePosterError(imgEl) {
    const original = imgEl.dataset.original || '';
    if (!original) { imgEl.removeAttribute('onerror'); return; }
    if (imgEl.dataset.posterStage === 'proxy') {
        imgEl.removeAttribute('onerror');
        imgEl.removeAttribute('src');
        return;
    }
    imgEl.dataset.posterStage = 'proxy';
    if (original.includes('image.tmdb.org')) {
        imgEl.src = 'https://wsrv.nl/?url=' + encodeURIComponent(original.replace(/^https?:\/\//, ''));
    } else {
        imgEl.removeAttribute('onerror');
    }
}
