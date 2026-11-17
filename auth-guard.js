// =====================================================================
// ВХОД В АДМИНКУ
// Подключается после config.js на admin.html, database.html, lists.html.
// Пока владелец не вошёл, страница закрыта экраном входа.
// Сама защита данных — на стороне Supabase (RLS): без входа база
// отклонит любые изменения, даже если обойти этот экран.
// Сессия хранится supabase-js в localStorage, поэтому между страницами
// админки повторно входить не нужно.
// =====================================================================

(function () {
    const STYLE = `
        #authGate { position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center;
            background: #0f0f13; padding: 20px; font-family: 'Segoe UI', system-ui, sans-serif; }
        #authGate form { width: 100%; max-width: 360px; background: linear-gradient(145deg, #1e1e24, #151519);
            border: 1px solid rgba(255,255,255,0.06); border-radius: 16px; padding: 28px; box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
        #authGate h2 { color: #fff; font-size: 22px; margin: 0 0 6px; }
        #authGate p { color: #8a8a93; font-size: 13px; margin: 0 0 20px; }
        #authGate input { width: 100%; box-sizing: border-box; padding: 12px 14px; margin-bottom: 12px; border-radius: 10px;
            border: 1px solid rgba(255,255,255,0.1); background: #0f0f13; color: #fff; font-size: 16px; outline: none; }
        #authGate input:focus { border-color: #e50914; }
        #authGate button { width: 100%; padding: 12px; border: none; border-radius: 10px; cursor: pointer; font-size: 15px; font-weight: 700;
            color: #fff; background: linear-gradient(135deg, #e50914, #a60000); }
        #authGate button:disabled { opacity: 0.6; cursor: default; }
        #authGate .auth-error { color: #ff4d4d; font-size: 13px; min-height: 18px; margin-top: 10px; }
        #authGate a { display: block; text-align: center; margin-top: 16px; color: #8a8a93; font-size: 13px; text-decoration: none; }
        #authLogout { position: fixed; right: 14px; bottom: 14px; z-index: 9999; padding: 8px 14px; border-radius: 20px; cursor: pointer;
            font-size: 13px; color: #ccc; background: rgba(30,30,36,0.9); border: 1px solid rgba(255,255,255,0.1); }
        #authLogout:hover { color: #fff; border-color: #e50914; }
    `;

    function injectStyle() {
        const s = document.createElement('style');
        s.textContent = STYLE;
        document.head.appendChild(s);
    }

    function showGate() {
        if (document.getElementById('authGate')) return;
        const gate = document.createElement('div');
        gate.id = 'authGate';
        gate.innerHTML = `
            <form autocomplete="on">
                <h2>Вход в админку</h2>
                <p>Изменять коллекцию может только владелец.</p>
                <input type="email" name="email" placeholder="Email" autocomplete="username" required>
                <input type="password" name="password" placeholder="Пароль" autocomplete="current-password" required>
                <button type="submit">Войти</button>
                <div class="auth-error"></div>
                <a href="index.html">← На сайт</a>
            </form>`;
        document.body.appendChild(gate);
        document.body.style.overflow = 'hidden';

        const form = gate.querySelector('form');
        const errBox = gate.querySelector('.auth-error');
        const btn = gate.querySelector('button');
        form.querySelector('input').focus();

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errBox.textContent = '';
            btn.disabled = true;
            btn.textContent = 'Входим...';
            const { error } = await supabaseClient.auth.signInWithPassword({
                email: form.email.value.trim(),
                password: form.password.value
            });
            btn.disabled = false;
            btn.textContent = 'Войти';
            if (error) {
                errBox.textContent = 'Неверный email или пароль';
                return;
            }
            hideGate();
        });
    }

    function hideGate() {
        const gate = document.getElementById('authGate');
        if (gate) gate.remove();
        document.body.style.overflow = '';
        showLogout();
    }

    function showLogout() {
        if (document.getElementById('authLogout')) return;
        const btn = document.createElement('button');
        btn.id = 'authLogout';
        btn.type = 'button';
        btn.textContent = 'Выйти';
        btn.addEventListener('click', async () => {
            await supabaseClient.auth.signOut();
            btn.remove();
            showGate();
        });
        document.body.appendChild(btn);
    }

    async function start() {
        injectStyle();
        const { data } = await supabaseClient.auth.getSession();
        if (data && data.session) showLogout(); else showGate();

        // Если сессия истекла или пользователь вышел в другой вкладке
        supabaseClient.auth.onAuthStateChange((event, session) => {
            if (!session) {
                const b = document.getElementById('authLogout');
                if (b) b.remove();
                showGate();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
