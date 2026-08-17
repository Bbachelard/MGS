const gamesState = {
    games: [],
    totals: {},
    filtre: "",
    plateforme: "",              // "" = toutes
    plateformes: [],             // slugs réellement présents
    avertissements: [],
    tri: { colonne: "hours", sens: "desc" },
    parPage: 100,
    page: 1,
};

/* Le miroir local de mgs_platforms() est parti dans js/core/mgs-core.js :
   il en existait trois copies à tenir synchronisées à la main. */
const GAMES_PLATEFORMES = MGS.PLATFORMS;

const GAMES_COLONNES = [
    { cle: "platformLabel", label: "",              triable: true,  type: "texte", classe: "col-platform" },
    { cle: "image",         label: "",              triable: false, classe: "col-img" },
    { cle: "name",          label: "Nom",           triable: true,  type: "texte" },
    { cle: "hours",         label: "Temps total",   triable: true,  type: "nombre" },
    { cle: "recentHours",   label: "2 semaines",    triable: true,  type: "nombre" },
    { cle: "lastPlayed",    label: "Dernière fois", triable: true,  type: "nombre" },
];

/**
 * Bibliothèque de TOUS les comptes liés.
 *
 * @param comptes  etatComptes de profile-stats.js : { platform, account, data, error }
 */
async function chargerBibliotheques(comptes, options = {}) {
    const zone = document.getElementById("games-table");
    if (!zone) return;

    gamesState.lectureSeule = options.lectureSeule === true;

    zone.innerHTML = `<p class="stats-loading">Chargement de la bibliothèque...</p>`;

    const lies = (comptes || []).filter(c => c.account);

    if (!lies.length) {
        zone.innerHTML = "";
        return;
    }

    const lots = await Promise.all(lies.map(c => chargerLot(c, options)));

    const jeux = [];
    const avertissements = [];

    lots.forEach(lot => {
        if (lot.error) avertissements.push(lot.error);
        lot.games.forEach(j => jeux.push(j));
    });

    gamesState.games          = fusionnerDoublons(jeux);
    gamesState.avertissements = avertissements;
    gamesState.totals         = totauxGlobaux(gamesState.games);
    gamesState.plateformes    = Array.from(new Set(gamesState.games.map(j => j.platform)));

    dessinerTableau();
}

/** Un compte = un appel games.php, avec repli sur une ligne synthétique. */
async function chargerLot(entree, options) {
    const slug = entree.platform.slug;
    if (entree.platform.hasLibrary === false) {
        return { games: ligneVirtuelle(entree), error: null };
    }

    const params = new URLSearchParams({
        platform:  slug,
        accountId: entree.account.accountId,
    });
    if (options.userId) params.set("userId", String(options.userId));

    let reponse;
    let data;

    try {
        reponse = await fetch(`/php/games.php?${params.toString()}`, { credentials: "include" });
        data    = await reponse.json();
    } catch (err) {
        console.error("games:", slug, err);
        return {
            games: ligneVirtuelle(entree),
            error: `${entree.platform.label} : bibliothèque injoignable.`,
        };
    }

    // 501 = le provider n'expose pas de bibliothèque (Riot, Epic).
    // Ce n'est pas une panne : on retombe sur la ligne estimée, sans alerte.
    if (reponse.status === 501) {
        return { games: ligneVirtuelle(entree), error: null };
    }

    if (!reponse.ok || data.error) {
        return {
            games: ligneVirtuelle(entree),
            error: `${entree.platform.label} : ${data.error || "erreur HTTP " + reponse.status}`,
        };
    }

    return {
        games: (data.games || []).map(j => ligne(slug, j, false)),
        error: null,
    };
}

/** "Fortnite — Solo" est un mode, pas un jeu. */
function nomDeJeu(nom) {
    return String(nom).split(" — ")[0];
}

/**
 * Plateforme sans bibliothèque : on fabrique les lignes à partir des
 * stats déjà chargées. LoL, Valorant et Fortnite existent, ils méritent
 * leur ligne.
 *
 * Deux sources, dans cet ordre :
 *   metrics.virtualGames — liste explicite (Riot : LoL + Valorant), avec
 *                          les heures propres à CHAQUE jeu ;
 *   metrics.topGame      — repli historique pour les providers qui n'en
 *                          déclarent qu'un (Epic / Fortnite). Les heures
 *                          viennent alors du total de la plateforme.
 */
function ligneVirtuelle(entree) {
    const m = (entree.data && entree.data.metrics) || null;
    if (!m) return [];

    const slug = entree.platform.slug;

    if (Array.isArray(m.virtualGames) && m.virtualGames.length) {
        return m.virtualGames
            .filter(jeu => jeu && jeu.name && Number(jeu.hours) > 0)
            .map(jeu => ligne(slug, {
                name:        nomDeJeu(jeu.name),
                image:       jeu.image || "",
                storeUrl:    "",
                hours:       Number(jeu.hours) || 0,
                // Aucun provider sans bibliothèque ne sait ventiler les
                // « 2 semaines » jeu par jeu : on ne les invente pas.
                recentHours: 0,
                lastPlayed:  null,
            }, true));
    }

    const jeu = m.topGame;

    if (!jeu || !jeu.name || !(m.totalHours > 0)) return [];

    return [ligne(slug, {
        name:        nomDeJeu(jeu.name),
        image:       jeu.image || "",
        storeUrl:    "",
        hours:       Number(m.totalHours)  || 0,
        recentHours: Number(m.recentHours) || 0,
        lastPlayed:  null,
    }, true)];
}

function ligne(slug, jeu, estime) {
    const meta = GAMES_PLATEFORMES[slug] || { label: slug };

    return Object.assign({}, jeu, {
        platform:      slug,
        platformLabel: meta.label,
        estime:        !!estime,
    });
}

/** Plusieurs comptes Riot jouent au même LoL : une seule ligne, heures cumulées. */
function fusionnerDoublons(jeux) {
    const parCle = new Map();

    jeux.forEach(jeu => {
        const cle      = jeu.platform + "|" + jeu.name;
        const existant = parCle.get(cle);

        if (!existant) {
            parCle.set(cle, jeu);
            return;
        }

        existant.hours       += jeu.hours       || 0;
        existant.recentHours += jeu.recentHours || 0;
        existant.lastPlayed   = Math.max(existant.lastPlayed || 0, jeu.lastPlayed || 0) || null;
    });

    return Array.from(parCle.values());
}

function totauxGlobaux(jeux) {
    return {
        count:  jeux.length,
        played: jeux.filter(j => (j.hours || 0) > 0).length,
        hours:  Math.round(jeux.reduce((s, j) => s + (j.hours || 0), 0) * 10) / 10,
    };
}

async function chargerBibliotheque(slug, options = {}) {
    const zone = document.getElementById("games-table");
    if (!zone) return;

    gamesState.lectureSeule = options.lectureSeule === true;

    zone.innerHTML = `<p class="stats-loading">Chargement de la bibliothèque...</p>`;

    const params = new URLSearchParams({ platform: slug });
    if (options.userId) params.set("userId", String(options.userId));

    try {
        const response = await fetch(`/php/games.php?${params.toString()}`, {
            credentials: "include"
        });
        const data = await response.json();

        if (data.error) {
            zone.innerHTML = `<p class="stats-error">${escapeHtml(data.error)}</p>`;
            return;
        }

        gamesState.games  = data.games;
        gamesState.totals = data.totals;

        dessinerTableau();

    } catch (err) {
        console.error("games:", err);
        zone.innerHTML = `<p class="stats-error">Impossible de charger ta bibliothèque.</p>`;
    }
}

function jeuxFiltres() {
    const q = gamesState.filtre.trim().toLowerCase();

    let liste = [...gamesState.games];

    if (gamesState.plateforme) {
        liste = liste.filter(g => g.platform === gamesState.plateforme);
    }

    if (q) {
        liste = liste.filter(g => g.name.toLowerCase().includes(q));
    }

    const { colonne, sens } = gamesState.tri;
    const facteur = sens === "asc" ? 1 : -1;
    const meta = GAMES_COLONNES.find(c => c.cle === colonne);

    liste.sort((a, b) => {
        const va = a[colonne];
        const vb = b[colonne];

        // Les valeurs inconnues (jamais joué) finissent toujours en bas
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;

        return meta?.type === "texte"
            ? String(va).localeCompare(String(vb), "fr") * facteur
            : (va - vb) * facteur;
    });

    return liste;
}

function formaterHeures(valeur) {
    if (valeur === 0) return `<span class="cell-muted">–</span>`;
    return valeur.toLocaleString("fr-FR", { minimumFractionDigits: 1 }) + "h";
}
/** Pastille de repli quand un jeu n'a pas de jaquette. */
function initiales(nom) {
    return String(nom || "?")
        .split(/[\s:—-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(mot => mot[0].toUpperCase())
        .join("");
}

function formaterDate(timestamp) {
    if (!timestamp) return `<span class="cell-muted">Jamais</span>`;
    return new Date(timestamp * 1000).toLocaleDateString("fr-FR");
}

/* ------------------------------------------------------------
   Coquille dépliable

   Le tableau se redessine à chaque tri, chaque frappe dans la
   recherche et chaque changement de page. Si la coquille était
   reconstruite avec lui, le bloc se refermerait sous les doigts de
   l'utilisateur : elle est donc créée UNE fois, et seul son
   intérieur est réécrit.
   ------------------------------------------------------------ */

let bibliothequeFold = null;

function coquilleBibliotheque(zone) {
    // zone.contains() suffit à détecter que la zone a été vidée
    // entre-temps (message de chargement, profil rechargé).
    if (bibliothequeFold && zone.contains(bibliothequeFold.el)) {
        return bibliothequeFold;
    }

    bibliothequeFold = MGS.creerFold({
        classe:  "detail-fold--bibliotheque",
        dataset: { fold: "bibliotheque" },
    });

    zone.innerHTML = "";
    zone.appendChild(bibliothequeFold.el);

    return bibliothequeFold;
}

/** Ligne repliée : titre, plateformes couvertes, nombre de jeux, heures. */
function teteBibliotheque() {
    const t = gamesState.totals || {};
    const nb = t.count ?? 0;

    const plateformes = (gamesState.plateformes || [])
        .map(slug => MGS.platformLabel(slug, slug))
        .join(" · ");

    return `
        <span class="fold-cover fold-cover--icone" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
                 stroke="currentColor" stroke-width="1.8"
                 stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="5" height="16" rx="1"></rect>
                <rect x="10" y="4" width="5" height="16" rx="1"></rect>
                <path d="M17.6 5.1 21 18.8"></path>
            </svg>
        </span>
        <span class="fold-ident">
            <span class="fold-title">${gamesState.lectureSeule ? "Sa bibliothèque" : "Ma bibliothèque"}</span>
            ${plateformes ? `<span class="fold-accounts">${escapeHtml(plateformes)}</span>` : ""}
        </span>
        <span class="fold-meta">
            <span class="fold-count">${MGS.formaterNombre(nb)} jeu${nb > 1 ? "x" : ""}</span>
            <span class="fold-count">${MGS.formaterNombre(t.played ?? 0)} lancé${(t.played ?? 0) > 1 ? "s" : ""}</span>
            <span class="fold-hours">${MGS.formaterNombre(t.hours ?? 0, 0, 1)} h</span>
        </span>
    `;
}

function dessinerTableau() {
    const zone = document.getElementById("games-table");
    if (!zone) return;

    const liste = jeuxFiltres();
    const pages = Math.max(1, Math.ceil(liste.length / gamesState.parPage));
    gamesState.page = Math.min(gamesState.page, pages);

    const debut = (gamesState.page - 1) * gamesState.parPage;
    const visibles = liste.slice(debut, debut + gamesState.parPage);

    const entetes = GAMES_COLONNES.map(col => {
        if (!col.triable) return `<th class="${col.classe || ""}"></th>`;
        const actif = gamesState.tri.colonne === col.cle;
        const fleche = actif ? (gamesState.tri.sens === "asc" ? "▲" : "▼") : "⇅";
        return `<th class="th-sort ${actif ? "is-active" : ""}" data-col="${col.cle}">
                    ${escapeHtml(col.label)} <span class="sort-arrow">${fleche}</span>
                </th>`;
    }).join("");

    const lignes = visibles.map(jeu => {
        const meta = GAMES_PLATEFORMES[jeu.platform] || { label: jeu.platform, icon: "" };
        const url  = safeUrl(jeu.storeUrl);
        return `
         <tr>
            <td class="col-platform">
                ${meta.icon
                    ? `<img class="games-platform-logo" src="${escapeHtml(meta.icon)}"
                            alt="${escapeHtml(meta.label)}" title="${escapeHtml(meta.label)}"
                            loading="lazy" onerror="this.remove()">`
                    : escapeHtml(meta.label)}
            </td>
            <td class="col-img">
                <span class="game-thumb">
                    <em>${escapeHtml(initiales(jeu.name))}</em>
                    ${jeu.image
                        ? `<img src="${escapeHtml(jeu.image)}" alt="" loading="lazy"
                                onerror="this.remove()">`
                        : ""}
                </span>
            </td>
            <td class="col-name">
                ${url
                    ? `<a href="${url}" target="_blank" rel="noopener">${escapeHtml(jeu.name)}</a>`
                    : escapeHtml(jeu.name)}
            </td>
            <td>${jeu.estime ? "≈ " : ""}${formaterHeures(jeu.hours)}</td>
            <td>${formaterHeures(jeu.recentHours)}</td>
            <td>${formaterDate(jeu.lastPlayed)}</td>
        </tr>
        `;
    }).join("");

    const alerte = (gamesState.avertissements || []).length
        ? `<p class="games-warning">${escapeHtml(gamesState.avertissements.join(" · "))}</p>`
        : "";

    const optionsPlateforme = ['<option value="">Toutes les plateformes</option>']
        .concat((gamesState.plateformes || []).map(slug => {
            const meta = GAMES_PLATEFORMES[slug] || { label: slug };
            const sel  = slug === gamesState.plateforme ? " selected" : "";
            return `<option value="${escapeHtml(slug)}"${sel}>${escapeHtml(meta.label)}</option>`;
        }))
        .join("");
    const fold = coquilleBibliotheque(zone);

    // Le titre part dans la ligne repliée : le répéter juste en dessous
    // ferait doublon dès que le bloc est ouvert.
    fold.el.querySelector(".fold-head").innerHTML =
        teteBibliotheque() + '<span class="fold-chevron" aria-hidden="true"></span>';

    /* Le pavé des trois totaux a disparu d'ici : la ligne repliée porte
       déjà les mêmes chiffres, et les lire deux fois à 40 px d'écart
       n'apprenait rien — c'est exactement le genre de place que ce
       chantier cherche à rendre. */
    fold.body.innerHTML = `

        ${alerte}

        <div class="games-toolbar">
            <label class="toolbar-left">
                <select id="gamesPerPage">
                    ${[25, 50, 100, 250].map(n =>
                        `<option value="${n}" ${n === gamesState.parPage ? "selected" : ""}>${n}</option>`
                    ).join("")}
                </select>
                <span>jeux par page</span>
            </label>
            <div class="toolbar-right">
                <select id="gamesPlatform">${optionsPlateforme}</select>
                <input type="search" id="gamesSearch" class="games-search"
                       placeholder="Rechercher un jeu..." value="${escapeHtml(gamesState.filtre)}">
            </div>
        </div>

        <div class="games-scroll">
            <table class="games-table">
                <thead><tr>${entetes}</tr></thead>
                <tbody>${lignes || `<tr><td colspan="6" class="cell-muted">Aucun jeu trouvé.</td></tr>`}</tbody>
            </table>
        </div>

        <div class="games-pagination">
            <button id="gamesPrev" ${gamesState.page === 1 ? "disabled" : ""}>‹ Précédent</button>
            <span>Page ${gamesState.page} / ${pages} — ${liste.length} jeux</span>
            <button id="gamesNext" ${gamesState.page === pages ? "disabled" : ""}>Suivant ›</button>
        </div>
    `;

    brancherEvenements();
}

function brancherEvenements() {
    document.querySelectorAll(".th-sort").forEach(th => {
        th.addEventListener("click", () => {
            const col = th.dataset.col;
            if (gamesState.tri.colonne === col) {
                gamesState.tri.sens = gamesState.tri.sens === "asc" ? "desc" : "asc";
            } else {
                gamesState.tri.colonne = col;
                gamesState.tri.sens = col === "name" ? "asc" : "desc";
            }
            gamesState.page = 1;
            dessinerTableau();
        });
    });

    const recherche = document.getElementById("gamesSearch");
    if (recherche) {
        recherche.addEventListener("input", e => {
            gamesState.filtre = e.target.value;
            gamesState.page = 1;
            dessinerTableau();
            // Le tableau est redessiné : on rend le focus au champ
            const champ = document.getElementById("gamesSearch");
            champ.focus();
            champ.setSelectionRange(champ.value.length, champ.value.length);
        });
    }

    const parPage = document.getElementById("gamesPerPage");
    if (parPage) {
        parPage.addEventListener("change", e => {
            gamesState.parPage = parseInt(e.target.value, 10);
            gamesState.page = 1;
            dessinerTableau();
        });
    }

    const plateforme = document.getElementById("gamesPlatform");
    if (plateforme) {
        plateforme.addEventListener("change", e => {
            gamesState.plateforme = e.target.value;
            gamesState.page = 1;
            dessinerTableau();
        });
    }
    const prev = document.getElementById("gamesPrev");
    const next = document.getElementById("gamesNext");
    if (prev) prev.addEventListener("click", () => { gamesState.page--; dessinerTableau(); });
    if (next) next.addEventListener("click", () => { gamesState.page++; dessinerTableau(); });
}