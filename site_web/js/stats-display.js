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

/* ================= Identité visuelle des plateformes ================= */

/** Miroir de mgs_platforms() côté client : évite un aller-retour serveur
 *  juste pour un logo, et reste vide si la plateforme est inconnue. */
const PLATFORM_ICONS = {
    steam: '/content/image/Steam_icon.webp',
    riot:  '/content/image/riot-icon.png',
    epic:  '/content/image/Epic_icon.webp'
};

/** Badge de plateforme : logo + libellé. Le logo disparaît s'il ne charge pas. */
function platformTag(slug, label) {
    const cle = String(slug ?? '').toLowerCase();
    const src = PLATFORM_ICONS[cle] || '';

    return `<span class="platform-tag" data-platform="${escapeHtml(cle)}">
        ${src ? `<img class="platform-tag-logo" src="${escapeHtml(src)}" alt=""
                      onerror="this.remove()">` : ''}
        <span>${escapeHtml(label || slug || '')}</span>
    </span>`;
}
/* ================= Rendu générique d'une carte ================= */

function construireCarte(data) {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.dataset.platform = data.platform || '';

    const avatar = safeUrl(data.avatar);
    const status = data.status || {};

    const highlights = typeof mgsHighlights === 'function'
        ? mgsHighlights(data.highlights)
        : (data.highlights || []).map(item => `
            <div class="info-box">
                <span class="info-label">${escapeHtml(item.label)}</span>
                <span class="info-value">${escapeHtml(item.value ?? '-')}</span>
            </div>
        `).join('');

    const sections = typeof mgsSections === 'function'
        ? mgsSections(data.sections)
        : (data.sections || []).map(section => {
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
        <div class="platform-tag">${platformTag(data.platform, data.platformLabel || data.platform)}</div>

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
        <div class="platform-tag">${platformTag(platform.slug, platform.label)}</div>
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


/* ============================================================
   PATCH stats-display.js

   Remplace INTÉGRALEMENT l'ancienne fonction construireBandeauComptes()
   (celle qui commence par le commentaire
    "Bandeau des comptes : une pastille par plateforme.")
   par tout ce qui suit. Le reste du fichier ne bouge pas.
   ============================================================ */

/**
 * Bandeau des comptes : une pastille par COMPTE lié.
 *
 * @param comptes      entrées { platform, account, data, error }
 * @param plateformes  liste brute de session-status.php (pour "ajouter")
 * @param actions      { onDelier, onPrincipal }
 */
function construireBandeauComptes(comptes, plateformes, actions = {}, options = {}) {
    const lectureSeule = options.lectureSeule === true;

    const bloc = document.createElement('div');
    bloc.className = 'hub-accounts';

    comptes.forEach(r => {
        bloc.appendChild(
            r.account
                ? chipCompte(r, actions, lectureSeule)
                : chipPlateformeVide(r.platform, lectureSeule)
        );
    });

    // Pastille "+" pour les plateformes qui acceptent encore un compte
    // et en ont déjà au moins un (sinon la pastille "Lier" suffit).
    if (!lectureSeule) {
        (plateformes || []).forEach(p => {
            if (p.canAdd && (p.accounts || []).length > 0) {
                bloc.appendChild(chipAjouter(p));
            }
        });
    }

    return bloc;
}

/** Plateforme sans aucun compte lié. */
function chipPlateformeVide(platform, lectureSeule) {
    const chip = document.createElement('div');
    chip.className = 'account-chip account-chip--empty';
    chip.dataset.platform = platform.slug;

    const icone = `<img class="chip-icon" src="${escapeHtml(platform.icon)}" alt="">`;

    let action = `<span class="chip-soon">Bientôt</span>`;

    if (lectureSeule) {
        action = '';
    } else if (platform.enabled && platform.linkable) {
        action = `<a class="link-btn link-btn--sm"
                     href="/php/link.php?platform=${encodeURIComponent(platform.slug)}">Lier</a>`;
    } else if (platform.enabled && platform.verifiable) {
        action = `<button class="link-btn link-btn--sm js-verify" type="button"
                          data-platform="${escapeHtml(platform.slug)}">Lier</button>`;
    }

    chip.innerHTML = `
        ${icone}
        <div class="chip-body">
            <span class="chip-name">${escapeHtml(platform.label)}</span>
            <span class="chip-sub">${lectureSeule ? 'Non lié' : 'Aucun compte lié'}</span>
            ${action}
        </div>
    `;

    return chip;
}

/** Pastille d'un compte lié. */
function chipCompte(r, actions, lectureSeule) {
    const chip = document.createElement('div');
    chip.className = 'account-chip';
    chip.dataset.platform = r.platform.slug;
    chip.dataset.linkId   = r.account.id;

    if (r.account.isPrimary) {
        chip.classList.add('account-chip--primary');
    }

    const icone = `<img class="chip-icon" src="${escapeHtml(r.platform.icon)}" alt="">`;

    // --- Lié mais les stats ont échoué ---
    if (r.error || !r.data) {
        chip.classList.add('account-chip--error');
        chip.innerHTML = `
            ${icone}
            <div class="chip-body">
                <span class="chip-name">${escapeHtml(r.account.displayName || r.platform.label)}</span>
                <span class="chip-sub chip-sub--error">${escapeHtml(r.error || 'Stats indisponibles.')}</span>
            </div>
        `;

    // --- Lié, stats OK ---
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
        // Étoile : compte principal (avatar de la navbar).
        // Affichée seulement s'il y a un choix à faire.
        const nbComptes = (r.platform.accounts || []).length;

        if (nbComptes > 1 && typeof actions.onPrincipal === 'function') {
            const etoile = document.createElement('button');
            etoile.className = 'chip-primary' + (r.account.isPrimary ? ' is-active' : '');
            etoile.type = 'button';
            etoile.textContent = r.account.isPrimary ? '★' : '☆';
            etoile.title = r.account.isPrimary
                ? 'Compte principal'
                : 'Définir comme compte principal';
            etoile.disabled = r.account.isPrimary;
            etoile.addEventListener('click', () => actions.onPrincipal(r, etoile));
            chip.appendChild(etoile);
        }

        if (typeof actions.onDelier === 'function') {
            const btn = document.createElement('button');
            btn.className = 'chip-unlink';
            btn.type = 'button';
            btn.title = `Délier ${r.account.displayName || r.platform.label}`;
            btn.textContent = '✕';
            btn.addEventListener('click', () => actions.onDelier(r, btn));
            chip.appendChild(btn);
        }
    }

    return chip;
}

/** Pastille "+ Ajouter un compte" pour une plateforme déjà liée. */
function chipAjouter(platform) {
    const chip = document.createElement('div');
    chip.className = 'account-chip account-chip--add';
    chip.dataset.platform = platform.slug;

    const restants = platform.maxAccounts - (platform.accounts || []).length;

    const action = platform.linkable
        ? `<a class="link-btn link-btn--sm"
              href="/php/link.php?platform=${encodeURIComponent(platform.slug)}">+ Ajouter</a>`
        : `<button class="link-btn link-btn--sm js-verify" type="button"
                   data-platform="${escapeHtml(platform.slug)}">+ Ajouter</button>`;

    chip.innerHTML = `
        <img class="chip-icon" src="${escapeHtml(platform.icon)}" alt="">
        <div class="chip-body">
            <span class="chip-name">Autre compte ${escapeHtml(platform.label)}</span>
            <span class="chip-sub">${restants} emplacement${restants > 1 ? 's' : ''} restant${restants > 1 ? 's' : ''}</span>
            ${action}
        </div>
    `;

    return chip;
}

/** Toutes les stats détaillées, groupées par plateforme. */
function construireDetails(resultats) {
    const bloc = document.createElement('div');
    bloc.className = 'hub-details';

    resultats.forEach(r => {
        if (!r.data) return;
        const d = r.data;

        const highlights = typeof mgsHighlights === 'function'
            ? mgsHighlights(d.highlights)
            : (d.highlights || []).map(item => `
                <div class="info-box">
                    <span class="info-label">${escapeHtml(item.label)}</span>
                    <span class="info-value">${escapeHtml(item.value ?? '-')}</span>
                </div>
            `).join('');

        const sections = typeof mgsSections === 'function'
            ? mgsSections(d.sections)
            : (d.sections || []).map(section => {
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
                <span class="platform-tag">${platformTag(d.platform, d.platformLabel)}</span>
                ${links}
            </div>
            ${highlights ? `<div class="info-grid">${highlights}</div>` : ''}
            ${sections}
        `;

        bloc.appendChild(groupe);
    });

    return bloc.children.length ? bloc : null;
}