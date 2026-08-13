document.addEventListener("DOMContentLoaded", () => {

    /* =====================================================
       LOGO : ANIMATION + SON ALÉATOIRE
    ===================================================== */

    const logoImg = document.querySelector(".titre img");

    const logoSounds = [
        "/content/sound/logo-click1.mp3",
        "/content/sound/logo-click2.mp3",
        "/content/sound/logo-click3.mp3",
        "/content/sound/logo-click4.mp3"
    ];

    let lastSoundIndex = -1;

    if (logoImg) {

        logoImg.addEventListener("click", () => {

            // Choisit un son aléatoire différent du précédent
            let randomIndex;

            do {
                randomIndex = Math.floor(Math.random() * logoSounds.length);
            } while (
                logoSounds.length > 1 &&
                randomIndex === lastSoundIndex
            );

            lastSoundIndex = randomIndex;

            // Crée un nouvel Audio à chaque clic
            // Les sons peuvent donc se chevaucher si on spam le logo
            const audio = new Audio(logoSounds[randomIndex]);

            audio.volume = 0.6;

            audio.play().catch((error) => {
                console.error(
                    "Impossible de lire le son du logo :",
                    error
                );
            });


            // Animation du logo
            logoImg.classList.remove("is-pressed");

            // Force le navigateur à recalculer l'animation
            // pour pouvoir la rejouer même avec des clics rapides
            void logoImg.offsetWidth;

            logoImg.classList.add("is-pressed");
        });


        logoImg.addEventListener("animationend", () => {
            logoImg.classList.remove("is-pressed");
        });
    }


    /* =====================================================
       FORMULAIRE DE RECHERCHE
    ===================================================== */

    const platformSelect = document.getElementById("platformSelect");
    const platformToggle = document.getElementById("platformToggle");
    const platformValue = document.getElementById("platformValue");
    const platformMenu = document.getElementById("platformMenu");
    const statsForm = document.getElementById("statsForm");
    const pseudoField = document.getElementById("pseudoField");
    const resultBox = document.getElementById("stats-result");


    // Vérifie que tous les éléments nécessaires existent
    if (
        !platformSelect ||
        !platformToggle ||
        !platformValue ||
        !platformMenu ||
        !statsForm ||
        !pseudoField ||
        !resultBox
    ) {
        console.error(
            "Impossible d'initialiser la recherche : certains éléments HTML sont manquants."
        );

        return;
    }


    // Plateforme sélectionnée par défaut
    let selectedPlatform = "Steam";
    // accountId issu d'une suggestion. Non nul = on saute la résolution
    // par pseudo côté serveur (indispensable pour Epic et Riot sans tag).
    let selectedAccountId = null;

    const suggest = window.initPseudoSuggest({
        input: pseudoField,
        getPlatform: () => selectedPlatform,
        onSelect: (item) => { selectedAccountId = item.accountId; },
        onClear:  ()     => { selectedAccountId = null; }
    });


    // Ouvre / ferme le menu au clic
    platformToggle.addEventListener("click", (e) => {

        e.stopPropagation();

        platformSelect.classList.toggle("open");
    });


    // Sélection d'une plateforme
    platformMenu.querySelectorAll("li").forEach((item) => {

        item.addEventListener("click", (e) => {

            e.stopPropagation();

            const choix = item.getAttribute("data-value");

            if (!choix) {
                return;
            }

            selectedPlatform = choix;
            selectedAccountId = null;    
            if (suggest) suggest.fermer();

            platformValue.innerHTML =
                `${choix} <span class="arrow">▾</span>`;

            platformSelect.classList.remove("open");
        });
    });


    // Ferme le menu si on clique ailleurs sur la page
    document.addEventListener("click", () => {

        platformSelect.classList.remove("open");
    });


    /* =====================================================
       SOUMISSION DU FORMULAIRE
    ===================================================== */

    statsForm.addEventListener("submit", async (e) => {

        e.preventDefault();

        const pseudo = pseudoField.value.trim();


        if (!pseudo) {

            resultBox.innerHTML =
                `<p class="stats-error">Merci de saisir un pseudo.</p>`;

            return;
        }


        resultBox.innerHTML =
            `<p class="stats-loading">Recherche en cours...</p>`;


        try {
            const params = new URLSearchParams({ platform: selectedPlatform });

            if (selectedAccountId) {
                params.set("accountId", selectedAccountId);
            } else {
                params.set("pseudo", pseudo);
            }

            const url = `/php/api.php?${params.toString()}`;

            const response = await fetch(url);


            if (!response.ok) {

                throw new Error(
                    `Erreur HTTP ${response.status} sur api.php`
                );
            }


            const data = await response.json();


            if (data.error) {

                resultBox.innerHTML =
                    `<p class="stats-error">${data.error}</p>`;

                return;
            }


            // Carte enrichie :
            // rendu de base + aperçu de la bibliothèque
            await afficherResultatAccueil(
                data,
                resultBox,
                selectedPlatform,
                pseudo,
                selectedAccountId 
            );


        } catch (err) {

            console.error(
                "Erreur lors de la récupération des stats :",
                err
            );


            resultBox.innerHTML =
                `<p class="stats-error">Une erreur est survenue, réessaie plus tard.</p>`;
        }
    });

});


/* =========================================================
   RENDU ENRICHI DE L'ACCUEIL

   Reprend la carte "CV" existante via construireCarte()
   défini dans stats-display.js.

   Ajoute ensuite :
   - nombre de jeux lancés
   - temps total
   - top 5 des jeux les plus joués
   - vignette
   - lien vers le store

   Les données passent par games-public.php.
========================================================= */

async function afficherResultatAccueil(data, resultBox, platform, pseudo, accountId) {

    resultBox.innerHTML = "";
    

    // Carte principale créée dans stats-display.js
    const card = construireCarte(data);

    resultBox.appendChild(card);


    // Volontairement non bloquant : si l'endpoint tombe, la carte
    // reste affichée sans ce bloc.
    construireBlocMgs(data.platform, data.accountId)
        .then(bloc => { if (bloc) card.appendChild(bloc); });
    // ------------------------------------------------------------



    // Loader pendant le chargement de la bibliothèque
    const loader = document.createElement("p");

    loader.className = "stats-loading";

    loader.textContent =
        "Chargement de la bibliothèque...";

    card.appendChild(loader);


    // Chargement aperçu bibliothèque
    const apercu = await construireApercuBibliotheque(platform, pseudo, accountId);

    loader.remove();


    // Ajoute l'aperçu seulement s'il existe
    if (apercu) {

        card.appendChild(apercu);
    }


    // Scroll doux vers le résultat
    resultBox.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });
}


/* =========================================================
   CONSTRUCTION APERÇU BIBLIOTHÈQUE
========================================================= */

async function construireApercuBibliotheque(
    platform,
    pseudo,
    accountId
) {

    try {

        const params = new URLSearchParams({ platform: platform });

        if (accountId) {
            params.set("accountId", accountId);
        } else {
            params.set("pseudo", pseudo);
        }

        const url = `/php/games-public.php?${params.toString()}`;
        
        const response = await fetch(url);

        // Riot n'expose pas de bibliothèque de jeux : inutile d'appeler l'endpoint.
        if (String(platform).toLowerCase() === "riot") {
            return null;
        }

        if (!response.ok) {

            throw new Error(
                `Erreur HTTP ${response.status} sur games-public.php`
            );
        }


        const data = await response.json();


        if (
            data.error ||
            !Array.isArray(data.games)
        ) {

            return null;
        }


        const totaux = data.totals || {};


        // Copie du tableau avant tri pour ne pas modifier data.games
        const top = [...data.games]

            // Ignore les jeux jamais lancés
            .filter((jeu) =>
                (jeu.hours || 0) > 0
            )

            // Du plus joué au moins joué
            .sort((a, b) =>
                (b.hours || 0) -
                (a.hours || 0)
            )

            // Top 5
            .slice(0, 5);


        const wrapper =
            document.createElement("div");


        wrapper.className =
            "library-preview";


        wrapper.innerHTML = `
            <span class="info-label lib-title">
                Bibliothèque
            </span>

            <div class="info-grid">

                <div class="info-box">
                    <span class="info-label">
                        Jeux lancés
                    </span>

                    <span class="info-value">
                        ${escapeHtml(totaux.played ?? "-")}
                    </span>
                </div>

                <div class="info-box">
                    <span class="info-label">
                        Temps total
                    </span>

                    <span class="info-value">
                        ${escapeHtml(
                            formaterHeuresAccueil(totaux.hours ?? 0)
                        )}
                    </span>
                </div>

            </div>

            ${
                top.length
                    ? `
                        <div class="recent-games-box library-games-box">

                            <span class="info-label">
                                Jeux les plus joués
                            </span>

                            <ul class="library-games-list">
                                ${
                                    top
                                        .map((jeu) => construireLigneJeu(jeu))
                                        .join("")
                                }
                            </ul>

                        </div>
                    `
                    : ""
            }
        `;


        return wrapper;


    } catch (err) {

        console.error(
            "Erreur lors du chargement de la bibliothèque (accueil) :",
            err
        );


        return null;
    }
}


/* =========================================================
   CONSTRUCTION D'UNE LIGNE DE JEU
========================================================= */

function construireLigneJeu(jeu) {

    const image =
        safeUrl(jeu.image);

    const store =
        safeUrl(jeu.storeUrl);


    // Vignette
    const vignette = image

        ? `
            <img
                class="library-game-thumb"
                src="${image}"
                alt=""
                loading="lazy"
                onerror="this.style.visibility='hidden'"
            >
        `

        : `
            <div class="library-game-thumb"></div>
        `;


    // Nom du jeu avec lien store si disponible
    const nom = store

        ? `
            <a
                class="library-game-name"
                href="${store}"
                target="_blank"
                rel="noopener"
            >
                ${escapeHtml(jeu.name)}
            </a>
        `

        : `
            <span class="library-game-name">
                ${escapeHtml(jeu.name)}
            </span>
        `;


    return `

        <li class="library-game-row">

            ${vignette}

            ${nom}

            <span class="library-game-hours">

                ${
                    escapeHtml(
                        formaterHeuresAccueil(
                            jeu.hours
                        )
                    )
                }

            </span>

        </li>
    `;
}


/* =========================================================
   FORMATAGE DU TEMPS DE JEU
========================================================= */

function formaterHeuresAccueil(valeur) {

    const nombre =
        Number(valeur) || 0;


    return nombre.toLocaleString(
        "fr-FR",
        {
            minimumFractionDigits: 1
        }
    ) + "h";
}

/* =========================================================
   BLOC "MEMBRE MGS"

   Si le compte de plateforme affiché est rattaché à un profil
   du site, on propose l'action adaptée à la relation :

     guest             -> "connecte-toi pour voir"
     self              -> mon profil
     friend            -> son profil
     pending_sent      -> demande déjà envoyée (pas de bouton)
     pending_received  -> il t'a déjà demandé -> inbox
     none              -> ajouter en ami
========================================================= */

async function construireBlocMgs(platform, accountId) {

    if (!platform || !accountId) {
        return null;
    }

    let info;

    try {

        const params = new URLSearchParams({
            platform:  platform,
            accountId: accountId
        });

        const response = await fetch(
            `/php/account-owner.php?${params.toString()}`
        );

        if (!response.ok) {
            return null;
        }

        info = await response.json();

    } catch (err) {

        // Un compte non rattaché est le cas normal : pas de bruit console.
        return null;
    }


    if (!info || info.isMember !== true) {
        return null;
    }


    const pseudo   = String(info.username || "");
    const relation = String(info.relation || "none");
    const url      = String(info.url || "");


    // Libellés par relation. Une seule table : pas de if en cascade
    // à rallonger le jour où un état s'ajoute.
    const LIBELLES = {
        guest: {
            note:   "Connecte-toi pour voir son profil.",
            bouton: "Se connecter"
        },
        self: {
            note:   "C'est ton compte.",
            bouton: "Mon profil"
        },
        friend: {
            note:   "Vous êtes amis.",
            bouton: "Voir son profil"
        },
        pending_sent: {
            note:   "Demande d'ami déjà envoyée.",
            bouton: null
        },
        pending_received: {
            note:   "Il t'a envoyé une demande d'ami.",
            bouton: "Répondre"
        },
        none: {
            note:   "Ajoute-le pour voir son profil.",
            bouton: "Ajouter en ami"
        }
    };

    const libelle = LIBELLES[relation] || LIBELLES.none;


    const bloc = document.createElement("div");

    bloc.className = "mgs-owner"
                   + (relation === "guest" ? " mgs-owner--guest" : "");


    // L'initiale sert d'avatar : même parti pris que .friend-avatar
    // dans inbox.php, on n'a pas d'image de profil MGS.
    const initiale = pseudo ? pseudo.charAt(0) : "?";

    const bouton = (libelle.bouton && url)
        ? `<div class="mgs-owner-action">
               <a class="link-btn link-btn--sm" href="${escapeHtml(url)}">
                   ${escapeHtml(libelle.bouton)}
               </a>
           </div>`
        : "";

    bloc.innerHTML = `
        <div class="mgs-owner-avatar">${escapeHtml(initiale)}</div>

        <div class="mgs-owner-body">
            <span class="mgs-owner-label">Membre MGS</span>
            <span class="mgs-owner-name">${escapeHtml(pseudo)}</span>
            <span class="mgs-owner-note">${escapeHtml(libelle.note)}</span>
        </div>

        ${bouton}
    `;

    return bloc;
}