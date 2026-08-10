/* ============================================================
   HUB — RÉSUMÉ GLOBAL
   ------------------------------------------------------------
   Expose construireResume(resultats), appelé par profile-stats.js
   dans dessinerHub().

   Chargé APRÈS stats-display.js (réutilise escapeHtml)
   et AVANT profile-stats.js.

   Structure produite :
     .hub-global
        .hub-hero      -> total d'heures, barre par plateforme,
                          temps de l'année, valeur de la bibliothèque
        .hub-featured  -> jeu principal / meilleur rang / 2 semaines
        .hub-counters  -> compteurs secondaires
   ============================================================ */

const HUB_COULEURS = {
    steam: "#66c0f4",
    riot:  "#e84057",
    epic:  "#7c5cff",
};

function hubCouleur(slug) {
    return HUB_COULEURS[slug] || "#7c5cff";
}

function hubNombre(valeur, decimales = 0) {
    return Number(valeur || 0).toLocaleString("fr-FR", {
        minimumFractionDigits: decimales,
        maximumFractionDigits: decimales,
    });
}

/* Arrondi volontairement grossier : la valeur d'une bibliothèque est une
   estimation, l'afficher à l'euro près lui donnerait une fausse précision. */
function hubArrondiLarge(valeur) {
    const v = Number(valeur || 0);
    if (v <= 0) return 0;

    const pas = v < 500 ? 50 : v < 5000 ? 100 : 500;
    return Math.round(v / pas) * pas;
}

function hubDate(iso) {
    const d = new Date(String(iso) + "T00:00:00");
    return isNaN(d.getTime())
        ? String(iso)
        : d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

/* ------------------------------------------------------------
   Agrégation des metrics de toutes les plateformes
   ------------------------------------------------------------ */

function hubAgreger(resultats) {
    const agg = {
        comptesLies:   0,
        comptesTotal:  resultats.length,
        totalHours:    0,
        recentHours:   0,
        yearHours:     0,
        yearSince:     null,
        yearPartiel:   false,
        libraryValue:  0,
        libraryMesure: { mesures: 0, total: 0 },
        games:         0,
        playedGames:   0,
        parts:         [],   // { slug, label, hours } pour la barre
        inconnues:     [],   // plateformes sans estimation d'heures
        topGame:       null,
        ranks:         [],
        recentTop:     [],
    };

    resultats.forEach(r => {
        if (r.platform.linked) agg.comptesLies++;

        const m = r.data && r.data.metrics;
        if (!m) return;

        agg.games       += m.games       || 0;
        agg.playedGames += m.playedGames || 0;
        agg.recentHours += m.recentHours || 0;
        agg.yearHours   += m.yearHours   || 0;

        // On garde la date de repère la plus récente : c'est elle qui limite
        // ce qu'on peut réellement affirmer sur "cette année".
        if (m.yearSince && (!agg.yearSince || m.yearSince > agg.yearSince)) {
            agg.yearSince = m.yearSince;
        }
        if (m.yearPartial) agg.yearPartiel = true;

        agg.libraryValue += m.libraryValue || 0;
        if (m.libraryMeasured) {
            agg.libraryMesure.mesures += m.libraryMeasured.measured || 0;
            agg.libraryMesure.total   += m.libraryMeasured.total    || 0;
        }

        if ((m.totalHours || 0) > 0) {
            agg.totalHours += m.totalHours;
            agg.parts.push({
                slug:   r.platform.slug,
                label:  r.platform.label,
                hours:  m.totalHours,
                estime: !!m.hoursEstimated,
            });
        } else if (m.hoursUnknown || m.hoursEstimated) {
            agg.inconnues.push(r.platform.label);
        }

        if (m.topGame && (!agg.topGame || m.topGame.hours > agg.topGame.hours)) {
            agg.topGame = m.topGame;
        }

        // Tous les rangs de toutes les plateformes, pas seulement le premier.
        const rangs = Array.isArray(m.ranks)
            ? m.ranks
            : (m.mainRank ? [m.mainRank] : []);

        rangs.forEach(rang => {
            if (!rang) return;
            agg.ranks.push(Object.assign({
                platformLabel: r.platform.label,
                slug:          r.platform.slug,
            }, rang));
        });

        (m.recentTop || []).forEach(jeu => agg.recentTop.push(jeu));
    });

    agg.parts.sort((a, b) => b.hours - a.hours);

    // Tri sur le percentile, pas sur le tier brut : un Diamant LoL (top 3 %)
    // et un Diamant CS2 (top 15 %) ne valent pas la même chose.
    agg.ranks.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

    agg.recentTop.sort((a, b) => b.hours - a.hours);
    agg.recentTop = agg.recentTop.slice(0, 3);

    return agg;
}

/* ------------------------------------------------------------
   Étage 1 — le chiffre héros
   ------------------------------------------------------------ */

function hubHero(agg) {
    const jours = Math.round(agg.totalHours / 24);

    const segments = agg.parts.map(p => {
        const pct = agg.totalHours > 0 ? (p.hours / agg.totalHours) * 100 : 0;
        return `<span class="hero-seg"
                      style="width:${pct.toFixed(2)}%;background:${hubCouleur(p.slug)};${p.estime ? "opacity:.6;" : ""}"></span>`;
    }).join("");

    const legende = agg.parts.map(p => `
        <span class="hero-leg">
            <i style="background:${hubCouleur(p.slug)}"></i>${escapeHtml(p.label)} ${p.estime ? "≈ " : ""}${hubNombre(p.hours)} h
        </span>
    `).join("");

    const inconnues = agg.inconnues.length
        ? `<span class="hero-leg hero-leg--muted">${escapeHtml(agg.inconnues.join(", "))} : estimation indisponible</span>`
        : "";

    /* --- Colonne de droite, façon "Account Value" --- */
    const cotes = [];

    if (agg.yearHours > 0) {
        cotes.push(`
            <div class="hero-side-stat">
                <span class="hero-side-label">Cette année</span>
                <span class="hero-side-value">${hubNombre(agg.yearHours)} h</span>
                <span class="hero-side-note">${
                    agg.yearPartiel && agg.yearSince
                        ? `mesuré depuis le ${escapeHtml(hubDate(agg.yearSince))}`
                        : "depuis le 1er janvier"
                }</span>
            </div>
        `);
    }

    if (agg.libraryValue > 0) {
        const m = agg.libraryMesure;
        const note = (m.total > 0 && m.mesures < m.total)
            ? `${hubNombre(m.mesures)} prix relevés sur ${hubNombre(m.total)}`
            : "prix boutique actuels";

        cotes.push(`
            <div class="hero-side-stat">
                <span class="hero-side-label">Valeur estimée</span>
                <span class="hero-side-value hero-side-value--money">≈ ${hubNombre(hubArrondiLarge(agg.libraryValue))} €</span>
                <span class="hero-side-note">${note}</span>
            </div>
        `);
    }

    const cote = cotes.length
        ? `<aside class="hero-side">${cotes.join("")}</aside>`
        : "";

    return `
        <section class="hub-hero">
            <div class="hero-main">
                <span class="hero-label">Temps de jeu cumulé</span>

                <div class="hero-line">
                    <span class="hero-value">${hubNombre(agg.totalHours)} h</span>
                    <span class="hero-unit">heures</span>
                    <span class="hero-aside">soit ${hubNombre(jours)} jours non-stop</span>
                </div>

                <div class="hero-bar">${segments}</div>
                <div class="hero-legend">${legende}${inconnues}</div>
            </div>
            ${cote}
        </section>
    `;
}

/* ------------------------------------------------------------
   Étage 2 — cartes vedettes
   ------------------------------------------------------------ */

function hubCarteJeuPrincipal(agg) {
    if (!agg.topGame) return "";

    const part = agg.totalHours > 0
        ? Math.round((agg.topGame.hours / agg.totalHours) * 100)
        : 0;

      const visuel = agg.topGame.image
        ? `<img src="${escapeHtml(agg.topGame.image)}" alt=""
                loading="lazy" decoding="async"
                onerror="this.parentElement.remove()">`
        : "";
    // Les heures Riot sont déduites des points de maîtrise : on le signale.
    const prefixe = agg.topGame.estimated ? "≈ " : "";

    return `
        <article class="feature-card">
            <span class="feature-label">Jeu principal</span>
            <div class="feature-visual">${visuel}</div>
            <p class="feature-title">${escapeHtml(agg.topGame.name)}</p>
            <p class="feature-sub">
                <strong>${prefixe}${hubNombre(agg.topGame.hours)} h</strong> · ${part} % du total
            </p>
        </article>
    `;
}

function hubCarteRang(agg) {
    if (!agg.ranks.length) return "";

    const slides = agg.ranks.map((rang, i) => {
        const icone = rang.icon
            ? `<img class="rank-icon" src="${escapeHtml(rang.icon)}" alt=""
                    loading="lazy" onerror="this.remove()">`
            : "";

        const top = (rang.score !== null && rang.score !== undefined)
            ? `<p class="rank-top">Top ${hubNombre(Math.max(0.1, 100 - rang.score), 1)} % des joueurs</p>`
            : "";

        const sousTitre = [rang.queue, rang.sub].filter(Boolean).join(" · ");

        return `
            <div class="rank-slide" data-rank-slide="${i}"${i === 0 ? "" : " hidden"}>
                <div class="rank-visual">
                    ${icone}
                    <span class="rank-badge">${escapeHtml(rang.label || "Non classé")}</span>
                </div>
                <p class="feature-title">${escapeHtml(rang.game || rang.platformLabel || "")}</p>
                <p class="feature-sub">${escapeHtml(sousTitre) || "&nbsp;"}</p>
                ${top}
            </div>
        `;
    }).join("");

    const nav = agg.ranks.length > 1 ? `
        <div class="rank-nav">
            <button type="button" class="rank-arrow" data-rank-prev
                    aria-label="Rang précédent">‹</button>
            <div class="rank-dots">
                ${agg.ranks.map((rang, i) => `
                    <button type="button" class="rank-dot${i === 0 ? " is-active" : ""}"
                            data-rank-dot="${i}"
                            aria-label="${escapeHtml([rang.game, rang.queue].filter(Boolean).join(" "))}"></button>
                `).join("")}
            </div>
            <button type="button" class="rank-arrow" data-rank-next
                    aria-label="Rang suivant">›</button>
        </div>
    ` : "";

    return `
        <article class="feature-card feature-card--rank" data-rank-card>
            <span class="feature-label">Meilleur rang</span>
            <div class="rank-stage">${slides}</div>
            ${nav}
        </article>
    `;
}

/* Navigation entre les rangs. Appelée avant insertion dans le document :
   bloc est déjà un vrai élément, querySelector fonctionne. */
function hubBrancherRangs(bloc) {
    const carte = bloc.querySelector("[data-rank-card]");
    if (!carte) return;

    const slides = Array.from(carte.querySelectorAll("[data-rank-slide]"));
    const puces  = Array.from(carte.querySelectorAll("[data-rank-dot]"));
    if (slides.length < 2) return;

    let index = 0;

    function afficher(n) {
        index = (n + slides.length) % slides.length;
        slides.forEach((s, i) => { s.hidden = i !== index; });
        puces.forEach((p, i) => p.classList.toggle("is-active", i === index));
    }

    const prev = carte.querySelector("[data-rank-prev]");
    const next = carte.querySelector("[data-rank-next]");

    if (prev) prev.addEventListener("click", e => { e.stopPropagation(); afficher(index - 1); });
    if (next) next.addEventListener("click", e => { e.stopPropagation(); afficher(index + 1); });

    puces.forEach((p, i) => {
        p.addEventListener("click", e => { e.stopPropagation(); afficher(i); });
    });

    carte.tabIndex = 0;
    carte.setAttribute("role", "group");
    carte.setAttribute("aria-label", "Rangs classés, du meilleur au moins bon");

    carte.addEventListener("click", () => afficher(index + 1));

    carte.addEventListener("keydown", e => {
        if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            afficher(index + 1);
        } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            afficher(index - 1);
        }
    });
}

function hubCarteRecent(agg) {
    if (!agg.recentTop.length && !agg.recentHours) return "";

    const max = agg.recentTop.length
        ? Math.max.apply(null, agg.recentTop.map(j => j.hours || 0))
        : 0;

    const lignes = agg.recentTop.map(jeu => {
        const pct = max > 0 ? (jeu.hours / max) * 100 : 0;
        return `
            <div class="recent-row">
                <div class="recent-head">
                    <span class="recent-name">${escapeHtml(jeu.name)}</span>
                    <span class="recent-hours">${hubNombre(jeu.hours, 1)} h</span>
                </div>
                <div class="recent-track">
                    <span class="recent-fill"
                          style="display:block;width:${pct.toFixed(2)}%;background:${hubCouleur(jeu.platform)}"></span>
                </div>
            </div>
        `;
    }).join("");

    return `
        <article class="feature-card">
            <span class="feature-label">Ces 2 semaines</span>
            <div class="recent-total">
                <span class="recent-value">${hubNombre(agg.recentHours, 1)}</span>
                <span class="recent-unit">heures jouées</span>
            </div>
            ${lignes || `<p class="feature-sub">Aucune partie récente.</p>`}
        </article>
    `;
}

/* ------------------------------------------------------------
   Étage 3 — compteurs secondaires
   ------------------------------------------------------------ */

function hubCompteurs(agg) {
    const moyenne = agg.playedGames > 0 ? agg.totalHours / agg.playedGames : 0;

    const boites = [
        [hubNombre(agg.games),            "Jeux possédés"],
        [hubNombre(agg.playedGames),      "Jeux lancés"],
        [hubNombre(moyenne, 1) + " h",    "Moyenne / jeu"],
        [`${agg.comptesLies} / ${agg.comptesTotal}`, "Comptes liés"],
    ];

    return `
        <section class="hub-counters">
            ${boites.map(([valeur, label]) => `
                <div class="summary-box">
                    <span class="summary-value">${valeur}</span>
                    <span class="summary-label">${label}</span>
                </div>
            `).join("")}
        </section>
    `;
}

/* ------------------------------------------------------------
   Point d'entrée appelé par profile-stats.js
   ------------------------------------------------------------ */

function construireResume(resultats) {
    const agg = hubAgreger(resultats);

    // Aucune plateforme liée : on ne dessine rien, profile-stats.js
    // affichera son message "Lie un compte...".
    if (agg.comptesLies === 0) return null;

    const cartes = hubCarteJeuPrincipal(agg) + hubCarteRang(agg) + hubCarteRecent(agg);

    const bloc = document.createElement("div");
    bloc.className = "hub-global";
    bloc.innerHTML = `
        ${hubHero(agg)}
        ${cartes ? `<div class="hub-featured">${cartes}</div>` : ""}
        ${hubCompteurs(agg)}
    `;

    hubBrancherRangs(bloc);

    return bloc;
}