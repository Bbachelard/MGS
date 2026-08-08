const gamesState = {
    games: [],
    totals: {},
    filtre: "",
    tri: { colonne: "hours", sens: "desc" },
    parPage: 100,
    page: 1,
};

const GAMES_COLONNES = [
    { cle: "image",       label: "",              triable: false, classe: "col-img" },
    { cle: "name",        label: "Nom",           triable: true,  type: "texte" },
    { cle: "hours",       label: "Temps total",   triable: true,  type: "nombre" },
    { cle: "recentHours", label: "2 semaines",    triable: true,  type: "nombre" },
    { cle: "lastPlayed",  label: "Dernière fois", triable: true,  type: "nombre" },
];

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
    const liste = q
        ? gamesState.games.filter(g => g.name.toLowerCase().includes(q))
        : [...gamesState.games];

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
            ? va.localeCompare(vb, "fr") * facteur
            : (va - vb) * facteur;
    });

    return liste;
}

function formaterHeures(valeur) {
    if (valeur === 0) return `<span class="cell-muted">–</span>`;
    return valeur.toLocaleString("fr-FR", { minimumFractionDigits: 1 }) + "h";
}

function formaterDate(timestamp) {
    if (!timestamp) return `<span class="cell-muted">Jamais</span>`;
    return new Date(timestamp * 1000).toLocaleDateString("fr-FR");
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

    const lignes = visibles.map(jeu => `
        <h2 class="games-title">${gamesState.lectureSeule ? "Sa bibliothèque" : "Ma bibliothèque"}</h2>
        <tr>
            <td class="col-img">
                <img src="${escapeHtml(jeu.image)}" alt="" loading="lazy"
                     onerror="this.style.visibility='hidden'">
            </td>
            <td class="col-name">
                <a href="${safeUrl(jeu.storeUrl)}" target="_blank" rel="noopener">${escapeHtml(jeu.name)}</a>
            </td>
            <td>${formaterHeures(jeu.hours)}</td>
            <td>${formaterHeures(jeu.recentHours)}</td>
            <td>${formaterDate(jeu.lastPlayed)}</td>
        </tr>
    `).join("");

    const t = gamesState.totals || {};

    zone.innerHTML = `
        <div class="games-head">
            <h2 class="games-title">Ma bibliothèque</h2>
        </div>

        <div class="games-totals">
            <div class="summary-box">
                <span class="summary-value">${t.count ?? 0}</span>
                <span class="summary-label">Jeux possédés</span>
            </div>
            <div class="summary-box">
                <span class="summary-value">${t.played ?? 0}</span>
                <span class="summary-label">Jeux lancés</span>
            </div>
            <div class="summary-box">
                <span class="summary-value">${(t.hours ?? 0).toLocaleString("fr-FR")}h</span>
                <span class="summary-label">Temps total</span>
            </div>
        </div>

        <div class="games-toolbar">
            <label class="toolbar-left">
                <select id="gamesPerPage">
                    ${[25, 50, 100, 250].map(n =>
                        `<option value="${n}" ${n === gamesState.parPage ? "selected" : ""}>${n}</option>`
                    ).join("")}
                </select>
                <span>jeux par page</span>
            </label>
            <input type="search" id="gamesSearch" class="games-search"
                   placeholder="Rechercher un jeu..." value="${escapeHtml(gamesState.filtre)}">
        </div>

        <div class="games-scroll">
            <table class="games-table">
                <thead><tr>${entetes}</tr></thead>
                <tbody>${lignes || `<tr><td colspan="5" class="cell-muted">Aucun jeu trouvé.</td></tr>`}</tbody>
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

    const prev = document.getElementById("gamesPrev");
    const next = document.getElementById("gamesNext");
    if (prev) prev.addEventListener("click", () => { gamesState.page--; dessinerTableau(); });
    if (next) next.addEventListener("click", () => { gamesState.page++; dessinerTableau(); });
}