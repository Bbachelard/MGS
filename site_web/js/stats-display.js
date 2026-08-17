/* ============================================================
   AFFICHAGE DES CARTES DE STATS

   escapeHtml(), safeUrl() et le registre des plateformes vivent
   désormais dans js/core/mgs-core.js, à charger AVANT ce fichier.
   ============================================================ */

/** Badge de plateforme : logo + libellé. Le logo disparaît s'il ne charge pas. */
function platformTag(slug, label) {
    const cle = String(slug ?? '').toLowerCase();
    const src = MGS.platformIcon(cle) || '';

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

    // Ces trois rendus étaient recopiés ici et dans construireDetails() ;
    // ils vivent maintenant dans rendreHighlights / rendreSections /
    // rendreLiens, plus bas dans ce fichier.
    const highlights = rendreHighlights(data.highlights);
    const sections   = rendreSections(data.sections);
    const links      = rendreLiens(data.links);

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

/* ============================================================
   STATS DÉTAILLÉES — un bloc dépliable par JEU

   Avant : un pavé par compte. Deux comptes Riot donnaient deux
   blocs « Riot Games » de trois écrans chacun, LoL et Valorant
   mélangés à l'intérieur, sans qu'on puisse rien refermer.

   Maintenant : une ligne repliée par jeu, tous comptes confondus.
   Le découpage vient de metrics.groups, envoyé par le provider ;
   une plateforme qui n'en déclare pas (Steam, Epic) garde un bloc
   unique à son nom.
   ============================================================ */

/** Rendu de repli des encadrés, quand match-detail.js n'est pas chargé. */
function rendreHighlights(liste) {
    if (typeof mgsHighlights === 'function') {
        return mgsHighlights(liste);
    }

    return (liste || []).map(item => `
        <div class="info-box">
            <span class="info-label">${escapeHtml(item.label)}</span>
            <span class="info-value">${escapeHtml(item.value ?? '-')}</span>
        </div>
    `).join('');
}

/** Idem pour les sections. */
function rendreSections(liste) {
    if (typeof mgsSections === 'function') {
        return mgsSections(liste);
    }

    return (liste || []).map(section => {
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
}

/** Liens externes d'un compte, rendus en une chaîne HTML. */
function rendreLiens(liste) {
    return (liste || []).map(l => {
        const url = safeUrl(l.url);
        return url
            ? `<a href="${url}" target="_blank" rel="noopener" class="profile-link">${escapeHtml(l.label)}</a>`
            : '';
    }).join('');
}

/**
 * Ne garde que ce qui concerne un jeu.
 *
 * Sans découpage déclaré, tout appartient au bloc unique. Avec
 * découpage, les entrées non étiquetées reviennent au PREMIER jeu :
 * un provider qui ajouterait demain un encadré commun ne le verrait
 * pas disparaître silencieusement de la page.
 */
function filtrerParJeu(liste, cle, decoupe, rang) {
    const items = liste || [];

    if (!decoupe) return items.slice();

    return items.filter(item =>
        item && (item.game === cle || (rang === 0 && item.game === undefined))
    );
}

/** Initiales affichées tant que la jaquette n'a pas chargé. */
function initialesJeu(nom) {
    return String(nom || '?')
        .split(/[\s:—-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(mot => mot[0].toUpperCase())
        .join('');
}

/** Rassemble les stats de tous les comptes, jeu par jeu. */
function grouperParJeu(resultats) {
    const groupes = new Map();   // Map : l'ordre d'insertion est conservé

    (resultats || []).forEach(entree => {
        const d = entree.data;
        if (!d) return;

        const metrics = d.metrics || {};

        const decoupe = Array.isArray(metrics.groups) && metrics.groups.length
            ? metrics.groups
            : null;

        const jeux = decoupe || [{
            key:            d.platform,
            name:           MGS.platformLabel(d.platform, d.platformLabel),
            image:          MGS.platformIcon(d.platform),
            hours:          Number(metrics.totalHours) || 0,
            hoursEstimated: metrics.hoursEstimated === true,
            rank:           (metrics.ranks || [])[0] || null,
        }];

        jeux.forEach((jeu, rang) => {
            const highlights = filtrerParJeu(d.highlights, jeu.key, decoupe, rang);
            const sections   = filtrerParJeu(d.sections,   jeu.key, decoupe, rang);
            const liens      = filtrerParJeu(d.links,      jeu.key, decoupe, rang);

            /* Ce compte n'a rien à dire sur ce jeu : pas de ligne
               fantôme. C'est le cas d'un compte Riot dont le
               fournisseur Valorant est muet — sans ce filtre, la page
               affichait un « Valorant » vide et impossible à déplier. */
            if (!highlights.length && !sections.length) return;

            const cle = d.platform + ':' + jeu.key;

            if (!groupes.has(cle)) {
                groupes.set(cle, {
                    cle:      cle,
                    platform: d.platform,
                    nom:      jeu.name,
                    image:    jeu.image || MGS.platformIcon(d.platform),
                    heures:   0,
                    estime:   false,
                    rang:     null,
                    comptes:  [],
                });
            }

            const g = groupes.get(cle);

            g.heures += Number(jeu.hours) || 0;
            g.estime  = g.estime || jeu.hoursEstimated === true;

            // Deux comptes sur le même jeu : la ligne repliée montre le
            // meilleur des deux rangs, le détail les montre tous.
            if (jeu.rank && (!g.rang || (jeu.rank.score ?? -1) > (g.rang.score ?? -1))) {
                g.rang = jeu.rank;
            }

            g.comptes.push({
                nom:        (entree.account && entree.account.displayName) || d.displayName || '',
                avatar:     safeUrl(d.avatar),
                sousTitre:  d.subtitle || '',
                liens:      liens,
                highlights: highlights,
                sections:   sections,
            });
        });
    });

    // Le jeu le plus joué en premier : c'est celui qu'on vient ouvrir.
    return Array.from(groupes.values())
        .filter(g => g.comptes.length)
        .sort((a, b) => b.heures - a.heures);
}

/** Contenu de la ligne repliée : jaquette, nom, comptes, rang, heures. */
function teteDeGroupe(groupe) {
    const noms = groupe.comptes.map(c => c.nom).filter(Boolean);

    const comptes = noms.length
        ? `<span class="fold-accounts">${escapeHtml(noms.join(' · '))}</span>`
        : '';

    const rang = groupe.rang
        ? `<span class="fold-rank"${groupe.rang.queue ? ` title="${escapeHtml(groupe.rang.queue)}"` : ''}>
               ${groupe.rang.icon
                    ? `<img src="${escapeHtml(groupe.rang.icon)}" alt="" loading="lazy"
                            onerror="this.remove()">`
                    : ''}
               <span>${escapeHtml(groupe.rang.label || '')}</span>
           </span>`
        : '';

    const heures = groupe.heures > 0
        ? `<span class="fold-hours"${groupe.estime ? ' title="Estimation"' : ''}>${
               groupe.estime ? '≈ ' : ''
           }${MGS.formaterNombre(Math.round(groupe.heures))} h</span>`
        : '';

    return `
        <span class="fold-cover">
            <em>${escapeHtml(initialesJeu(groupe.nom))}</em>
            ${groupe.image
                ? `<img src="${escapeHtml(groupe.image)}" alt="" loading="lazy"
                        onerror="this.remove()">`
                : ''}
        </span>
        <span class="fold-ident">
            <span class="fold-title">${escapeHtml(groupe.nom)}</span>
            ${comptes}
        </span>
        <span class="fold-meta">${rang}${heures}</span>
    `;
}

/** Un compte à l'intérieur d'un bloc déplié. */
function corpsDeCompte(compte, plusieursComptes) {
    const bloc = document.createElement('div');
    bloc.className = 'fold-account';

    const liens = rendreLiens(compte.liens);

    // Le nom du compte n'est rappelé ici que s'il y a de quoi confondre :
    // sur un seul compte, il est déjà sur la ligne repliée.
    const entete = (plusieursComptes || liens)
        ? `<div class="fold-account-head">
               ${plusieursComptes
                    ? `<span class="fold-account-who">
                           ${compte.avatar
                                ? `<img src="${compte.avatar}" alt=""
                                        onclick="openImageModal(this.src)">`
                                : ''}
                           <span class="fold-account-name">${escapeHtml(compte.nom)}</span>
                           ${compte.sousTitre
                                ? `<span class="fold-account-sub">${escapeHtml(compte.sousTitre)}</span>`
                                : ''}
                       </span>`
                    : ''}
               ${liens ? `<span class="fold-account-links">${liens}</span>` : ''}
           </div>`
        : '';

    const highlights = rendreHighlights(compte.highlights);

    bloc.innerHTML = `
        ${entete}
        ${highlights ? `<div class="info-grid">${highlights}</div>` : ''}
        ${rendreSections(compte.sections)}
    `;

    return bloc;
}

/** Toutes les stats détaillées, en lignes dépliables groupées par jeu. */
function construireDetails(resultats) {
    const groupes = grouperParJeu(resultats);

    if (!groupes.length) return null;

    const bloc = document.createElement('div');
    bloc.className = 'hub-details';

    groupes.forEach(groupe => {
        const fold = MGS.creerFold({
            head:    teteDeGroupe(groupe),
            classe:  'detail-fold--jeu',
            dataset: { platform: groupe.platform, game: groupe.cle },
        });

        const plusieurs = groupe.comptes.length > 1;

        groupe.comptes.forEach(compte => {
            fold.body.appendChild(corpsDeCompte(compte, plusieurs));
        });

        bloc.appendChild(fold.el);
    });

    return bloc;
}