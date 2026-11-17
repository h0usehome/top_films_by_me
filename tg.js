// Режим Telegram Mini App. В обычном браузере только создаёт window.tgAuth = Promise(null).
// Telegram передаёт параметры запуска в адресе (#tgWebAppData=…);
// после перезагрузки или перехода на другую страницу их помнит sessionStorage.
//
// Снаружи доступны:
//   window.tgAuth  — Promise: { access_token, refresh_token, expires_at, profile, app_link } или null
//   window.tgApp   — Telegram.WebApp после загрузки SDK (или null)

(function () {
    const SDK_URL = 'https://telegram.org/js/telegram-web-app.js';
    const BRAND_BG = '#0f0f13';
    const BAR_BG = '#121217';
    const AUTH_KEY = 'tg-auth';
    const PROFILE_KEY = 'tg-profile';

    const store = {
        get(storage, key) { try { return JSON.parse(storage.getItem(key)); } catch { return null; } },
        set(storage, key, value) { try { storage.setItem(key, JSON.stringify(value)); } catch { /* приватный режим */ } }
    };

    window.tgApp = null;

    const hashData = new URLSearchParams(location.hash.slice(1)).get('tgWebAppData');
    if (hashData) {
        sessionStorage.setItem('tg-mini-app', '1');
        sessionStorage.setItem('tg-init-data', hashData);
    }
    const initData = hashData || sessionStorage.getItem('tg-init-data');
    if (!initData || !sessionStorage.getItem('tg-mini-app')) {
        window.tgAuth = Promise.resolve(null);
        return;
    }

    document.documentElement.classList.add('tg');

    // Профиль с прошлого запуска — чтобы сразу показать свою коллекцию, не дожидаясь входа
    window.tgCachedProfile = store.get(localStorage, PROFILE_KEY);

    window.tgAuth = (async () => {
        const cached = store.get(sessionStorage, AUTH_KEY);
        if (cached && cached.expires_at * 1000 > Date.now() + 60000) return cached;
        try {
            const res = await fetch(TG_FUNCTION_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: 'auth', initData })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            store.set(sessionStorage, AUTH_KEY, data);
            store.set(localStorage, PROFILE_KEY, data.profile);
            return data;
        } catch (err) {
            console.error('Вход через Telegram не удался:', err);
            window.tgAuthError = err.message;
            return null;
        }
    })();

    // Подготовить красивое сообщение с постером (см. Edge Function) — id для shareMessage
    window.tgPrepareShare = async (filmId) => {
        const res = await fetch(TG_FUNCTION_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'share', initData, filmId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    };

    const script = document.createElement('script');
    script.src = SDK_URL;
    // start() использует функции страницы, поэтому ждём, пока выполнятся все скрипты
    script.onload = () => {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
        else start();
    };
    document.head.appendChild(script);

    function start() {
        const tg = window.Telegram && window.Telegram.WebApp;
        if (!tg || !tg.initData) {
            // Скрипт загрузился, но страница открыта не из Telegram
            document.documentElement.classList.remove('tg');
            sessionStorage.removeItem('tg-mini-app');
            return;
        }
        window.tgApp = tg;
        const supports = (version) => tg.isVersionAtLeast(version);

        tg.ready();
        tg.expand();

        // Сайт всегда тёмный: красим под него шапку и нижнюю панель Telegram
        if (supports('6.1')) tg.setBackgroundColor(BRAND_BG);
        if (supports('6.9')) tg.setHeaderColor(BRAND_BG);
        if (supports('7.10')) tg.setBottomBarColor(BAR_BG);

        // Иначе прокрутка вверх в длинном списке сворачивает приложение
        if (supports('7.7')) tg.disableVerticalSwipes();

        // Системная кнопка «Назад» повторяет логику Esc на странице
        if (supports('6.1') && typeof canGoBack === 'function') {
            const syncBack = () => {
                if (canGoBack()) tg.BackButton.show(); else tg.BackButton.hide();
            };
            tg.BackButton.onClick(() => {
                tg.HapticFeedback.selectionChanged();
                goBack();
            });
            document.addEventListener('app:change', syncBack);
            syncBack();
        }

        // Лёгкая вибрация на переходах, открытии фильма и трейлера
        if (supports('6.1')) {
            document.addEventListener('click', (e) => {
                if (e.target.closest('[data-trailer], a[data-film]')) tg.HapticFeedback.impactOccurred('light');
                else if (e.target.closest('a[data-nav], [data-action], .admin-nav a')) tg.HapticFeedback.selectionChanged();
            }, true);
            document.addEventListener('change', (e) => {
                if (e.target.matches('select')) tg.HapticFeedback.selectionChanged();
            });
        }

        document.dispatchEvent(new CustomEvent('tg:ready'));
    }
})();
