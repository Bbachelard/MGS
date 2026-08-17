/* ============================================================
   MGS — socle partagé du front

   À charger EN PREMIER sur toutes les pages.

   Ce fichier rassemble ce que les autres scripts réécrivaient
   chacun de leur côté :

     échappement HTML  -> escapeHtml() dans stats-display.js
                          verifyEscape() dans link-verify.js
                          esc()          dans match-detail.js
                          echapper()     dans pseudo-suggest.js
                          (4 implémentations, dont 2 oubliaient
                           l'apostrophe)

     registre plateformes -> PLATFORM_ICONS  dans stats-display.js
                             GAMES_PLATEFORMES dans games-table.js
                             HUB_COULEURS    dans hub-resume.js
                             (3 miroirs de mgs_platforms() à tenir
                              synchronisés à la main)

     formatage         -> la primitive commune (toLocaleString fr-FR)
                          était réécrite dans games-table.js, acceuil.js
                          et hub-resume.js

   Les anciens noms restent exposés en alias : aucun appelant n'a
   eu besoin d'être réécrit.
   ============================================================ */

(function (window) {
    "use strict";

    /* ========================================================
       Échappement
    ======================================================== */

    /** Neutralise le HTML d'une valeur destinée à innerHTML. */
    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    /**
     * N'autorise que http(s) : bloque « javascript: » dans un href ou
     * un src. Une carte de stats affiche des URL venues d'API tierces,
     * on ne les recopie pas telles quelles.
     */
    function safeUrl(url) {
        var value = String(url == null ? "" : url).trim();
        return /^https?:\/\//i.test(value) ? value : "";
    }

    /* ========================================================
       Registre des plateformes — miroir de mgs_platforms()

       Une seule table ici, au lieu de trois dans trois fichiers.
       Quand une plateforme est ajoutée côté PHP, c'est le seul
       endroit à compléter côté client.
    ======================================================== */

    var PLATFORMS = {
        steam: {
            label: "Steam",
            icon:  "/content/image/Steam_icon.webp",
            color: "#66c0f4"
        },
        riot: {
            label: "Riot Games",
            icon:  "/content/image/riot-icon.png",
            color: "#e84057"
        },
        epic: {
            label: "Epic Games",
            icon:  "/content/image/Epic_icon.webp",
            color: "#7c5cff"
        }
    };

    /** Couleur d'accent de la plateforme (violet du site par défaut). */
    function platformColor(slug) {
        var p = PLATFORMS[String(slug || "").toLowerCase()];
        return p ? p.color : "#7c5cff";
    }

    /** Chemin de l'icône, chaîne vide si la plateforme est inconnue. */
    function platformIcon(slug) {
        var p = PLATFORMS[String(slug || "").toLowerCase()];
        return p ? p.icon : "";
    }

    /** Libellé lisible, avec repli sur le slug tel quel. */
    function platformLabel(slug, defaut) {
        var p = PLATFORMS[String(slug || "").toLowerCase()];
        return p ? p.label : (defaut || slug || "");
    }

    /* ========================================================
       Formatage
    ======================================================== */

    /**
     * Nombre à la française : espace fine pour les milliers, virgule
     * décimale. Trois variantes de cette fonction cohabitaient, avec
     * des séparateurs différents d'un bloc à l'autre de la même page.
     */
    function formaterNombre(valeur, decimales, maxDecimales) {
        var n = Number(valeur);

        if (!isFinite(n)) {
            return "-";
        }

        var min = decimales || 0;

        return n.toLocaleString("fr-FR", {
            minimumFractionDigits: min,
            // Par défaut on fige le nombre de décimales. maxDecimales
            // permet de retrouver le comportement natif de
            // toLocaleString (max = 3) là où l'affichage l'attendait.
            maximumFractionDigits: maxDecimales === undefined ? min : maxDecimales
        });
    }

    /* Les formateurs de plus haut niveau (heures, dates, initiales,
       arrondi large) restent dans leurs fichiers : ils diffèrent
       réellement d'un écran à l'autre — games-table.js rend une cellule
       HTML pour un zéro, hub-resume.js arrondit par paliers de 50/100/500.
       Les uniformiser changerait l'affichage, ce qui n'est pas le but
       d'un nettoyage. Ils délèguent tous à formaterNombre() ci-dessus. */

    /* ========================================================
       Bloc dépliable

       Une seule mécanique pour les stats détaillées et pour la
       bibliothèque : sans ça les deux écrans auraient chacun leur
       accordéon, et les deux auraient divergé sur l'accessibilité.
    ======================================================== */

    var foldSeq = 0;

    /* Doit rester >= à la transition de .fold-wrap dans
       modules/detail-fold.css. */
    var FOLD_DUREE = 240;

    /**
     * Fabrique une section repliable.
     *
     * La ligne repliée est un <button> : c'est ce qui donne
     * gratuitement le focus clavier, Entrée/Espace et l'annonce
     * « développé / réduit » aux lecteurs d'écran. Un <div> avec un
     * onclick n'aurait rien de tout ça.
     *
     * @param options.head    HTML de la ligne repliée (sans le chevron)
     * @param options.classe  classes additionnelles sur la section
     * @param options.dataset paires posées en data-* sur la section
     * @param options.ouvert  true pour arriver déplié
     * @returns {{el: HTMLElement, body: HTMLElement, ouvrir: Function}}
     */
    function creerFold(options) {
        var opts = options || {};
        var id   = "mgs-fold-" + (++foldSeq);

        var section = document.createElement("section");
        section.className = "detail-fold" + (opts.classe ? " " + opts.classe : "");

        Object.keys(opts.dataset || {}).forEach(function (cle) {
            var valeur = opts.dataset[cle];
            if (valeur !== null && valeur !== undefined) {
                section.dataset[cle] = valeur;
            }
        });

        var tete = document.createElement("button");
        tete.type = "button";
        tete.className = "fold-head";
        tete.setAttribute("aria-expanded", "false");
        tete.setAttribute("aria-controls", id);
        tete.innerHTML = (opts.head || "")
            + '<span class="fold-chevron" aria-hidden="true"></span>';

        var enveloppe = document.createElement("div");
        enveloppe.className = "fold-wrap";
        enveloppe.id = id;
        enveloppe.setAttribute("role", "region");

        var corps = document.createElement("div");
        corps.className = "fold-body";
        enveloppe.appendChild(corps);

        section.appendChild(tete);
        section.appendChild(enveloppe);

        var minuteur = null;

        /**
         * `hidden` en plus de la hauteur nulle : sans lui, le contenu
         * replié resterait tabulable et lisible par un lecteur d'écran
         * — une liste de parties invisible capterait le focus.
         *
         * Mais le poser dès le clic couperait la fermeture net : il
         * n'arrive donc qu'une fois l'animation finie. À l'inverse, à
         * l'ouverture il faut le retirer AVANT d'ajouter la classe,
         * sinon les deux tombent dans le même frame et le bloc
         * apparaît d'un coup.
         *
         * @param etat      true ouvre, false ferme, rien bascule
         * @param immediat  saute l'animation (état initial)
         */
        function ouvrir(etat, immediat) {
            var actif = etat === undefined
                ? !section.classList.contains("is-open")
                : !!etat;

            clearTimeout(minuteur);
            tete.setAttribute("aria-expanded", actif ? "true" : "false");

            if (actif) {
                enveloppe.hidden = false;

                if (!immediat) {
                    void enveloppe.offsetHeight;   // reflow forcé
                }

                section.classList.add("is-open");

            } else {
                section.classList.remove("is-open");

                if (immediat) {
                    enveloppe.hidden = true;
                } else {
                    minuteur = setTimeout(function () {
                        if (!section.classList.contains("is-open")) {
                            enveloppe.hidden = true;
                        }
                    }, FOLD_DUREE);
                }
            }

            return actif;
        }

        tete.addEventListener("click", function () {
            ouvrir();
        });

        ouvrir(opts.ouvert === true, true);

        return { el: section, body: corps, ouvrir: ouvrir };
    }

    /* ========================================================
       Réseau
    ======================================================== */

    /**
     * fetch + JSON avec une erreur exploitable.
     *
     * Le corps est lu en TEXTE avant d'être parsé : une réponse vide ou
     * du HTML (warning PHP, json_encode qui échoue) doit remonter comme
     * une vraie erreur, pas comme un « undefined » silencieux.
     */
    async function fetchJson(url, options) {
        var reponse = await fetch(url, options);
        var texte = await reponse.text();
        var data = null;

        try {
            data = texte ? JSON.parse(texte) : null;
        } catch (e) {
            throw new Error(
                "Réponse illisible du serveur (" + reponse.status + ")."
            );
        }

        if (!reponse.ok) {
            throw new Error(
                (data && data.error) || "Erreur " + reponse.status + "."
            );
        }

        return data;
    }

    /* ========================================================
       Export
    ======================================================== */

    window.MGS = {
        escapeHtml: escapeHtml,
        safeUrl: safeUrl,
        PLATFORMS: PLATFORMS,
        platformColor: platformColor,
        platformIcon: platformIcon,
        platformLabel: platformLabel,
        formaterNombre: formaterNombre,
        creerFold: creerFold,
        fetchJson: fetchJson
    };

    /* Alias globaux hérités : stats-display.js, hub-resume.js et
       acceuil.js appellent escapeHtml() et safeUrl() sans préfixe.
       Les garder évite de réécrire ~60 appels pour rien. */
    window.escapeHtml = escapeHtml;
    window.safeUrl = safeUrl;

}(window));
