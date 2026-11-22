const films = [
  { id: 'horizon', title: 'Красный горизонт', year: 2025, type: 'Фильмы', label: 'Фильм', length: '1 ч 54 мин', genres: ['Фантастика', 'Триллер'], artwork: 'horizon.webp', description: 'На Марсе пропадает исследовательская станция. Команда спасателей находит сигнал, которого там быть не должно.' },
  { id: 'north', title: 'Северный свет', year: 2024, type: 'Сериалы', label: 'Сериал', length: '1 сезон', genres: ['Драма', 'Детектив'], artwork: 'north.webp', description: 'В заснеженном городке исчезает метеоролог. Поиски начинают двое местных жителей, которым давно пора поговорить друг с другом.' },
  { id: 'kingdom', title: 'Замок над облаками', year: 2023, type: 'Мультфильмы', label: 'Мультфильм', length: '1 ч 28 мин', genres: ['Приключения', 'Фэнтези'], artwork: 'kingdom.webp', description: 'Юная картографка находит карту летающего острова и отправляется искать его вместе с младшим братом.' },
  { id: 'night', title: 'Полночный квартал', year: 2022, type: 'Фильмы', label: 'Фильм', length: '1 ч 43 мин', genres: ['Триллер', 'Детектив'], artwork: 'night.webp', description: 'Ночной репортёр становится свидетелем странной встречи. За одну ночь ему предстоит понять, кому можно доверять.' }
];

const paths = {
  home: '<path d="M3 10l9-7 9 7v10h-6v-6H9v6H3z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  bookmark: '<path d="M6 4h12v16l-6-4-6 4z"/>',
  profile: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2z"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  share: '<path d="M12 15V3m-4 4 4-4 4 4M7 9H4v12h16V9h-3"/>',
  play: '<path fill="currentColor" d="m8 4 12 8-12 8z"/>',
  star: '<path d="m12 3 3 6 7 .9-5 4.7 1.2 6.4-6.2-3.1L5.8 21 7 14.6 2 9.9 9 9z"/>'
};
const icon = (name, active = false) => `<svg class="icon icon-${name}${active ? ' saved' : ''}" viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
const tabs = [['home', 'home', 'Главная'], ['find', 'search', 'Найти'], ['watch', 'bookmark', 'Хочу посмотреть'], ['profile', 'profile', 'Профиль']];
const labels = Object.fromEntries(tabs.map(([id, , label]) => [id, label]));
const types = ['Все', 'Фильмы', 'Сериалы', 'Мультфильмы'];
const genres = [...new Set(films.flatMap(film => film.genres))].sort((a, b) => a.localeCompare(b, 'ru'));
const initial = () => ({ saved: ['north', 'horizon'], ratings: { night: 8 }, reviews: {} });
const storageKey = 'mycollection-preview-v1';
let data = initial();
try { data = JSON.parse(localStorage.getItem(storageKey)) || data; } catch {}
const filters = { watch: 'Все', home: 'Все', genre: '', sort: 'recent' };
let query = '';
let noticeTimer;
const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const notice = document.querySelector('#notice');
const photo = (film, className = 'poster') => `<img class="${className}" src="assets/${film.artwork}" alt="">`;
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));

function route() {
  const [page, id] = location.hash.slice(1).split('/');
  return { page: Object.hasOwn(labels, page) ? page : 'watch', film: films.find(film => film.id === id) };
}

function go(page, film) {
  const hash = '#' + page + (film ? '/' + film.id : '');
  if (location.hash === hash) return;
  history.pushState({ detail: Boolean(film) }, '', hash);
  window.scrollTo(0, 0);
  render();
}

function store() {
  try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch {}
}

function toast(message, link = false) {
  notice.innerHTML = `<span>${message}</span>${link ? '<button data-go="watch">Открыть</button>' : ''}`;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 3600);
}

function nav(page) {
  return `<nav class="tabs" aria-label="Основные разделы">${tabs.map(([key, symbol, label]) =>
    `<a href="#${key}" data-go="${key}"${page === key ? ' class="active" aria-current="page"' : ''}>${icon(symbol)}${label}</a>`).join('')}</nav>`;
}

function chips(page) {
  return `<div class="chips" role="group" aria-label="Тип контента">${types.map(type =>
    `<button type="button" data-type="${type}" class="${filters[page] === type ? 'chosen' : ''}" aria-pressed="${filters[page] === type}">${type}</button>`).join('')}</div>`;
}

function bookmark(film) {
  const saved = data.saved.includes(film.id);
  return `<button class="icon-button ${saved ? 'red' : ''}" data-save="${film.id}" aria-label="${saved ? 'Убрать из списка' : 'Сохранить в список'}" aria-pressed="${saved}">${icon('bookmark', saved)}</button>`;
}

function entry(film, page) {
  const link = `href="#${page}/${film.id}" data-film="${film.id}"`;
  return `<article class="entry">
    <a ${link} aria-label="${film.title}">${photo(film)}</a>
    <div><h2><a ${link}>${film.title}</a></h2><p class="meta">${film.year} · ${film.label}</p>
    <button class="pill" data-rate="${film.id}">${data.ratings[film.id] ? 'Оценка ' + data.ratings[film.id] + '/10' : 'Поставить оценку'}</button></div>
    ${bookmark(film)}
  </article>`;
}

function card(film, page) {
  return `<article class="card"><a href="#${page}/${film.id}" data-film="${film.id}">${photo(film)}<strong>${film.title}</strong><p class="meta">${film.year} · ${film.label}</p></a>${bookmark(film)}</article>`;
}

function watch() {
  const saved = data.saved.map(id => films.find(film => film.id === id)).filter(Boolean);
  const visible = saved.filter(film => (filters.watch === 'Все' || film.type === filters.watch) &&
    (!filters.genre || film.genres.includes(filters.genre))).reverse();
  if (filters.sort === 'year') visible.sort((a, b) => b.year - a.year);
  if (filters.sort === 'title') visible.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  return `<h1>Хочу посмотреть</h1><p class="muted sub">Сохранено: ${saved.length}</p>
    <div class="filters">${chips('watch')}
      <div class="controls"><select id="genre" aria-label="Жанр">
      <option value="">Все жанры</option>${genres.map(genre => `<option${filters.genre === genre ? ' selected' : ''}>${genre}</option>`).join('')}</select>
      <select id="sort" aria-label="Сортировка">
      ${[['recent','Недавно добавлены'],['year','По году выпуска'],['title','По названию']].map(([key,label]) => `<option value="${key}"${key === filters.sort ? ' selected' : ''}>${label}</option>`).join('')}
      </select></div>
    </div>
    <div class="entries">${visible.map(film => entry(film, 'watch')).join('') || (saved.length
      ? '<p class="empty">По выбранным фильтрам ничего не найдено.</p><button class="pill" data-reset>Сбросить фильтры</button>'
      : '<p class="empty">Здесь появятся фильмы и сериалы, которые вы сохраните.</p><a class="wide" href="#find" data-go="find">Найти фильм</a>')}</div>`;
}

function resultCards() {
  const match = query.trim().toLocaleLowerCase('ru');
  return films.filter(film => film.title.toLocaleLowerCase('ru').includes(match)).map(film => card(film, 'find')).join('') ||
    '<p class="empty">Ничего не найдено.</p>';
}

function find() {
  return `<h1>Найдите фильм или сериал</h1><p class="muted sub">Оцените просмотренное или сохраните на потом</p>
    <input class="search" id="search" type="search" value="${escape(query)}" placeholder="Поиск по названию" aria-label="Поиск по названию">
    <section class="section"><h2 id="results-title">${query.trim() ? 'Результаты поиска' : 'Сейчас в тренде'}</h2><div class="cards" id="results">${resultCards()}</div></section>`;
}

function home() {
  const rated = films.filter(film => data.ratings[film.id] && (filters.home === 'Все' || filters.home === film.type));
  return `<h1>Моя коллекция</h1><div class="filters">${chips('home')}</div>
    <section class="section"><h2>Недавние оценки</h2><div class="entries">${rated.map(film => entry(film, 'home')).join('') || '<p class="empty">Здесь появятся ваши оценки.</p>'}</div></section>
    <section class="section"><h2>Рекомендации</h2><div class="cards">${films.slice(1,3).map(film => card(film, 'home')).join('')}</div></section>`;
}

function profile() {
  return '<h1>Профиль</h1><p class="muted sub">Тестовая коллекция</p><div class="stack"><button class="wide" data-demo-reset>Сбросить тестовые данные</button></div>';
}

function detail(film, page) {
  const saved = data.saved.includes(film.id);
  const rating = data.ratings[film.id];
  const review = data.reviews[film.id];
  return `<div class="hero" style="background-image:url('assets/${film.artwork}')">
    <header class="toolbar"><button data-back>${icon('back')}${labels[page]}</button><button data-share aria-label="Поделиться">${icon('share')}</button></header>
    </div><main class="details"><h1>${film.title}</h1><p class="muted sub">${film.year} · ${film.length}</p>
    <div class="genres">${film.genres.map(genre => `<span>${genre}</span>`).join('')}</div>
    <div class="actions">${film.id === 'horizon' ? '<button class="primary" data-trailer>' + icon('play') + 'Трейлер</button>' : '<span class="wide muted">Трейлер недоступен</span>'}
    <button class="wide" data-save="${film.id}" aria-pressed="${saved}"><span class="${saved ? 'red' : ''}">${icon('bookmark', saved)}</span>${saved ? 'В списке' : 'Сохранить'}</button></div>
    <div class="rating level"><strong>Ваша оценка</strong><button class="pill" data-rate="${film.id}">${icon('star')} ${rating ? rating + ' из 10' : 'Оценить'}</button></div>
    <section class="section"><h2>О ${film.label === 'Сериал' ? 'сериале' : 'фильме'}</h2><p>${film.description}</p></section>
    ${review ? `<section class="section"><h2>Ваш отзыв</h2><p>${escape(review)}</p></section>` : ''}
    <button class="wide review" data-review="${film.id}">${review ? 'Изменить отзыв' : 'Написать отзыв'}</button></main>`;
}

function render() {
  const { page, film } = route();
  const active = document.activeElement;
  const selectId = ['genre', 'sort'].includes(active?.id) ? active.id : '';
  const type = active?.dataset?.type;
  app.innerHTML = film ? detail(film, page) : `<main class="pad"><div class="brand">MY<span>COLLECTION</span></div>${{ watch, find, home, profile }[page]()}</main>${nav(page)}`;
  if (selectId) document.getElementById(selectId)?.focus();
  if (type) [...app.querySelectorAll('[data-type]')].find(node => node.dataset.type === type)?.focus();
}

let listScroll = 0;
function openFilm(id) {
  const film = films.find(film => film.id === id);
  listScroll = window.scrollY;
  go(route().page, film);
  app.querySelector('h1')?.setAttribute('tabindex', '-1');
  app.querySelector('h1')?.focus({ preventScroll: true });
}

function back() {
  if (history.state?.detail) history.back();
  else go(route().page);
}

function openDialog(title, body) {
  dialog.innerHTML = `<form method="dialog"><div class="level dialog-title"><h2>${title}</h2><button class="icon-button" aria-label="Закрыть">✕</button></div></form>${body}`;
  dialog.showModal();
}

window.addEventListener('popstate', () => {
  const { film } = route();
  render();
  if (!film) window.scrollTo(0, listScroll);
});
dialog.addEventListener('close', () => { dialog.innerHTML = ''; });
document.addEventListener('input', event => {
  if (event.target.id !== 'search') return;
  query = event.target.value;
  document.querySelector('#results-title').textContent = query.trim() ? 'Результаты поиска' : 'Сейчас в тренде';
  document.querySelector('#results').innerHTML = resultCards();
});
document.addEventListener('change', event => {
  if (!['sort','genre'].includes(event.target.id)) return;
  filters[event.target.id] = event.target.value;
  render();
});
document.addEventListener('submit', event => {
  const id = event.target.dataset.reviewForm;
  if (!id) return;
  event.preventDefault();
  data.reviews[id] = new FormData(event.target).get('review').trim();
  store();
  dialog.close();
  render();
  toast('Отзыв сохранён');
});
document.addEventListener('click', async event => {
  const node = event.target.closest('[data-go],[data-type],[data-film],[data-save],[data-back],[data-share],[data-rate],[data-rating],[data-review],[data-trailer],[data-reset],[data-demo-reset]');
  if (!node || (node.tagName === 'A' && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey))) return;
  event.preventDefault();
  const { page } = route();
  const action = node.dataset;
  if (action.go) { notice.hidden = true; go(action.go); return; }
  if (action.film) { openFilm(action.film); return; }
  if ('back' in action) { back(); return; }
  if (action.type) { filters[page] = action.type; render(); return; }
  if ('reset' in action) { filters.watch = 'Все'; filters.genre = ''; filters.sort = 'recent'; render(); return; }
  if (action.save) {
    const saved = data.saved.includes(action.save);
    data.saved = saved ? data.saved.filter(id => id !== action.save) : [...data.saved, action.save];
    store(); render(); toast(saved ? 'Убрано из списка' : 'Добавлено в список', !saved); return;
  }
  if (action.rate) {
    const options = Array.from({ length: 10 }, (_, i) => `<button class="pill" data-rating="${action.rate}:${i + 1}" aria-pressed="${data.ratings[action.rate] === i + 1}">${i + 1}</button>`).join('');
    openDialog('Ваша оценка', `<div class="ratings">${options}</div>`); return;
  }
  if (action.rating) {
    const [id, value] = action.rating.split(':');
    data.ratings[id] = Number(value);
    const wasSaved = data.saved.includes(id);
    data.saved = data.saved.filter(savedId => savedId !== id);
    store(); dialog.close(); render();
    toast(wasSaved ? 'Оценка сохранена, фильм убран из списка' : 'Оценка сохранена'); return;
  }
  if (action.review) {
    openDialog('Ваш отзыв', `<form data-review-form="${action.review}"><textarea name="review" aria-label="Ваш отзыв" maxlength="1500">${escape(data.reviews[action.review] || '')}</textarea><div class="dialog-actions"><button class="primary">Сохранить</button></div></form>`); return;
  }
  if ('trailer' in action) {
    openDialog('Демо-трейлер', '<video class="trailer" controls autoplay muted playsinline src="assets/trailer.mp4"></video>'); return;
  }
  if ('share' in action) {
    try { await navigator.clipboard.writeText(location.href); toast('Ссылка скопирована'); }
    catch { openDialog('Ссылка на фильм', `<textarea aria-label="Ссылка" readonly>${escape(location.href)}</textarea>`); }
    return;
  }
  if ('demoReset' in action) { data = initial(); store(); render(); toast('Тестовые данные сброшены'); }
});
render();
