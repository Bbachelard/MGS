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
function construireCarteVide(platform, options = {}) {
    const card = document.createElement('div');
    card.className = 'player-card player-card--empty';
    card.dataset.platform = platform.slug;

    const icon = safeUrl(platform.icon) || platform.icon || '';

    let action = `<p class="stats-info">Bientôt disponible.</p>`;

    if (options.lectureSeule === true) {
        action = '';
    } else if (platform.enabled && platform.linkable) {
        action = `<a class="link-btn" href="/php/link.php?platform=${encodeURIComponent(platform.slug)}">Lier mon compte ${escapeHtml(platform.label)}</a>`;
    } else if (platform.enabled && platform.verifiable) {
        action = `<button class="link-btn js-verify" type="button"
                          data-platform="${escapeHtml(platform.slug)}">Lier mon compte ${escapeHtml(platform.label)}</button>`;
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


/* ================= Vue globale multi-plateformes ================= */

const METRIQUES = [
    { cle: 'accounts',    label: 'Comptes liés',        suffixe: ''  },
    { cle: 'games',       label: 'Jeux au total',       suffixe: ''  },
    { cle: 'totalHours',  label: 'Heures de jeu',       suffixe: 'h' },
    { cle: 'recentHours', label: 'Heures (2 semaines)', suffixe: 'h' },
];

function formaterNombre(valeur, suffixe) {
    const arrondi = Number.isInteger(valeur) ? valeur : Number(valeur.toFixed(1));
    return arrondi.toLocaleString('fr-FR') + suffixe;
}

/** Somme les metrics de toutes les plateformes chargées. */
function construireResume(resultats) {
    const totaux = {};

    resultats.forEach(r => {
        const metrics = r.data?.metrics;
        if (!metrics) return;

        for (const [cle, valeur] of Object.entries(metrics)) {
            if (typeof valeur === 'number' && !Number.isNaN(valeur)) {
                totaux[cle] = (totaux[cle] || 0) + valeur;
            }
        }
    });

    const bloc = document.createElement('div');
    bloc.className = 'hub-summary';

    bloc.innerHTML = METRIQUES
        .filter(m => totaux[m.cle] !== undefined)
        .map(m => `
            <div class="summary-box">
                <span class="summary-value">${escapeHtml(formaterNombre(totaux[m.cle], m.suffixe))}</span>
                <span class="summary-label">${escapeHtml(m.label)}</span>
            </div>
        `).join('');

    return bloc.children.length ? bloc : null;
}

/** Bandeau des comptes : une pastille par plateforme. */
function construireBandeauComptes(resultats, onDelier, options = {}) {
    const lectureSeule = options.lectureSeule === true;

    const bloc = document.createElement('div');
    bloc.className = 'hub-accounts';

    resultats.forEach(r => {
        const chip = document.createElement('div');
        chip.className = 'account-chip';
        chip.dataset.platform = r.platform.slug;

        const icone = `<img class="chip-icon" src="${escapeHtml(r.platform.icon)}" alt="">`;

        // --- Cas 1 : plateforme non liée ---
        if (!r.platform.linked) {
            chip.classList.add('account-chip--empty');

            let action = `<span class="chip-soon">Bientôt</span>`;

            if (lectureSeule) {
                action = '';
            } else if (r.platform.enabled && r.platform.linkable) {
                action = `<a class="link-btn link-btn--sm"
                             href="/php/link.php?platform=${encodeURIComponent(r.platform.slug)}">Lier</a>`;
            } else if (r.platform.enabled && r.platform.verifiable) {
                action = `<button class="link-btn link-btn--sm js-verify" type="button"
                                  data-platform="${escapeHtml(r.platform.slug)}">Lier</button>`;
            }

            chip.innerHTML = `
                ${icone}
                <div class="chip-body">
                    <span class="chip-name">${escapeHtml(r.platform.label)}</span>
                    <span class="chip-sub">${lectureSeule ? 'Non lié' : 'Aucun compte lié'}</span>
                    ${action}
                </div>
            `;
            bloc.appendChild(chip);
            return;
        }

        // --- Cas 2 : lié mais les stats ont échoué ---
        if (r.error || !r.data) {
            chip.classList.add('account-chip--error');
            chip.innerHTML = `
                ${icone}
                <div class="chip-body">
                    <span class="chip-name">${escapeHtml(r.platform.label)}</span>
                    <span class="chip-sub chip-sub--error">${escapeHtml(r.error || 'Stats indisponibles.')}</span>
                </div>
            `;

        // --- Cas 3 : lié, stats OK ---
        } else {
            const d = r.data;
            const avatar = safeUrl(d.avatar);
            const status = d.status || {};

            chip.innerHTML = `
                ${avatar
                    ? `<img class="chip-avatar ${status.online ? 'online' : ''}" src="${avatar}"
                            alt="" onclick="openImageModal(this.src)">`
                    : icone}
                <div class="chip-body">
                    <span class="chip-name">${escapeHtml(d.displayName || r.platform.label)}</span>
                    <span class="chip-sub">${escapeHtml(status.label || r.platform.label)}</span>
                    ${d.activity ? `<span class="chip-game">🎮 ${escapeHtml(d.activity)}</span>` : ''}
                </div>
            `;
        }

        if (!lectureSeule) {
            const btn = document.createElement('button');
            btn.className = 'chip-unlink';
            btn.title = `Délier ${r.platform.label}`;
            btn.textContent = '✕';
            btn.addEventListener('click', () => onDelier(r.platform, btn));
            chip.appendChild(btn);
        }

        bloc.appendChild(chip);
    });

    return bloc;
}

/** Toutes les stats détaillées, groupées par plateforme. */
function construireDetails(resultats) {
    const bloc = document.createElement('div');
    bloc.className = 'hub-details';

    resultats.forEach(r => {
        if (!r.data) return;
        const d = r.data;

        const highlights = (d.highlights || []).map(item => `
            <div class="info-box">
                <span class="info-label">${escapeHtml(item.label)}</span>
                <span class="info-value">${escapeHtml(item.value ?? '-')}</span>
            </div>
        `).join('');

        const sections = (d.sections || []).map(section => {
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

        const links = (d.links || []).map(l => {
            const url = safeUrl(l.url);
            return url ? `<a href="${url}" target="_blank" rel="noopener" class="profile-link">${escapeHtml(l.label)}</a>` : '';
        }).join('');

        const groupe = document.createElement('section');
        groupe.className = 'detail-group';
        groupe.dataset.platform = d.platform;
        groupe.innerHTML = `
            <div class="detail-head">
                <span class="platform-tag">${escapeHtml(d.platformLabel)}</span>
                ${links}
            </div>
            ${highlights ? `<div class="info-grid">${highlights}</div>` : ''}
            ${sections}
        `;

        bloc.appendChild(groupe);
    });

    return bloc.children.length ? bloc : null;
}