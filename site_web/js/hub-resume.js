/* ============================================================
   HUB — RÉSUMÉ GLOBAL
   ------------------------------------------------------------
   Expose construireResume(resultats), appelé par profile-stats.js
   dans dessinerHub().

   IMPORTANT : ce fichier doit être chargé APRÈS stats-display.js
   (il réutilise escapeHtml) et AVANT profile-stats.js.

   Structure produite :
     .hub-global
        .hub-hero      -> total d'heures + barre par plateforme
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

/* ------------------------------------------------------------
   Agrégation des metrics de toutes les plateformes
   ------------------------------------------------------------ */

function hubAgreger(resultats) {
    const agg = {
        comptesLies:   0,
        comptesTotal:  resultats.length,
        totalHours:    0,
        recentHours:   0,
        games:         0,
        playedGames:   0,
        parts:         [],   // { slug, label, hours } pour la barre
        inconnues:     [],   // plateformes sans estimation d'heures
        topGame:       null,
        mainRank:      null,
        recentTop:     [],
    };

    resultats.forEach(r => {
        if (r.platform.linked) agg.comptesLies++;

        const m = r.data && r.data.metrics;
        if (!m) return;

        agg.games       += m.games       || 0;
        agg.playedGames += m.playedGames || 0;
        agg.recentHours += m.recentHours || 0;

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
        } else if ((m.totalHours || 0) > 0) {
            agg.totalHours += m.totalHours;
            agg.parts.push({
                slug:  r.platform.slug,
                label: r.platform.label,
                hours: m.totalHours,
            });
        }

        if (m.topGame && (!agg.topGame || m.topGame.hours > agg.topGame.hours)) {
            agg.topGame = m.topGame;
        }

        if (m.mainRank && !agg.mainRank) {
            agg.mainRank = Object.assign({ platform: r.platform.label }, m.mainRank);
        }

        (m.recentTop || []).forEach(jeu => agg.recentTop.push(jeu));
    });

    agg.parts.sort((a, b) => b.hours - a.hours);
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
                loading="lazy" onerror="this.remove()">`
        : "";

    return `
        <article class="feature-card">
            <span class="feature-label">Jeu principal</span>
            <div class="feature-visual">${visuel}</div>
            <p class="feature-title">${escapeHtml(agg.topGame.name)}</p>
            <p class="feature-sub">
                <strong>${hubNombre(agg.topGame.hours)} h</strong> · ${part} % du total
            </p>
        </article>
    `;
}

function hubCarteRang(agg) {
    if (!agg.mainRank) return "";

    const details = [];
    if (agg.mainRank.lp !== undefined && agg.mainRank.lp !== null) {
        details.push(`${hubNombre(agg.mainRank.lp)} LP`);
    }
    if (agg.mainRank.winrate !== undefined && agg.mainRank.winrate !== null) {
        details.push(`${hubNombre(agg.mainRank.winrate)} % winrate`);
    }

    return `
        <article class="feature-card">
            <span class="feature-label">Meilleur rang</span>
            <div class="feature-visual feature-visual--rank">
                <span class="rank-badge">${escapeHtml(agg.mainRank.label || "Non classé")}</span>
            </div>
            <p class="feature-title">${escapeHtml(agg.mainRank.queue || agg.mainRank.platform || "")}</p>
            <p class="feature-sub">${escapeHtml(details.join(" · ")) || "&nbsp;"}</p>
        </article>
    `;
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

    return bloc;
}