// Поиск постеров и трейлеров через TMDB (админка)

async function tmdbGet(path, params) {
    const query = new URLSearchParams({ api_key: TMDB_API_KEY, ...params });
    const res = await fetch(`https://api.themoviedb.org/3/${path}?${query}`);
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.status_message || `TMDB: ${res.status}`);
    return data;
}

async function tmdbSearchMulti(title, language) {
    const data = await tmdbGet('search/multi', { language, include_adult: 'false', query: title });
    return (data.results || []).filter(r => (r.media_type === 'movie' || r.media_type === 'tv') && r.poster_path);
}

// Сначала нужный тип (фильм/сериал), потом совпадение по году, потом популярность
function rankTmdbResults(results, preferredType, year) {
    const yearOf = r => (r.release_date || r.first_air_date || '').slice(0, 4);
    return [...results].sort((a, b) =>
        ((b.media_type === preferredType) - (a.media_type === preferredType))
        || (year ? (yearOf(b) === String(year)) - (yearOf(a) === String(year)) : 0)
        || (b.popularity || 0) - (a.popularity || 0));
}

// Русское название, а если не нашлось — английское (у многих сериалов нет перевода)
async function tmdbFind(title, type, year) {
    let results = await tmdbSearchMulti(title, 'ru-RU');
    if (!results.length) results = await tmdbSearchMulti(title, 'en-US');
    return rankTmdbResults(results, type === 'series' ? 'tv' : 'movie', year);
}

// TMDB хранит и ссылки на удалённые с YouTube ролики, поэтому проверяем
// доступность через публичный oEmbed (без ключа)
async function isYouTubeVideoAvailable(videoId) {
    try {
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
        return res.ok;
    } catch {
        return true; // сеть недоступна — лучше предложить ролик, чем ничего
    }
}

async function pickBestAvailableTrailer(videos) {
    const priority = v => v.type === 'Trailer' && v.official ? 0 : v.type === 'Trailer' ? 1 : v.type === 'Teaser' ? 2 : 3;
    const candidates = (videos || []).filter(v => v.site === 'YouTube' && v.key).sort((a, b) => priority(a) - priority(b));
    for (const v of candidates) {
        if (await isYouTubeVideoAvailable(v.key)) return v;
    }
    return null;
}

async function findTrailerForTmdbItem(tmdbId, mediaType) {
    for (const language of ['ru-RU', 'en-US']) {
        const data = await tmdbGet(`${mediaType}/${tmdbId}/videos`, { language });
        const trailer = await pickBestAvailableTrailer(data.results);
        if (trailer) return trailer;
    }
    return null;
}

async function findTrailerByTitle(title, type, year) {
    const [best] = await tmdbFind(title, type, year);
    if (!best) return null;
    const trailer = await findTrailerForTmdbItem(best.id, best.media_type === 'tv' ? 'tv' : 'movie');
    return trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null;
}
