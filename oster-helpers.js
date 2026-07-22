// =====================================================================
// ГЛОБАЛЬНЫЕ УТИЛИТЫ ДЛЯ РАБОТЫ С КАРТИНКАМИ И ТЕКСТОМ
// =====================================================================

function posterSrc(url) {
    return url || '';
}

function escapeAttr(str) {
    return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function handlePosterError(imgEl) {
    const original = imgEl.dataset.original || '';
    if (!original) { 
        imgEl.removeAttribute('onerror'); 
        return; 
    }
    
    if (imgEl.dataset.posterStage === 'proxy') {
        imgEl.removeAttribute('onerror');
        imgEl.removeAttribute('src');
        return;
    }
    
    imgEl.dataset.posterStage = 'proxy';
    
    if (original.includes('image.tmdb.org')) {
        imgEl.src = 'https://wsrv.nl/?url=' + encodeURIComponent(original.replace(/^https?:\/\//, ''));
    } else {
        imgEl.removeAttribute('onerror');
    }
}
