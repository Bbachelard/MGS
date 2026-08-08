/* ================= Utilitaires ================= */

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** N'autorise que http(s) : bloque javascript:... dans un href/src. */
function safeUrl(url) {
    const value = String(url ?? '').trim();
    return /^https?:\/\//i.test(value) ? value : '';
}

/* ================= Rendu générique d'une carte ================= */

function construireCarte(data) {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.dataset.platform = data.platform || '';

    const avatar = safeUrl(data.avatar);
    const status = data.status || {};

    const highlights = (data.highlights || []).map(item => `
        <div class="info-box">
            <span class="info-label">${escapeHtml(item.label)}</span>
            <span class="info-value">${escapeHtml(item.value ?? '-')}</span>
        </div>
    `).join('');

    const sections = (data.sections || []).map(section => {
        const items = (section.items || []).map(item => `
            <li>${escapeHtml(item.name)} <span>${escapeHtml(item.value ?? '')}</span></li>
        `).join('');

        return `
            <div class="recent-games-box">
                <span class="info-label">${escapeHtml(section.title)}</span>
                <ul class="recent-games-list">
                    ${items || `<li>${escapeHtml(section.empty || 'Aucune donnée')}</li>`}
                </ul>
            </div>
        `;
    }).join('');

    const links = (data.links || []).map(link => {
        const url = safeUrl(link.url);
        return url
            ? `<a href="${url}" target="_blank" rel="noopener" class="profile-link">${escapeHtml(link.label)}</a>`
            : '';
    }).join('');

    card.innerHTML = `
        <div class="platform-tag">${escapeHtml(data.platformLabel || data.platform)}</div>

        <div class="player-header">
            <div class="avatar-frame">
                ${avatar
                    ? `<img src="${avatar}" alt="avatar" onclick="openImageModal(this.src)" style="cursor:pointer;">`
                    : `<div class="avatar-placeholder"></div>`}
            </div>
            <div class="player-identity">
                <h3>${escapeHtml(data.displayName)}</h3>
                ${data.subtitle ? `<p class="realname">${escapeHtml(data.subtitle)}</p>` : ''}
                ${status.label ? `<span class="status-badge ${status.online ? 'online' : ''}">${escapeHtml(status.label)}</span>` : ''}
                ${data.activity ? `<p class="in-game">🎮 ${escapeHtml(data.activity)}</p>` : ''}
            </div>
        </div>

        ${highlights ? `<div class="info-grid">${highlights}</div>` : ''}
        ${sections}
        ${links}
    `;

    return card;
}

/** Carte affichée pour une plateforme non liée / indisponible. */
function construireCarteVide(platform) {
    const card = document.createElement('div');
    card.className = 'player-card player-card--empty';
    card.dataset.platform = platform.slug;

    const icon = safeUrl(platform.icon) || platform.icon || '';

    let action = `<p class="stats-info">Bientôt disponible.</p>`;
    if (platform.enabled && platform.linkable) {
        action = `<a class="link-btn" href="/php/link.php?platform=${encodeURIComponent(platform.slug)}">Lier mon compte ${escapeHtml(platform.label)}</a>`;
    }

    card.innerHTML = `
        <div class="platform-tag">${escapeHtml(platform.label)}</div>
        <div class="empty-body">
            ${icon ? `<img src="${escapeHtml(icon)}" alt="" width="48">` : ''}
            <p class="stats-info">Aucun compte ${escapeHtml(platform.label)} lié.</p>
            ${action}
        </div>
    `;

    return card;
}

/* ================= Compatibilité page d'accueil ================= */

function afficherResultat(data, resultBox) {
    resultBox.innerHTML = '';
    resultBox.appendChild(construireCarte(data));
    resultBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ================= Modale image ================= */

function openImageModal(src) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('imageModalContent');
    if (!modal || !modalImg) return;
    modal.style.display = 'flex';
    modalImg.src = src;
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    if (modal) modal.style.display = 'none';
}

document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('imageModal');
    if (!modal) return;

    const closeBtn = document.querySelector('.image-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeImageModal);

    modal.addEventListener('click', e => {
        if (e.target === modal) closeImageModal();
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeImageModal();
    });
});