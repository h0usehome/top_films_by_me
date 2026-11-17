// Общее для страниц админки: вход, навигация, сообщения об ошибках.
// Сами данные защищает RLS в Supabase: без входа база отклонит изменения.

const db = supabaseClient;

function showError(action, error) {
    console.error(action, error);
    const details = [error?.message, error?.details, error?.hint].filter(Boolean).join('\n');
    alert(`${action}\n\n${details || 'Подробности в консоли (F12).'}`);
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

// ---------- Вход ----------

function showGate() {
    if (document.querySelector('.auth-gate')) return;
    const gate = document.createElement('div');
    gate.className = 'auth-gate';
    gate.innerHTML = `
        <form>
            <h2>Вход в админку</h2>
            <p>Изменять коллекцию может только владелец.</p>
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
    form.email.focus();
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        button.disabled = true;
        button.textContent = 'Входим…';
        const { error } = await db.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
        button.disabled = false;
        button.textContent = 'Войти';
        if (error) {
            gate.querySelector('.auth-error').textContent = 'Неверный email или пароль';
            return;
        }
        gate.remove();
        document.documentElement.style.overflow = '';
        showLogout();
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
    const { data } = await db.auth.getSession();
    if (data.session) showLogout(); else showGate();
    db.auth.onAuthStateChange((event, session) => {
        if (session) return;
        document.querySelector('.logout')?.remove();
        showGate();
    });
}

highlightNav();
startAuth();
