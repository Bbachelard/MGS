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

/* Une couleur CSS -> {h,s,l}, que la source soit un #hex ou un hsl().
   Décliner une teinte demande de repartir de sa décomposition, et les
   nuances de jeu servent elles-mêmes de base aux nuances de compte. */
function hubHsl(couleur) {
    const m = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/.exec(String(couleur));

    return m
        ? { h: parseFloat(m[1]), s: parseFloat(m[2]), l: parseFloat(m[3]) }
        : hubHexHsl(couleur);
}

/* Même teinte, luminosité en RAMPE continue : le bloc reste
   reconnaissable d'un coup d'œil (tout Riot est rouge) et l'ordre des
   segments se lit dans le dégradé.

   Une alternance clair/sombre autour de la base donnerait des couleurs
   plus contrastées deux à deux, mais cinq jeux Steam ressembleraient
   alors à cinq plateformes différentes. La rampe dit l'inverse : même
   famille, rang décroissant.

   pas   = écart entre deux crans, plafonné pour que la rampe entière
           reste dans la teinte (jamais plus de 34 points de luminosité).
   sens  = +1 vers le clair, -1 vers le sombre, 0 pour laisser la
           fonction fuir le bord le plus proche. */
function hubNuance(base, rang = 0, total = 1, pas = 14, sens = 0) {
    if (total <= 1 || rang === 0) return base;

    const { h, s, l } = hubHsl(base);

    const amplitude = Math.min(34, pas * (total - 1));
    const direction = sens !== 0 ? sens : (l >= 52 ? -1 : 1);
    const lum       = l + direction * amplitude * (rang / (total - 1));

    return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(Math.min(86, Math.max(22, lum)))}%)`;
}

/* Le segment « Autres jeux » n'est pas un jeu : il est désaturé pour se
   lire comme un reliquat, sans quitter la teinte de sa plateforme. */
function hubNuanceReste(base) {
    const { h, s, l } = hubHsl(base);

    return `hsl(${Math.round(h)} ${Math.round(s * 0.35)}% ${Math.round(Math.min(70, l + 4))}%)`;
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

/* ------------------------------------------------------------
   Ventilation du temps d'un compte, jeu par jeu
   ------------------------------------------------------------
   Trois sources, dans cet ordre :

     metrics.virtualGames — Riot : LoL et Valorant, heures propres ;
     metrics.topGames     — Steam (les plus joués) et Epic (Fortnite) ;
     repli                — aucune ventilation : un seul « jeu », nommé
                            d'après topGame quand la plateforme n'en
                            connaît qu'un, sinon d'après la plateforme.

   La somme rendue vaut TOUJOURS metrics.totalHours : c'est elle qui
   fixe la largeur des segments, et le chiffre héros en dépend.
   Steam n'envoie que ses plus gros jeux -> le reliquat devient
   « Autres jeux ». À l'inverse, si les arrondis font dépasser la
   ventilation, on la ramène au total au prorata.
   ------------------------------------------------------------ */

function hubVentilation(resultat, m) {
    const total = Number(m.totalHours) || 0;
    if (total <= 0) return [];

    const source = (Array.isArray(m.virtualGames) && m.virtualGames.length)
        ? m.virtualGames
        : (Array.isArray(m.topGames) ? m.topGames : []);

    const jeux = source
        .filter(jeu => jeu && jeu.name && Number(jeu.hours) > 0)
        .map(jeu => ({
            name:   String(jeu.name),
            image:  jeu.image || "",
            hours:  Number(jeu.hours) || 0,
            estime: !!jeu.estimated || !!m.hoursEstimated,
            reste:  false,
        }));

    if (!jeux.length) {
        // Une plateforme qui ne déclare qu'un jeu mérite son nom dans la
        // légende ; au-delà, « Steam » est plus honnête qu'un nom de jeu
        // qui ne couvrirait qu'une part du total.
        const seul = m.topGame && m.topGame.name && (Number(m.games) || 0) <= 1;

        return [{
            name:   seul ? String(m.topGame.name) : resultat.platform.label,
            image:  (m.topGame && m.topGame.image) || "",
            hours:  total,
            estime: !!m.hoursEstimated,
            reste:  false,
        }];
    }

    const couvert = jeux.reduce((somme, jeu) => somme + jeu.hours, 0);

    if (couvert > total) {
        const facteur = total / couvert;
        jeux.forEach(jeu => { jeu.hours *= facteur; });
    } else if (total - couvert > 0.5) {
        jeux.push({
            name:   "Autres jeux",
            image:  "",
            hours:  total - couvert,
            estime: !!m.hoursEstimated,
            reste:  true,
        });
    }

    return jeux;
}

/* ------------------------------------------------------------
   Agrégation — un arbre plateforme > jeu > compte
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
        parts:         [],   // un segment PAR JEU, à plat, pour la barre
        inconnues:     [],   // plateformes sans estimation d'heures
        topGame:       null,
        ranks:         [],
        recentTop:     [],
        heuresPayantes: 0,
    };

    /* Les heures sont cumulées à trois niveaux d'un coup :
       plateforme (le bloc de couleur), jeu (le segment), compte (le
       détail révélé au survol). La barre lit le niveau « jeu » ; les
       deux autres servent au regroupement et aux nuances. */
    const plateformes = new Map();
    const inconnues   = new Set();
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

        const ventilation = hubVentilation(r, m);

        if (ventilation.length) {
            const plateforme = plateformes.get(r.platform.slug) || {
                slug:  r.platform.slug,
                label: r.platform.label,
                hours: 0,
                jeux:  new Map(),
            };

            const cleCompte = r.account
                ? String(r.account.id ?? r.account.accountId ?? r.account.displayName)
                : '-';
            const nomCompte = (r.account && r.account.displayName) || null;

            ventilation.forEach(v => {
                // Deux comptes Riot qui jouent au même jeu alimentent le
                // MÊME segment : c'est ce que le survol vient détailler.
                const jeu = plateforme.jeux.get(v.name) || {
                    name:    v.name,
                    image:   v.image,
                    reste:   v.reste,
                    hours:   0,
                    estime:  false,
                    comptes: new Map(),
                };

                jeu.hours  += v.hours;
                jeu.estime = jeu.estime || v.estime;
                if (!jeu.image && v.image) jeu.image = v.image;

                const compte = jeu.comptes.get(cleCompte)
                    || { nom: nomCompte, hours: 0, estime: false };

                compte.hours  += v.hours;
                compte.estime = compte.estime || v.estime;

                jeu.comptes.set(cleCompte, compte);
                plateforme.jeux.set(v.name, jeu);
            });

            plateforme.hours += ventilation.reduce((s, v) => s + v.hours, 0);
            plateformes.set(r.platform.slug, plateforme);
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

    /* --- Mise à plat de l'arbre en segments de barre ------------------
       Les jeux d'une même plateforme doivent être COLLÉS, sinon les
       nuances de rouge se retrouvent séparées par du bleu. On trie donc
       d'abord les plateformes, puis les jeux à l'intérieur de chacune. */

    agg.parts = [];

    Array.from(plateformes.values())
        .sort((a, b) => b.hours - a.hours)
        .forEach(plateforme => {
            const base = hubCouleur(plateforme.slug);

            const jeux = Array.from(plateforme.jeux.values()).sort((a, b) =>
                // « Autres jeux » ferme toujours la marche, quel que soit
                // son poids : ce n'est pas un jeu, c'est ce qui reste.
                (a.reste - b.reste) || (b.hours - a.hours)
            );

            jeux.forEach((jeu, rang) => {
                const couleur = jeu.reste
                    ? hubNuanceReste(base)
                    : hubNuance(base, rang, jeux.length);

                // Les comptes vont TOUJOURS vers le clair : au survol,
                // le segment actif est la seule zone non estompée de la
                // barre, autant que sa subdivision aille vers la lumière.
                const comptes = Array.from(jeu.comptes.values())
                    .sort((a, b) => b.hours - a.hours)
                    .map((compte, i, tous) => Object.assign({}, compte, {
                        couleur: hubNuance(couleur, i, tous.length, 11, 1),
                    }));

                agg.parts.push({
                    slug:      plateforme.slug,
                    label:     plateforme.label,
                    plateformeHours: plateforme.hours,
                    jeu:       jeu.name,
                    reste:     jeu.reste,
                    hours:     jeu.hours,
                    estime:    jeu.estime,
                    couleur:   couleur,
                    comptes:   comptes,
                    premier:   rang === 0,
                });

                agg.totalHours += jeu.hours;
            });
        });

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

    /* Un segment par JEU. Chaque segment porte déjà, sous une façade
       unie, sa ventilation par compte : le survol se contente de faire
       disparaître la façade, sans rien recalculer ni redessiner. */
    const segments = agg.parts.map((p, i) => {
        const pct = agg.totalHours > 0 ? (p.hours / agg.totalHours) * 100 : 0;

        const sous = p.comptes.map(c => `
            <i style="flex:${Math.max(c.hours, 0.0001).toFixed(4)} 1 0;background:${c.couleur}"
               title="${escapeHtml(c.nom || p.label)} : ${c.estime ? "≈ " : ""}${hubNombre(c.hours)} h"></i>
        `).join("");

        const classes = [
            "hero-seg",
            p.comptes.length > 1 ? "hero-seg--multi" : "",
            // Hachure légère plutôt que façade translucide : une façade
            // à demi transparente laisserait voir la ventilation par
            // compte en permanence, y compris sur un segment estompé.
            p.estime ? "hero-seg--estime" : "",
        ].filter(Boolean).join(" ");

        return `
            <span class="${classes}"
                  data-seg="${i}"
                  title="${escapeHtml(p.jeu)} · ${escapeHtml(p.label)} : ${p.estime ? "≈ " : ""}${hubNombre(p.hours)} h"
                  style="width:${pct.toFixed(2)}%">
                <span class="hero-seg-parts">${sous}</span>
                <span class="hero-seg-face" style="background:${p.couleur}"></span>
            </span>
        `;
    }).join("");

    /* Légende de repos : une entrée par jeu, la plateforme en second
       plan. Le nom de la plateforme n'est rappelé que sur son premier
       jeu — le répéter cinq fois pour Steam n'apprend rien. */
    const legende = agg.parts.map((p, i) => {
        // Une plateforme sans ventilation nomme son segment d'après
        // elle-même : rappeler « Steam » juste après « Steam » n'apprend
        // rien, on saute le rappel.
        const rappel = p.premier && p.jeu !== p.label
            ? `<em>${escapeHtml(p.label)}</em>`
            : "";

        return `
            <span class="hero-leg${p.comptes.length > 1 ? " hero-leg--multi" : ""}" data-leg="${i}">
                <i style="background:${p.couleur}"></i><b>${escapeHtml(p.jeu)}</b>
                ${rappel}
                ${p.estime ? "≈ " : ""}${hubNombre(p.hours)} h
            </span>
        `;
    }).join("");

    /* Légende de survol : les comptes du jeu pointé. Pré-rendue et
       masquée, pour que le passage de la souris ne coûte qu'un attribut.
       Elle existe même pour un jeu à un seul compte : le survol répond
       alors la même chose partout, au lieu de ne rien faire ici et
       quelque chose là. */
    const detail = agg.parts.map((p, i) => {
        const lignes = p.comptes.map(c => `
            <span class="hero-leg">
                <i style="background:${c.couleur}"></i><b>${escapeHtml(c.nom || "Compte")}</b>
                ${c.estime ? "≈ " : ""}${hubNombre(c.hours)} h
            </span>
        `).join("");

        return `<div class="hero-legend hero-legend--detail" data-detail="${i}" hidden>
                    <span class="hero-leg hero-leg--titre">${escapeHtml(p.jeu)}</span>${lignes}
                </div>`;
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

                <div class="hero-bar" data-hero-bar>${segments}</div>

                <div class="hero-legend" data-legend-base>${legende}${inconnues}</div>
                <div class="hero-detail-slot">${detail}</div>
            </div>
            ${cote}
        </section>
    `;
}

/* Survol de la barre. Appelée avant insertion dans le document :
   bloc est déjà un vrai élément, querySelector fonctionne.

   Deux entrées pour un même segment — la barre et la légende — et un
   seul état : data-actif sur .hero-main, is-actif sur le segment et
   sa ligne de légende. Le CSS fait le reste (façade effacée, voisins
   estompés) ; le JS ne pose que des classes. */
function hubBrancherHero(bloc) {
    const main  = bloc.querySelector(".hero-main");
    const barre = bloc.querySelector("[data-hero-bar]");
    if (!main || !barre) return;

    const details   = Array.from(main.querySelectorAll("[data-detail]"));
    const marqueurs = Array.from(main.querySelectorAll("[data-seg],[data-leg]"));

    let actif = null;

    function activer(index) {
        if (actif === index) return;
        actif = index;

        if (index === null) {
            main.removeAttribute("data-actif");
        } else {
            main.setAttribute("data-actif", String(index));
        }

        const cle = index === null ? null : String(index);

        marqueurs.forEach(el => {
            el.classList.toggle("is-actif", cle !== null && (el.dataset.seg ?? el.dataset.leg) === cle);
        });

        const cible = cle === null
            ? null
            : details.find(d => d.dataset.detail === cle) || null;

        details.forEach(d => { d.hidden = d !== cible; });
    }

    function indexDepuis(evenement) {
        const cible = evenement.target.closest
            ? evenement.target.closest("[data-seg],[data-leg]")
            : null;

        if (!cible || !main.contains(cible)) return null;

        const brut = cible.dataset.seg ?? cible.dataset.leg;
        return brut === undefined ? null : Number(brut);
    }

    main.addEventListener("mouseover", e => activer(indexDepuis(e)));
    main.addEventListener("mouseleave", () => activer(null));

    // Sans souris, un appui sur un segment ouvre le détail ; un second
    // appui le referme. Rien ne dépend du survol pour être atteignable.
    main.addEventListener("click", e => {
        const index = indexDepuis(e);
        if (index !== null) activer(actif === index ? null : index);
    });
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
    hubBrancherHero(bloc);

    return bloc;
}