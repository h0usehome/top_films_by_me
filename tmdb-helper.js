// Поиск постеров, трейлеров и данных о фильмах через TMDB (админка).
// Запросы идут через Edge Function «tmdb» (supabase/functions/tmdb):
// из России api.themoviedb.org и youtube.com часто недоступны напрямую.

const TMDB_PROXY = `${SUPABASE_URL}/functions/v1/tmdb`;

async function tmdbProxy(body) {
    let res;
    try {
        res = await fetch(TMDB_PROXY, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        });
    } catch {
        throw new Error('Нет связи с сервером поиска. Проверьте интернет и попробуйте ещё раз.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.status_message || data.error || `Поиск: ошибка ${res.status}`);
    return data;
}

function tmdbGet(path, params) {
    return tmdbProxy({ action: 'get', path, params });
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

// TMDB хранит и ссылки на удалённые с YouTube ролики — доступность проверяет сервер
async function pickBestAvailableTrailer(videos) {
    const priority = v => v.type === 'Trailer' && v.official ? 0 : v.type === 'Trailer' ? 1 : v.type === 'Teaser' ? 2 : 3;
    const candidates = (videos || []).filter(v => v.site === 'YouTube' && v.key).sort((a, b) => priority(a) - priority(b)).slice(0, 8);
    if (!candidates.length) return null;
    let available = {};
    try {
        available = (await tmdbProxy({ action: 'youtube', ids: candidates.map(v => v.key) })).available || {};
    } catch {
        return candidates[0]; // не смогли проверить — лучше предложить ролик, чем ничего
    }
    return candidates.find(v => available[v.key] !== false) || null;
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

// ---------- Подробности для быстрого заполнения ----------

const capitalize = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;

// Названия жанров TMDB → привычные в коллекции
const GENRE_ALIASES = {
    'боевик и приключения': ['Боевик', 'Приключения'],
    'нф и фэнтези': ['Фантастика', 'Фэнтези'],
    'война и политика': ['Военный'],
    'музыка': ['Мюзикл'],
    'мультфильм': [],
    'документальный': ['Документальный'],
    'детский': ['Детский'],
    'реалити-шоу': ['Реалити']
};

function formatRuntime(minutes) {
    if (!minutes) return '';
    const h = Math.floor(minutes / 60), m = minutes % 60;
    return h ? `${h} ч${m ? ` ${m} мин` : ''}` : `${m} мин`;
}

// Всё, что нужно карточке: жанры, описание, режиссёр, актёры, страна, длительность, трейлер
async function tmdbDetails(id, mediaType) {
    const [ru, en] = await Promise.all([
        tmdbGet(`${mediaType}/${id}`, { language: 'ru-RU', append_to_response: 'credits,videos' }),
        tmdbGet(`${mediaType}/${id}`, { language: 'en-US', append_to_response: 'videos' }).catch(() => null)
    ]);

    const genreIds = (ru.genres || []).map(g => g.id);
    const animation = genreIds.includes(16);
    const genres = new Set();
    (ru.genres || []).forEach(g => {
        const name = (g.name || '').toLowerCase();
        (GENRE_ALIASES[name] ?? [capitalize(name)]).forEach(n => n && genres.add(n));
    });
    if (animation && ru.original_language === 'ja') genres.add('Аниме');

    const crew = ru.credits?.crew || [];
    const directors = mediaType === 'tv'
        ? (ru.created_by || []).map(p => p.name)
        : crew.filter(c => c.job === 'Director').map(c => c.name);
    const cast = (ru.credits?.cast || []).slice(0, 5).map(c => c.name);
    // TMDB отдаёт названия стран по-английски — переводим по коду
    const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['ru'], { type: 'region' }) : null;
    const countries = (ru.production_countries?.length ? ru.production_countries : (ru.origin_country || []))
        .map(c => {
            const code = typeof c === 'string' ? c : c.iso_3166_1;
            try { return (regionNames && code && regionNames.of(code)) || c.name || code; } catch { return c.name || code; }
        })
        .filter(Boolean).slice(0, 3);
    const runtime = ru.runtime || (ru.episode_run_time || [])[0] || 0;
    const seasons = mediaType === 'tv' && ru.number_of_seasons
        ? `${ru.number_of_seasons} ${plural(ru.number_of_seasons, 'сезон', 'сезона', 'сезонов')}` : '';

    const trailer = await pickBestAvailableTrailer([...(ru.videos?.results || []), ...(en?.videos?.results || [])]);

    return {
        type: animation ? 'cartoons' : mediaType === 'tv' ? 'series' : 'movies',
        title: ru.title || ru.name,
        originalTitle: ru.original_title || ru.original_name,
        year: (ru.release_date || ru.first_air_date || '').slice(0, 4),
        poster: ru.poster_path ? `https://image.tmdb.org/t/p/w500${ru.poster_path}` : '',
        genres: [...genres],
        overview: ru.overview || en?.overview || '',
        tagline: ru.tagline || '',
        directors, cast, countries,
        runtime: formatRuntime(runtime),
        seasons,
        trailer: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : ''
    };
}

// Описание для карточки: слоган, сюжет и справка
function detailsDescription(d) {
    const facts = [
        d.directors.length ? `🎬 ${d.type === 'series' ? 'Создатели' : 'Режиссёр'}: ${d.directors.join(', ')}` : '',
        d.cast.length ? `🎭 В ролях: ${d.cast.join(', ')}` : '',
        [d.countries.join(', '), d.seasons, d.runtime].filter(Boolean).length
            ? `🌍 ${[d.countries.join(', '), d.seasons, d.runtime].filter(Boolean).join(' · ')}` : ''
    ].filter(Boolean);
    const tagline = d.tagline && !/^[«"“„]/.test(d.tagline) ? `«${d.tagline}»` : d.tagline;
    return [tagline, d.overview, facts.join('\n')].filter(Boolean).join('\n\n');
}

function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
}
