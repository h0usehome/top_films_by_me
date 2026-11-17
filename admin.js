// Общее для страниц админки: вход, навигация, сообщения об ошибках.
// В Telegram вход автоматический (tg.js → Edge Function), в браузере — по email.
// Сами данные защищает RLS в Supabase: каждый меняет только свою коллекцию.

const db = supabaseClient;
let userId = null;

const inTelegram = () => document.documentElement.classList.contains('tg');

// В Telegram вместо системных alert/confirm — его собственные окна
function tgPopupsReady() {
    return window.tgApp && window.tgApp.isVersionAtLeast('6.2');
}

function appAlert(message) {
    if (tgPopupsReady()) return new Promise(resolve => window.tgApp.showAlert(String(message).slice(0, 256), resolve));
    alert(message);
    return Promise.resolve();
}

function appConfirm(message) {
    if (tgPopupsReady()) return new Promise(resolve => window.tgApp.showConfirm(String(message).slice(0, 256), resolve));
    return Promise.resolve(confirm(message));
}

function showError(action, error) {
    console.error(action, error);
    const details = [error?.message, error?.details, error?.hint].filter(Boolean).join('\n');
    return appAlert(`${action}\n\n${details || 'Подробности в консоли (F12).'}`);
}

function toastOk(text) {
    window.tgApp?.HapticFeedback?.notificationOccurred('success');
    let el = document.querySelector('.admin-toast');
    if (!el) {
        el = document.createElement('div');
        el.className = 'admin-toast';
        el.setAttribute('role', 'status');
        document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastOk.timer);
    toastOk.timer = setTimeout(() => el.classList.remove('show'), 2000);
}

// Выполняет запрос к Supabase и бросает ошибку, если она пришла в ответе
async function run(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
}

function itemMeta(item, extra = []) {
    const rating = item.rating !== null && item.rating !== undefined ? `★ ${item.rating}` : '';
    return [typeName(item.type), item.year, rating, ...extra].filter(Boolean).map(escapeHtml).join(' • ');
}

function highlightNav() {
    const here = location.pathname.split('/').pop() || 'admin.html';
    document.querySelectorAll('.admin-nav a').forEach(a => {
        const [page, hash = ''] = a.getAttribute('href').split('#');
        const active = page === here && (hash ? location.hash === `#${hash}` : !location.hash || here !== 'admin.html');
        a.classList.toggle('active', active);
        if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
}
window.addEventListener('hashchange', highlightNav);

// Кнопка «Назад» Telegram (tg.js вызывает эти функции): назад по истории, иначе в аккаунт
function canGoBack() { return true; }
function goBack() {
    if (history.length > 1 && document.referrer && new URL(document.referrer).origin === location.origin) history.back();
    else location.href = 'index.html?view=account';
}

// ---------- Вход ----------

let resolveAuth;
// Страницы ждут входа: authReady.then(load)
const authReady = new Promise(resolve => { resolveAuth = resolve; });

function signedIn(user) {
    userId = user.id;
    document.querySelector('.auth-gate')?.remove();
    document.documentElement.style.overflow = '';
    if (!inTelegram()) showLogout();
    resolveAuth(user);
}

function showGate(note = '') {
    if (document.querySelector('.auth-gate')) return;
    const gate = document.createElement('div');
    gate.className = 'auth-gate';
    gate.innerHTML = `
        <form>
            <h2>Вход в админку</h2>
            <p>${note ? escapeHtml(note) : 'Откройте приложение в Telegram — вход будет автоматическим. Или войдите по email.'}</p>
            <input type="email" name="email" placeholder="Email" autocomplete="username" required>
            <input type="password" name="password" placeholder="Пароль" autocomplete="current-password" required>
            <button type="submit" class="btn btn-primary">Войти</button>
            <div class="auth-error" role="alert"></div>
            <a href="index.html">← На сайт</a>
        </form>`;
    document.body.appendChild(gate);
    document.documentElement.style.overflow = 'hidden';

    const form = gate.querySelector('form');
    const button = form.querySelector('button');
    if (!inTelegram()) form.email.focus();
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        button.disabled = true;
        button.textContent = 'Входим…';
        const { data, error } = await db.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
        button.disabled = false;
        button.textContent = 'Войти';
        if (error) {
            gate.querySelector('.auth-error').textContent = 'Неверный email или пароль';
            return;
        }
        signedIn(data.user);
    });
}

function showLogout() {
    if (document.querySelector('.logout')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm logout';
    button.textContent = 'Выйти';
    button.addEventListener('click', () => db.auth.signOut());
    document.querySelector('.admin-header .container').appendChild(button);
}

async function startAuth() {
    // Telegram: сессию выдаёт Edge Function по подписанным данным запуска
    const tg = await window.tgAuth;
    if (tg) {
        const { data, error } = await db.auth.setSession({ access_token: tg.access_token, refresh_token: tg.refresh_token });
        if (!error && data.user) { signedIn(data.user); return; }
        console.error(error);
    }

    const { data } = await db.auth.getSession();
    if (data.session) signedIn(data.session.user);
    else showGate(inTelegram() ? `Не получилось войти через Telegram. ${window.tgAuthError || ''}` : '');

    db.auth.onAuthStateChange((event, session) => {
        if (session) return;
        document.querySelector('.logout')?.remove();
        showGate();
    });
}

highlightNav();
startAuth();
