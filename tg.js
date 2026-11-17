// Режим Telegram Mini App. В обычном браузере ничего не делает.
// Telegram передаёт параметры запуска в адресе (#tgWebAppData=…);
// после перезагрузки страницы внутри Telegram их помнит sessionStorage.

(function () {
    const SDK_URL = 'https://telegram.org/js/telegram-web-app.js';
    const BRAND_BG = '#0f0f13';
    const BAR_BG = '#121217';

    const launched = /tgWebApp/.test(location.hash);
    if (launched) sessionStorage.setItem('tg-mini-app', '1');
    if (!launched && !sessionStorage.getItem('tg-mini-app')) return;

    document.documentElement.classList.add('tg');

    const script = document.createElement('script');
    script.src = SDK_URL;
    // start() использует функции из app.js, поэтому ждём, пока выполнятся все скрипты страницы
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
        const supports = (version) => tg.isVersionAtLeast(version);

        tg.ready();
        tg.expand();

        // Сайт всегда тёмный: красим под него шапку и нижнюю панель Telegram
        if (supports('6.1')) tg.setBackgroundColor(BRAND_BG);
        if (supports('6.9')) tg.setHeaderColor(BRAND_BG);
        if (supports('7.10')) tg.setBottomBarColor(BAR_BG);

        // Иначе прокрутка вверх в длинном списке сворачивает приложение
        if (supports('7.7')) tg.disableVerticalSwipes();

        // Системная кнопка «Назад» повторяет логику Esc на сайте
        if (supports('6.1')) {
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
                else if (e.target.closest('a[data-nav], [data-action]')) tg.HapticFeedback.selectionChanged();
            }, true);
            document.addEventListener('change', (e) => {
                if (e.target.matches('select')) tg.HapticFeedback.selectionChanged();
            });
        }
    }
})();
