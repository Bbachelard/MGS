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

/* Les couleurs de plateforme viennent du registre partagé
   (js/core/mgs-core.js), au même endroit que les libellés et les icônes. */
const hubCouleur = MGS.platformColor;

/* HEX -> HSL, pour pouvoir décliner une teinte sans coder 12 constantes. */
function hubHexHsl(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255,
          g = ((n >> 8)  & 255) / 255,
          b = (n & 255) / 255;

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2, d = max - min;

    if (d === 0) return { h: 0, s: 0, l: l * 100 };

    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === r)      h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;

    return { h: (Math.round(h * 60) + 360) % 360, s: s * 100, l: l * 100 };
}

/* Même teinte que la plateforme, luminosité alternée autour de la base :
   2 comptes restent très contrastés, 5 tiennent encore. */
function hubNuance(slug, rang = 0, total = 1) {
    const base = hubCouleur(slug);
    if (total <= 1 || rang === 0) return base;

    const { h, s, l } = hubHexHsl(base);
    const ecart = Math.ceil(rang / 2) * 13 * (rang % 2 === 1 ? 1 : -1);
    const lum   = Math.min(82, Math.max(26, l + ecart));

    return `hsl(${h} ${Math.round(s)}% ${Math.round(lum)}%)`;
}

/* Le formatage numérique lui-même est mutualisé ; seul le choix des
   décimales reste propre à chaque écran. */
function hubNombre(valeur, decimales = 0) {
    return MGS.formaterNombre(valeur || 0, decimales);
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

/* ============================================================
   PATCH hub-resume.js

   Remplace INTÉGRALEMENT deux fonctions existantes :
     - hubAgreger()
     - hubCompteurs()

   Tout le reste du fichier (hubHero, hubCarteJeuPrincipal,
   hubCarteRang, hubBrancherRangs, hubCarteRecent, construireResume)
   ne bouge pas : la structure produite est identique, seule la
   façon de la remplir change.
   ============================================================ */

/* ------------------------------------------------------------
   Agrégation — désormais une entrée PAR COMPTE, plus par plateforme
   ------------------------------------------------------------ */

function hubAgreger(resultats) {
    const agg = {
        comptesLies:   0,
        comptesTotal:  0,
        totalHours:    0,
        recentHours:   0,
        yearHours:     0,
        yearSince:     null,
        yearPartiel:   false,
        libraryValue:  0,
        libraryMesure: { mesures: 0, total: 0 },
        games:         0,
        playedGames:   0,
        gamesDetail:   [],
        parts:         [],   // { slug, label, hours } pour la barre
        inconnues:     [],   // plateformes sans estimation d'heures
        topGame:       null,
        ranks:         [],
        recentTop:     [],
        heuresPayantes: 0,
    };

    // Les heures sont cumulées PAR PLATEFORME, pas par compte : la barre
    // du hero doit montrer 3 segments (Steam / Riot / Epic), pas un
    // segment par smurf.
    const parts      = new Map();
    const inconnues  = new Set();
    const topGames   = new Map();
    const recentJeux = new Map();
    const jeuxParPlateforme = new Map();

    agg.comptesTotal = new Set(resultats.map(r => r.platform.slug)).size;

    resultats.forEach(r => {
        if (r.account) agg.comptesLies++;

        const m = r.data && r.data.metrics;
        if (!m) return;

        agg.games       += m.games       || 0;
        agg.playedGames += m.playedGames || 0;
        agg.recentHours += m.recentHours || 0;
        agg.yearHours   += m.yearHours   || 0;
        // Détail par plateforme : "165" tout seul ne disait pas d'où
        // venaient les jeux. Les comptes d'une même plateforme s'additionnent.
        const detail = jeuxParPlateforme.get(r.platform.slug)
            || { label: r.platform.label, games: 0, played: 0 };

        detail.games  += m.games       || 0;
        detail.played += m.playedGames || 0;

        jeuxParPlateforme.set(r.platform.slug, detail);

        // On garde la date de repère la plus récente : c'est elle qui limite
        // ce qu'on peut réellement affirmer sur "cette année".
        if (m.yearSince && (!agg.yearSince || m.yearSince > agg.yearSince)) {
            agg.yearSince = m.yearSince;
        }
        if (m.yearPartial) agg.yearPartiel = true;

        agg.libraryValue += m.libraryValue || 0;
        if ((m.libraryValue || 0) > 0) agg.heuresPayantes += m.totalHours || 0;
        if (m.libraryMeasured) {
            agg.libraryMesure.mesures += m.libraryMeasured.measured || 0;
            agg.libraryMesure.total   += m.libraryMeasured.total    || 0;
        }

        if ((m.totalHours || 0) > 0) {
            // Une entrée par COMPTE : c'est ce que la barre doit montrer.
            const cle = r.platform.slug + '|' +
                        (r.account ? String(r.account.id ?? r.account.accountId) : '-');

            const p = parts.get(cle) || {
                slug:   r.platform.slug,
                label:  r.platform.label,
                compte: (r.account && r.account.displayName) || null,
                hours:  0,
                estime: false,
            };
            p.hours += m.totalHours;
            p.estime = p.estime || !!m.hoursEstimated;
            parts.set(cle, p);
        } else if (m.hoursUnknown || m.hoursEstimated) {
            inconnues.add(r.platform.label);
        }

        /* Jeu principal : deux comptes Riot jouent au MÊME jeu, leurs
           heures s'additionnent au lieu de se faire concurrence. */
        if (m.topGame && m.topGame.name) {
            const cle = r.platform.slug + '|' + m.topGame.name;
            const jeu = topGames.get(cle);

            if (jeu) {
                jeu.hours += m.topGame.hours || 0;
            } else {
                topGames.set(cle, Object.assign({}, m.topGame));
            }
        }

        /* Rangs : on empile ceux de TOUS les comptes. hubCarteRang les
           affiche déjà l'un après l'autre, triés du meilleur au moins bon.
           On glisse le nom du compte dans le libellé de la file pour
           distinguer le main du smurf sans toucher au rendu. */
        const nbComptes = (r.platform.accounts || []).length;
        const nomCompte = r.account && r.account.displayName ? r.account.displayName : null;

        const rangs = Array.isArray(m.ranks)
            ? m.ranks
            : (m.mainRank ? [m.mainRank] : []);

        rangs.forEach(rang => {
            if (!rang) return;

            const copie = Object.assign({
                platformLabel: r.platform.label,
                slug:          r.platform.slug,
                compte:        nomCompte,
            }, rang);

            if (nbComptes > 1 && nomCompte) {
                copie.queue = copie.queue
                    ? `${copie.queue} · ${nomCompte}`
                    : nomCompte;
            }

            agg.ranks.push(copie);
        });

        // Jeux récents : même logique de fusion par nom.
        (m.recentTop || []).forEach(jeu => {
            if (!jeu || !jeu.name) return;
            const existant = recentJeux.get(jeu.name);

            if (existant) {
                existant.hours += jeu.hours || 0;
            } else {
                recentJeux.set(jeu.name, Object.assign({}, jeu));
            }
        });
    });

    /* Les comptes d'une même plateforme doivent être COLLÉS dans la barre,
       sinon les nuances de rouge se retrouvent séparées par du bleu. */
    const totalPlateforme = new Map();
    parts.forEach(p => totalPlateforme.set(p.slug, (totalPlateforme.get(p.slug) || 0) + p.hours));

    agg.parts = Array.from(parts.values()).sort((a, b) =>
        (totalPlateforme.get(b.slug) - totalPlateforme.get(a.slug)) || (b.hours - a.hours)
    );

    // rang = position du compte dans sa plateforme (-> nuance)
    const rangs = new Map();
    agg.parts.forEach(p => {
        p.rang = rangs.get(p.slug) || 0;
        rangs.set(p.slug, p.rang + 1);
    });
    agg.parts.forEach(p => { p.total = rangs.get(p.slug); });
    agg.parts.forEach(p => { agg.totalHours += p.hours; });

    agg.inconnues = Array.from(inconnues);

    agg.topGame = Array.from(topGames.values())
        .sort((a, b) => (b.hours || 0) - (a.hours || 0))[0] || null;

    // Tri sur le percentile, pas sur le tier brut : un Diamant LoL (top 3 %)
    // et un Diamant CS2 (top 15 %) ne valent pas la même chose.
    agg.ranks.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

    agg.recentTop = Array.from(recentJeux.values())
        .sort((a, b) => b.hours - a.hours)
        .slice(0, 3);


    agg.gamesDetail = Array.from(jeuxParPlateforme.values())
    .sort((a, b) => b.games - a.games);
    return agg;
}



/* ------------------------------------------------------------
   Étage 1 — le chiffre héros
   ------------------------------------------------------------ */

function hubHero(agg) {
    const jours = Math.round(agg.totalHours / 24);

    const segments = agg.parts.map(p => {
        const pct = agg.totalHours > 0 ? (p.hours / agg.totalHours) * 100 : 0;
        const nom = p.compte ? `${p.label} — ${p.compte}` : p.label;
        return `<span class="hero-seg"
                      title="${escapeHtml(nom)} : ${hubNombre(p.hours)} h"
                      style="width:${pct.toFixed(2)}%;background:${hubNuance(p.slug, p.rang, p.total)};${p.estime ? "opacity:.75;" : ""}"></span>`;
    }).join("");

    const legende = agg.parts.map(p => {
        const multi = p.total > 1 && p.compte;
        const texte = multi
            ? `<b>${escapeHtml(p.compte)}</b> <em>${escapeHtml(p.label)}</em>`
            : escapeHtml(p.label);

        return `<span class="hero-leg">
                    <i style="background:${hubNuance(p.slug, p.rang, p.total)}"></i>${texte} ${p.estime ? "≈ " : ""}${hubNombre(p.hours)} h
                </span>`;
    }).join("");

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

    if (agg.libraryValue > 0 && agg.heuresPayantes > 0) {
        const parHeure = agg.libraryValue / agg.heuresPayantes;

        cotes.push(`
            <div class="hero-side-stat">
                <span class="hero-side-label">Prix de l'heure</span>
                <span class="hero-side-value hero-side-value--money">${hubNombre(parHeure, 2)} €</span>
                <span class="hero-side-note">${hubNombre(hubArrondiLarge(agg.libraryValue))} € de jeux · ${hubNombre(agg.heuresPayantes)} h jouées</span>
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
    // playedGames inclut désormais LoL et Fortnite : la moyenne divise
    // enfin des heures et des jeux qui parlent du même périmètre.
    const moyenne = agg.playedGames > 0 ? agg.totalHours / agg.playedGames : 0;

    const detail = cle => (agg.gamesDetail || [])
        .filter(d => d[cle] > 0)
        .map(d => `${d.label} : ${hubNombre(d[cle])}`)
        .join("\n");

    const boites = [
        [hubNombre(agg.games),         "Jeux possédés", detail("games")],
        [hubNombre(agg.playedGames),   "Jeux lancés",   detail("played")],
        [hubNombre(moyenne, 1) + " h", "Moyenne / jeu", ""],
        [hubNombre(agg.comptesLies),
         agg.comptesLies > 1 ? "Comptes liés" : "Compte lié", ""],
    ];

    return `
        <section class="hub-counters">
            ${boites.map(([valeur, label, infobulle]) => `
                <div class="summary-box${infobulle ? " summary-box--info" : ""}"
                     ${infobulle ? `title="${escapeHtml(infobulle)}"` : ""}>
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