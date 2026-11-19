// Edge Function «tmdb»: посредник между сайтом и TMDB / YouTube.
// Из России api.themoviedb.org и youtube.com часто недоступны напрямую,
// а Supabase открывается — поэтому запросы идут через сервер.
//
// POST { action: 'get', path, params }        → ответ TMDB (только разрешённые пути)
// POST { action: 'batch', requests: [{ path, params }, …] } → массив ответов (до 12 за раз)
// POST { action: 'youtube', ids: [...] }       → какие ролики ещё доступны на YouTube
//
// Ключ TMDB публичный (лежит и в config.js сайта); можно переопределить секретом TMDB_API_KEY.

const TMDB_KEY = Deno.env.get('TMDB_API_KEY') ?? '3a3430d210cbf6ae4ee54b1ffc523ddd';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

// Поиск и карточки — для админки; подборки и «похожие» — для онбординга и рекомендаций
const ALLOWED = [
    /^search\/(multi|movie|tv)$/,
    /^(movie|tv)\/\d+$/,
    /^(movie|tv)\/\d+\/(videos|recommendations)$/,
    /^(movie|tv)\/(popular|top_rated)$/,
    /^trending\/(all|movie|tv)\/(day|week)$/,
    /^discover\/(movie|tv)$/,
    /^genre\/(movie|tv)\/list$/
];
const ALLOWED_PARAMS = [
    'query', 'language', 'include_adult', 'year', 'page', 'append_to_response', 'include_video_language',
    'region', 'sort_by', 'with_genres', 'without_genres', 'vote_count.gte', 'vote_average.gte', 'with_original_language'
];
const BATCH_LIMIT = 12;

// Подборки меняются редко: держим ответы в памяти экземпляра функции
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; status: number; data: unknown }>();

async function tmdb(path: unknown, rawParams: Record<string, unknown> | undefined) {
    const p = String(path || '');
    if (!ALLOWED.some(re => re.test(p))) return { status: 400, data: { error: 'Путь не разрешён' } };

    const params = new URLSearchParams({ api_key: TMDB_KEY });
    for (const key of ALLOWED_PARAMS) {
        const value = rawParams?.[key];
        if (value !== undefined && value !== null && value !== '') params.set(key, String(value).slice(0, 200));
    }
    const url = `https://api.themoviedb.org/3/${p}?${params}`;

    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;

    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const entry = { at: Date.now(), status: res.status, data: await res.json() };
    if (res.ok) {
        if (cache.size > 500) cache.delete(cache.keys().next().value!);
        cache.set(url, entry);
    }
    return entry;
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    try {
        const body = await req.json().catch(() => ({}));

        if (body.action === 'get') {
            const { status, data } = await tmdb(body.path, body.params);
            return json(data, status);
        }

        if (body.action === 'batch') {
            const requests = (Array.isArray(body.requests) ? body.requests : []).slice(0, BATCH_LIMIT);
            const results = await Promise.all(requests.map(async (r: { path?: string; params?: Record<string, unknown> }) => {
                try {
                    const { status, data } = await tmdb(r?.path, r?.params);
                    return status < 400 ? data : { error: (data as { status_message?: string; error?: string })?.status_message || (data as { error?: string })?.error || `TMDB: ${status}` };
                } catch (err) {
                    return { error: err instanceof Error ? err.message : String(err) };
                }
            }));
            return json({ results });
        }

        if (body.action === 'youtube') {
            const ids: string[] = (Array.isArray(body.ids) ? body.ids : []).filter((id: unknown) => /^[\w-]{6,20}$/.test(String(id))).slice(0, 15);
            const checks = await Promise.all(ids.map(async (id) => {
                try {
                    const url = `https://www.youtube.com/watch?v=${id}`;
                    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { signal: AbortSignal.timeout(5000) });
                    return [id, res.ok] as const;
                } catch {
                    return [id, true] as const; // не смогли проверить — лучше предложить ролик
                }
            }));
            return json({ available: Object.fromEntries(checks) });
        }

        return json({ error: 'Неизвестное действие' }, 400);
    } catch (err) {
        console.error(err);
        return json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
});
