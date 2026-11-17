// Edge Function «tmdb»: посредник между админкой и TMDB / YouTube.
// Из России api.themoviedb.org и youtube.com часто недоступны напрямую,
// а Supabase открывается — поэтому запросы идут через сервер.
//
// POST { action: 'get', path, params }  → ответ TMDB (только разрешённые пути)
// POST { action: 'youtube', ids: [...] } → какие ролики ещё доступны на YouTube
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

// Только то, что нужно админке
const ALLOWED = [
    /^search\/(multi|movie|tv)$/,
    /^(movie|tv)\/\d+$/,
    /^(movie|tv)\/\d+\/videos$/
];
const ALLOWED_PARAMS = ['query', 'language', 'include_adult', 'year', 'page', 'append_to_response', 'include_video_language'];

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    try {
        const body = await req.json().catch(() => ({}));

        if (body.action === 'get') {
            const path = String(body.path || '');
            if (!ALLOWED.some(re => re.test(path))) return json({ error: 'Путь не разрешён' }, 400);
            const params = new URLSearchParams({ api_key: TMDB_KEY });
            for (const key of ALLOWED_PARAMS) {
                const value = body.params?.[key];
                if (value !== undefined && value !== null && value !== '') params.set(key, String(value).slice(0, 200));
            }
            const res = await fetch(`https://api.themoviedb.org/3/${path}?${params}`, { signal: AbortSignal.timeout(10000) });
            const data = await res.json();
            return json(data, res.status);
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
