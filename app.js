function escapeAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function posterSrc(poster) {
    if (!poster || !String(poster).trim()) return FALLBACK_POSTER;
    const url = String(poster).trim();
    const driveMatch = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([\w-]+)/);
    if (driveMatch) {
        return `https://lh3.googleusercontent.com/d/${driveMatch[1]}`;
    }
    return url;
}

const FALLBACK_POSTER = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">
        <rect width="200" height="300" fill="#1f1f1f"/>
        <text x="50%" y="50%" fill="#555" font-size="16" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">Нет постера</text>
    </svg>`
);

function proxiedPosterUrl(url) {
    const bare = String(url).replace(/^https?:\/\//, '');
    return `https://wsrv.nl/?url=${encodeURIComponent(bare)}`;
}

function handlePosterError(imgEl) {
    const original = imgEl.dataset.original;
    if (!imgEl.dataset.triedProxy && original && original.trim()) {
        imgEl.dataset.triedProxy = '1';
        imgEl.src = proxiedPosterUrl(original.trim());
        return;
    }
    imgEl.onerror = null;
    imgEl.src = FALLBACK_POSTER;
}

const SUPABASE_URL = 'https://ktacbvcwsyajpeacdmwt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0YWNidmN3c3lhanBlYWNkbXd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NjM4NDgsImV4cCI6MjEwMDEzOTg0OH0.OhjANu7A7Wb7GUsBjVzrvjkGJlgVsehSf6EyC1DMxR8';        
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const onlineChannel = supabaseClient.channel('online-users');

onlineChannel
  .on('presence', { event: 'sync' }, () => {
    const presenceState = onlineChannel.presenceState();
    const onlineCount = Object.keys(presenceState).length;
    const counterEl = document.getElementById('online-counter');
    if (counterEl) {
        counterEl.innerText = `Онлайн: ${onlineCount}`;
    }
  })
  .subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await onlineChannel.track({
        user_id: 'guest_' + Math.random().toString(36).substring(2, 9),
        online_at: new Date().toISOString()
      });
    }
  });

let allData = [];
let currentFilter = 'main';
let currentSort = 'default';
let currentGenre = 'all'; 

function generateGenres() {
    const genreSet = new Set();
    allData.forEach(item => {
        if(item.genres) {
            item.genres.split(',').forEach(g => {
                const cleanName = g.trim();
                if(cleanName) genreSet.add(cleanName);
            });
        }
    });

    const select = document.getElementById('genreSelect');
    const sortedGenres = Array.from(genreSet).sort((a, b) => a.localeCompare(b, 'ru'));
    
    sortedGenres.forEach(genre => {
        const option = document.createElement('option');
        option.value = genre;
        option.textContent = genre;
        select.appendChild(option);
    });
}

function setGenreFilter(genre) {
    currentGenre = genre;
    render();
}

const FILTER_TITLES = {
    main: 'Главная', movies: 'Фильмы', series: 'Сериалы', cartoons: 'Мультфильмы',
    top100: 'ТОП 100', new: 'Новинки', recent: 'Недавно добавлено', rewatch: 'Пересматриваем любимое'
};

const TYPE_NAMES = { movies: 'Фильм', series: 'Сериал', cartoons: 'Мультфильм' };

function getTypeName(type) { return TYPE_NAMES[type] || 'Неизвестно'; }

function getUniqueCustomLists() {
    const listSet = new Set();
    allData.forEach(item => {
        if (item.customlists) {
            item.customlists.split(',').forEach(l => {
                const cleanName = l.trim();
                if (cleanName) listSet.add(cleanName);
            });
        }
    });
    return Array.from(listSet);
}

document.addEventListener('DOMContentLoaded', init);

async function init() {
    try {
        const { data, error } = await supabaseClient.from('collection').select('*');
        if (error) throw error;
        
        allData = data || [];
        generateCustomLists();
        generateGenres();
        render();
    } catch (error) {
        console.error("Ошибка Supabase:", error);
        document.getElementById('contentGrid').innerHTML = '<div class="empty-state" style="color:var(--primary);">Ошибка загрузки базы данных. Проверьте консоль.</div>';
    }
}

function isSidebarOpen() { return document.getElementById('sidebar').classList.contains('open'); }

function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    const overlay = document.getElementById('sidebarOverlay');
    overlay.classList.add('open');
    requestAnimationFrame(() => overlay.classList.add('visible'));
    history.pushState({ sidebarOpen: true }, '');
}

function closeSidebar(skipHistoryBack) {
    document.getElementById('sidebar').classList.remove('open');
    const overlay = document.getElementById('sidebarOverlay');
    overlay.classList.remove('visible');
    setTimeout(() => overlay.classList.remove('open'), 300);
    if (!skipHistoryBack && history.state && history.state.sidebarOpen) {
        history.back();
    }
}

function toggleSidebar() {
    if (isSidebarOpen()) closeSidebar(); else openSidebar();
}

window.addEventListener('popstate', () => {
    if (isSidebarOpen()) closeSidebar(true);
});

function setFilter(filterType, el) {
    currentFilter = filterType;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');

    document.getElementById('pageTitle').textContent = FILTER_TITLES[filterType] || el.textContent.trim();
    document.getElementById('genreSelect').value = 'all';
    currentGenre = 'all';
    document.getElementById('filtersBar').style.display = (filterType === 'main') ? 'none' : 'flex';

    const backBtn = document.getElementById('backToMainBtn');
    if (backBtn) { backBtn.style.display = (filterType === 'main') ? 'none' : 'flex'; }
    if(window.innerWidth <= 768 && isSidebarOpen()) closeSidebar();
    render();
}

function goToFilter(filterType) {
    const el = document.querySelector('.nav-item[data-filter="' + CSS.escape(filterType) + '"]');
    if (el) { setFilter(filterType, el); } else { currentFilter = filterType; render(); }
}

function setSort(sortType) {
    currentSort = sortType;
    render();
}

function generateCustomLists() {
    const uniqueLists = getUniqueCustomLists();
    const container = document.getElementById('dynamicLists');
    container.innerHTML = uniqueLists.map(listName => 
        `<div class="nav-item" data-filter="${escapeAttr(listName)}" onclick="setFilter('${listName.replace(/'/g, "\\'")}', this)">📌 ${listName}</div>`
    ).join('');
}

function render() {
    const grid = document.getElementById('contentGrid');
    if (allData.length === 0) {
        grid.className = 'grid';
        grid.innerHTML = '<div class="empty-state">Ваша коллекция пока пуста. Добавьте первый фильм в админке!</div>';
        return;
    }
    if (currentFilter === 'main') {
        renderHome();
        return;
    }

    let filtered = [...allData];

    if (currentFilter === 'movies' || currentFilter === 'series' || currentFilter === 'cartoons') {
        filtered = filtered.filter(i => i.type === currentFilter);
    } else if (currentFilter === 'top100') {
        filtered = filtered.filter(i => i.toprank && i.toprank > 0).sort((a, b) => a.toprank - b.toprank).slice(0, 100);
    } else if (currentFilter === 'new') {
        const currentYear = new Date().getFullYear(); 
        filtered = filtered.filter(i => i.year === currentYear);
    } else if (currentFilter === 'recent') {
        filtered = [...filtered]
            .filter(i => i.created_at && !isNaN(new Date(i.created_at)))
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 12);
    } else if (currentFilter === 'rewatch') {
        filtered = filtered.filter(i => i.rewatch === true);
    } else {
        filtered = filtered.filter(i => {
            if (!i.customlists) return false;
            const lists = i.customlists.split(',').map(l => l.trim());
            return lists.includes(currentFilter);
        });
    }

    if (currentGenre !== 'all') {
        filtered = filtered.filter(i => {
            if (!i.genres) return false;
            const itemGenres = i.genres.split(',').map(g => g.trim());
            return itemGenres.includes(currentGenre);
        });
    }

    if (currentSort === 'rating_desc') {
        filtered.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    } else if (currentSort === 'rating_asc') {
        filtered.sort((a, b) => (a.rating ?? 999) - (b.rating ?? 999));
    } else if (currentSort === 'year_desc') {
        filtered.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    } else if (currentSort === 'year_asc') {
        filtered.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
    }
    
    if (filtered.length === 0) {
        grid.className = 'grid';
        grid.innerHTML = '<div class="empty-state">В этой категории пока ничего нет.</div>';
        return;
    }

    if (currentFilter === 'top100') {
        grid.className = 'top100-list';
        grid.innerHTML = filtered.map(item => renderTop100Row(item)).join('');
    } else {
        grid.className = 'grid';
        grid.innerHTML = filtered.map(item => renderCard(item)).join('');
    }
}

function computeStats(data) {
    const total = data.length;
    const movies = data.filter(i => i.type === 'movies').length;
    const series = data.filter(i => i.type === 'series').length;
    const cartoons = data.filter(i => i.type === 'cartoons').length;
    const rated = data.filter(i => i.rating !== null && i.rating !== undefined && i.rating !== '');
    const avgRating = rated.length ? (rated.reduce((s, i) => s + Number(i.rating), 0) / rated.length) : null;
    return { total, movies, series, cartoons, avgRating };
}

function renderHome() {
    const grid = document.getElementById('contentGrid');
    grid.className = 'home-dashboard';

    const stats = computeStats(allData);

    let html = `
    <div class="stats-bar">
        <div class="stat-box"><div class="stat-value">${stats.total}</div><div class="stat-label">Всего в коллекции</div></div>
        <div class="stat-box"><div class="stat-value">${stats.movies}</div><div class="stat-label">Фильмов</div></div>
        <div class="stat-box"><div class="stat-value">${stats.series}</div><div class="stat-label">Сериалов</div></div>
        <div class="stat-box"><div class="stat-value">${stats.cartoons}</div><div class="stat-label">Мультфильмов</div></div>
        <div class="stat-box"><div class="stat-value">${stats.avgRating ? stats.avgRating.toFixed(1) : '-'}</div><div class="stat-label">Средняя оценка</div></div>
    </div>
    `;

    let anySection = false;

    const recent = [...allData]
        .filter(i => i.created_at && !isNaN(new Date(i.created_at)))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 7);
    if (recent.length) { html += renderHomeSection('Недавно добавлено', recent, 'recent'); anySection = true; }

    const currentYear = new Date().getFullYear();
    const newReleases = allData.filter(i => i.year === currentYear).slice(0, 7);
    if (newReleases.length) { html += renderHomeSection('Новинки', newReleases, 'new'); anySection = true; }
    
    const top = [...allData]
        .filter(i => i.toprank && i.toprank > 0)
        .sort((a, b) => a.toprank - b.toprank)
        .slice(0, 7);
    if (top.length) { html += renderHomeSection('ТОП 100', top, 'top100'); anySection = true; }

    const rewatch = allData.filter(i => i.rewatch === true).slice(0, 7);
    if (rewatch.length) { html += renderHomeSection('Пересматриваем любимое', rewatch, 'rewatch'); anySection = true; }

    const uniqueLists = getUniqueCustomLists();
    
    uniqueLists.forEach(listName => {
        const items = allData.filter(i => {
            if (!i.customlists) return false;
            return i.customlists.split(',').map(l => l.trim()).includes(listName);
        }).slice(0, 7);
        if (items.length) { html += renderHomeSection(listName, items, listName); anySection = true; }
    });

    if (!anySection) { html += '<div class="empty-state">Пока нечего показать — добавьте фильмы в подборки.</div>'; }

    grid.innerHTML = html;
    markScrollableRows();
}

function markScrollableRows() {
    const grid = document.getElementById('contentGrid');
    requestAnimationFrame(() => {
        grid.querySelectorAll('.home-row').forEach(row => {
            const section = row.closest('.home-section');
            if (!section) return;
            if (row.scrollWidth > row.clientWidth + 4) {
                section.classList.add('scrollable');
            } else {
                section.classList.remove('scrollable');
            }
        });
    });
}

function renderHomeSection(title, items, filterKey) {
    const safeKey = filterKey.replace(/'/g, "\\'");
    return `
    <div class="home-section">
        <div class="home-section-header">
            <h2 onclick="goToFilter('${safeKey}')">${escapeAttr(title)}</h2>
            <span class="see-all" onclick="goToFilter('${safeKey}')">Смотреть все →</span>
        </div>
        <div class="home-row">${items.map(renderCard).join('')}</div>
    </div>
    `;
}

function renderCard(item) {
    const typeName = getTypeName(item.type);
    const trailerBtn = item.trailer ? `<div class="card-trailer-btn" onclick="openTrailer('${escapeAttr(item.trailer)}', event)" title="Смотреть трейлер">▶</div>` : '';
    const ratingBadge = item.rating ? `<div class="card-badge">★ ${item.rating}</div>` : '';
    
    return `
    <div class="card" onclick="openModal('${item.id}')">
        ${ratingBadge}
        <img src="${posterSrc(item.poster)}" data-original="${escapeAttr(item.poster)}" onerror="handlePosterError(this)" alt="Постер" decoding="async">
        <div class="card-overlay">
            <div class="card-title">${item.title}</div>
            <div class="card-meta">
                <span>${item.year}</span>
                <span>•</span>
                <span>${typeName}</span>
            </div>
        </div>
        ${trailerBtn}
    </div>
    `;
}

function renderTop100Row(item) {
    const typeName = getTypeName(item.type);
    const rank = item.toprank;
    const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
    const trailerLink = item.trailer ? `<span class="see-all" onclick="openTrailer('${escapeAttr(item.trailer)}', event)">▶ Трейлер</span>` : '';
    return `
    <div class="top100-row" onclick="openModal('${item.id}')">
        <div class="top100-rank ${rankClass}">${rank}</div>
        <img class="top100-poster" src="${posterSrc(item.poster)}" data-original="${escapeAttr(item.poster)}" onerror="handlePosterError(this)" alt="Постер" decoding="async">
        <div class="top100-info">
            <div class="top100-title">${item.title}</div>
            <div class="top100-meta">
                <span>${item.year} • ${typeName}</span>
                <span class="rating">★ ${item.rating || '-'}</span>
                ${trailerLink}
            </div>
        </div>
    </div>
    `;
}

function openModal(id) {
    const item = allData.find(i => String(i.id) === String(id));
    if (!item) return;

    const typeName = getTypeName(item.type);
    
    // Формируем жанры с новым уникальным классом
    let genresHtml = '';
    if (item.genres) {
        genresHtml = item.genres.split(',').map(g => `<span class="tag tag-genre">${g.trim()}</span>`).join('');
    }
    
    const imgStyle = 'max-width: 100%; height: auto; border-radius: 8px; margin: 15px 0; display: block; box-shadow: 0 5px 15px rgba(0,0,0,0.5);';
    let formattedDesc = (item.description || '').replace(/\[img\](.*?)\[\/img\]/gi, `<img src="$1" style="${imgStyle}" alt="Иллюстрация">`);
    let formattedReview = (item.review || '').replace(/\[img\](.*?)\[\/img\]/gi, `<img src="$1" style="${imgStyle}" alt="Иллюстрация">`);

    document.getElementById('modalBody').innerHTML = `
        <div class="details-poster">
            <img src="${posterSrc(item.poster)}" data-original="${escapeAttr(item.poster)}" onerror="handlePosterError(this)" alt="Постер" decoding="async">
        </div>
        <div class="details-info">
            <div class="details-title">${item.title}</div>
            
            <!-- НОВАЯ РАЗМЕТКА ТЕГОВ -->
            <div class="details-tags">
                <span class="tag tag-type">${typeName}</span>
                <span class="tag tag-year">${item.year}</span>
                ${item.rating ? `<span class="tag tag-rating">★ ${item.rating}</span>` : ''}
                ${genresHtml}
            </div>
            
            ${item.trailer ? `<button type="button" class="trailer-btn-inline" onclick="openTrailer('${escapeAttr(item.trailer)}', event)">▶ Смотреть трейлер</button>` : ''}
            ${item.description ? `
            <div class="details-section">
                <h4>Описание</h4>
                <p style="white-space: pre-wrap; line-height: 1.6;">${formattedDesc}</p>
            </div>` : ''}
            ${item.review ? `
            <div class="details-section">
                <h4>Мой отзыв</h4>
                <p style="white-space: pre-wrap; line-height: 1.6;">${formattedReview}</p>
            </div>` : ''}
        </div>
    `;
    
    const overlay = document.getElementById('modalOverlay');
    overlay.style.display = 'flex';
    setTimeout(() => overlay.classList.add('active'), 10);
    document.body.style.overflow = 'hidden'; 
}

function closeModal(event) {
    if (event && event.target.id !== 'modalOverlay' && event.target.className !== 'modal-close') return;
    const overlay = document.getElementById('modalOverlay');
    overlay.classList.remove('active');
    setTimeout(() => {
        overlay.style.display = 'none';
        document.body.style.overflow = ''; 
    }, 300);
}

function extractYouTubeId(url) {
    if (!url) return null;
    const trimmed = url.trim();
    const m = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/);
    if (m) return m[1];
    if (/^[\w-]{6,}$/.test(trimmed)) return trimmed;
    return null;
}

function openTrailer(url, event) {
    if (event) event.stopPropagation();
    const id = extractYouTubeId(url);
    if (!id) return;

    document.getElementById('trailerFrame').innerHTML =
        `<iframe src="https://www.youtube.com/embed/${id}?autoplay=1&rel=0" title="Трейлер" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;

    const overlay = document.getElementById('trailerOverlay');
    overlay.style.display = 'flex';
    setTimeout(() => overlay.classList.add('active'), 10);
    document.body.style.overflow = 'hidden';
}

function closeTrailer(event) {
    if (event && event.target.id !== 'trailerOverlay' && event.target.className !== 'modal-close') return;
    const overlay = document.getElementById('trailerOverlay');
    overlay.classList.remove('active');
    setTimeout(() => {
        overlay.style.display = 'none';
        document.getElementById('trailerFrame').innerHTML = ''; 
        document.body.style.overflow = '';
    }, 250);
}

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const trailerOverlay = document.getElementById('trailerOverlay');
    const modalOverlay = document.getElementById('modalOverlay');
    
    if (trailerOverlay && trailerOverlay.classList.contains('active')) {
        closeTrailer();
    } else if (modalOverlay && modalOverlay.classList.contains('active')) {
        closeModal();
    } else if (isSidebarOpen()) {
        closeSidebar();
    } else if (currentFilter !== 'main') {
        goToFilter('main');
    }
});

document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 350) e.preventDefault();
    lastTouchEnd = now;
}, { passive: false });

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (currentFilter === 'main') markScrollableRows();
    }, 150);
});