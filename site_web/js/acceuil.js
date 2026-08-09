document.addEventListener("DOMContentLoaded", () => {
    const platformSelect = document.getElementById("platformSelect");
    const platformToggle = document.getElementById("platformToggle");
    const platformValue = document.getElementById("platformValue");
    const platformMenu = document.getElementById("platformMenu");
    const statsForm = document.getElementById("statsForm");
    const pseudoField = document.getElementById("pseudoField");
    const resultBox = document.getElementById("stats-result");

    // Plateforme sélectionnée par défaut
    let selectedPlatform = "Steam";

    // Ouvre / ferme le menu au clic sur le bouton
    platformToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        platformSelect.classList.toggle("open");
    });

    // Sélection d'une option
    platformMenu.querySelectorAll("li").forEach((item) => {
        item.addEventListener("click", () => {
            const choix = item.getAttribute("data-value");
            selectedPlatform = choix;
            platformValue.innerHTML = choix + ' <span class="arrow">▾</span>';
            platformSelect.classList.remove("open");
        });
    });

    // Ferme le menu si on clique ailleurs sur la page
    document.addEventListener("click", () => {
        platformSelect.classList.remove("open");
    });

    // Soumission du formulaire : on appelle notre backend PHP, jamais Steam directement
    statsForm.addEventListener("submit", async (e) => {
        e.preventDefault(); // empêche le rechargement de la page (comportement par défaut d'un <form>)

        const pseudo = pseudoField.value.trim();

        if (!pseudo) {
            resultBox.innerHTML = `<p class="stats-error">Merci de saisir un pseudo.</p>`;
            return;
        }

        resultBox.innerHTML = `<p class="stats-loading">Recherche en cours...</p>`;

        try {
            const url = `../php/api.php?platform=${encodeURIComponent(selectedPlatform)}&pseudo=${encodeURIComponent(pseudo)}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.error) {
                resultBox.innerHTML = `<p class="stats-error">${data.error}</p>`;
                return;
            }

            // Carte enrichie : rendu de base + aperçu bibliothèque
            afficherResultatAccueil(data, resultBox, selectedPlatform, pseudo);
        } catch (err) {
            console.error("Erreur lors de la récupération des stats :", err);
            resultBox.innerHTML = `<p class="stats-error">Une erreur est survenue, réessaie plus tard.</p>`;
        }
    });
});

/* ================= Rendu enrichi (accueil) =================
   Reprend la carte "CV" existante (construireCarte, dans stats-display.js)
   et lui ajoute un aperçu compact de la bibliothèque de jeux : totaux
   (jeux lancés / temps total) + top 5 jeux les plus joués, avec vignette.

   Passe par games-public.php (miroir public de games.php) car api.php ne
   renvoie pas d'accountId exploitable côté client, et games.php n'accepte
   pas d'accountId venant de l'URL (résolution en base uniquement).

   Ne vit que dans acceuil.js, chargé uniquement sur la page d'accueil :
   aucun impact sur le profil connecté (index.php).
============================================================= */

async function afficherResultatAccueil(data, resultBox, platform, pseudo) {
    resultBox.innerHTML = "";

    const card = construireCarte(data);
    resultBox.appendChild(card);

    const loader = document.createElement("p");
    loader.className = "stats-loading";
    loader.textContent = "Chargement de la bibliothèque...";
    card.appendChild(loader);

    const apercu = await construireApercuBibliotheque(platform, pseudo);
    loader.remove();

    if (apercu) {
        card.appendChild(apercu);
    }

    resultBox.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function construireApercuBibliotheque(platform, pseudo) {
    try {
        const url = `../php/games-public.php?platform=${encodeURIComponent(platform)}&pseudo=${encodeURIComponent(pseudo)}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.error || !Array.isArray(data.games)) {
            return null;
        }

        const totaux = data.totals || {};
        const top = [...data.games]
            .filter((jeu) => (jeu.hours || 0) > 0)
            .sort((a, b) => (b.hours || 0) - (a.hours || 0))
            .slice(0, 5);

        // Bloc distinct, visuellement séparé du reste de la carte
        // (bordure + marge en haut), pour ne pas se confondre avec les
        // infos déjà présentes plus haut (ex: "Jeux possédés" du profil).
        const wrapper = document.createElement("div");
        wrapper.className = "library-preview";
        wrapper.style.marginTop = "20px";
        wrapper.style.paddingTop = "16px";
        wrapper.style.borderTop = "1px solid #3a3a44";
        wrapper.style.width = "100%";

        wrapper.innerHTML = `
            <span class="info-label" style="display:block;text-align:left;margin-bottom:10px;">Bibliothèque</span>
            <div class="info-grid" style="grid-template-columns: repeat(2, 1fr);">
                <div class="info-box">
                    <span class="info-label">Jeux lancés</span>
                    <span class="info-value">${escapeHtml(totaux.played ?? "-")}</span>
                </div>
                <div class="info-box">
                    <span class="info-label">Temps total</span>
                    <span class="info-value">${escapeHtml(formaterHeuresAccueil(totaux.hours ?? 0))}</span>
                </div>
            </div>
            ${top.length ? `
                <div class="recent-games-box" style="margin-top:12px;">
                    <span class="info-label">Jeux les plus joués</span>
                    <ul class="recent-games-list">
                        ${top.map((jeu) => construireLigneJeu(jeu)).join("")}
                    </ul>
                </div>
            ` : ""}
        `;

        return wrapper;
    } catch (err) {
        console.error("Erreur lors du chargement de la bibliothèque (accueil) :", err);
        return null;
    }
}

/** Ligne d'un jeu avec vignette, nom et temps de jeu. */
function construireLigneJeu(jeu) {
    const image = safeUrl(jeu.image);

    return `
        <li style="display:flex;align-items:center;gap:10px;">
            ${image ? `
                <img src="${image}" alt="" loading="lazy"
                     style="width:36px;height:36px;border-radius:6px;object-fit:cover;flex-shrink:0;"
                     onerror="this.style.display='none'">
            ` : ""}
            <span style="flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(jeu.name)}</span>
            <span style="flex-shrink:0;">${escapeHtml(formaterHeuresAccueil(jeu.hours))}</span>
        </li>
    `;
}

function formaterHeuresAccueil(valeur) {
    const nombre = Number(valeur) || 0;
    return nombre.toLocaleString("fr-FR", { minimumFractionDigits: 1 }) + "h";
}