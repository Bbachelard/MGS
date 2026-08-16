/* =========================================================
   AUTOCOMPLÉTION DE PSEUDO

   Une seule instance pour les 3 plateformes : la plateforme
   courante est lue à chaque frappe via getPlatform(), donc
   changer de plateforme change les suggestions sans rien
   réinitialiser.

   Quand l'utilisateur choisit une suggestion, on récupère un
   accountId. C'est ce qui fait marcher Riot (pas besoin du
   tag) et Epic (aucune recherche par pseudo côté API).

   Expose : window.initPseudoSuggest(options)
========================================================= */

(function () {
    "use strict";

    const DELAI_DEBOUNCE = 180;   // ms
    const MIN_CARACTERES = 2;

    /* Échappement mutualisé (js/core/mgs-core.js). La version locale
       passait par un élément DOM jetable à chaque frappe au clavier. */
    const echapper = MGS.escapeHtml;

    /** Met en gras la portion saisie dans le libellé proposé. */
    function surligner(libelle, saisie) {
        const index = libelle.toLowerCase().indexOf(saisie.toLowerCase());

        if (index < 0) {
            return echapper(libelle);
        }

        return echapper(libelle.slice(0, index))
             + "<strong>" + echapper(libelle.slice(index, index + saisie.length)) + "</strong>"
             + echapper(libelle.slice(index + saisie.length));
    }


    /**
     * @param {object}   options
     * @param {HTMLInputElement} options.input       champ pseudo
     * @param {Function} options.getPlatform         () => "Steam" | "Riot" | ...
     * @param {Function} options.onSelect            ({accountId, label}) => void
     * @param {Function} [options.onClear]           appelé dès que l'utilisateur retape
     */
    window.initPseudoSuggest = function (options) {

        const input = options.input;

        if (!input) {
            return null;
        }

        const conteneur = input.parentElement;

        if (!conteneur) {
            return null;
        }

        conteneur.classList.add("pseudo-suggest-host");


        /* ---------- Construction de la liste ---------- */

        const liste = document.createElement("ul");

        liste.className = "pseudo-suggest";
        liste.id = "pseudoSuggestList";
        liste.setAttribute("role", "listbox");
        liste.hidden = true;

        conteneur.appendChild(liste);

        input.setAttribute("role", "combobox");
        input.setAttribute("aria-autocomplete", "list");
        input.setAttribute("aria-expanded", "false");
        input.setAttribute("aria-controls", liste.id);
        input.setAttribute("autocomplete", "off");


        /* ---------- État ---------- */

        let resultats = [];
        let actif     = -1;
        let minuteur  = null;
        let requete   = null;              // AbortController en cours
        const cache   = new Map();         // "steam|blab" -> résultats


        function fermer() {
            liste.hidden = true;
            liste.innerHTML = "";
            resultats = [];
            actif = -1;
            input.setAttribute("aria-expanded", "false");
            input.removeAttribute("aria-activedescendant");
        }


        function dessiner(saisie) {

            if (resultats.length === 0) {
                fermer();
                return;
            }

            liste.innerHTML = resultats.map(function (item, i) {

                const meme = item.label.toLowerCase() === item.owner.toLowerCase();

                return '<li class="pseudo-suggest-item" role="option"'
                     + ' id="pseudoSuggestOpt' + i + '"'
                     + ' aria-selected="false" data-index="' + i + '">'
                     + '<span class="pss-label">' + surligner(item.label, saisie) + '</span>'
                     + (meme ? "" : '<span class="pss-owner">' + echapper(item.owner) + '</span>')
                     + '</li>';
            }).join("");

            liste.hidden = false;
            input.setAttribute("aria-expanded", "true");
        }


        function activer(index) {

            const items = liste.querySelectorAll(".pseudo-suggest-item");

            if (items.length === 0) {
                return;
            }

            // Boucle : flèche bas sur le dernier revient au premier
            actif = (index + items.length) % items.length;

            items.forEach(function (el, i) {
                const estActif = i === actif;
                el.classList.toggle("is-active", estActif);
                el.setAttribute("aria-selected", estActif ? "true" : "false");
            });

            input.setAttribute("aria-activedescendant", "pseudoSuggestOpt" + actif);
            items[actif].scrollIntoView({ block: "nearest" });
        }


        function choisir(index) {

            const item = resultats[index];

            if (!item) {
                return;
            }

            input.value = item.label;

            fermer();

            if (typeof options.onSelect === "function") {
                options.onSelect(item);
            }
        }


        async function chercher(saisie) {

            const plateforme = options.getPlatform ? options.getPlatform() : "";
            const cle = plateforme + "|" + saisie.toLowerCase();

            if (cache.has(cle)) {
                resultats = cache.get(cle);
                dessiner(saisie);
                return;
            }

            // Une frappe rapide annule la requête précédente : sinon une
            // réponse lente peut écraser une réponse plus récente.
            if (requete) {
                requete.abort();
            }

            requete = new AbortController();

            const url = "/php/suggest.php?platform=" + encodeURIComponent(plateforme)
                      + "&q=" + encodeURIComponent(saisie);

            try {
                const reponse = await fetch(url, { signal: requete.signal });

                if (!reponse.ok) {
                    fermer();
                    return;
                }

                const data = await reponse.json();

                resultats = Array.isArray(data.results) ? data.results : [];

                cache.set(cle, resultats);

                // La saisie a pu changer pendant l'aller-retour
                if (input.value.trim() === saisie) {
                    dessiner(saisie);
                }

            } catch (err) {

                if (err.name !== "AbortError") {
                    console.error("Suggestions indisponibles :", err);
                    fermer();
                }
            }
        }


        /* ---------- Événements ---------- */

        input.addEventListener("input", function () {

            if (typeof options.onClear === "function") {
                options.onClear();
            }

            const saisie = input.value.trim();

            clearTimeout(minuteur);

            if (saisie.length < MIN_CARACTERES) {
                fermer();
                return;
            }

            minuteur = setTimeout(function () {
                chercher(saisie);
            }, DELAI_DEBOUNCE);
        });


        input.addEventListener("keydown", function (e) {

            if (liste.hidden) {

                // Flèche bas sur un champ déjà rempli : rouvre la liste
                if (e.key === "ArrowDown" && input.value.trim().length >= MIN_CARACTERES) {
                    chercher(input.value.trim());
                }

                return;
            }

            switch (e.key) {

                case "ArrowDown":
                    e.preventDefault();
                    activer(actif + 1);
                    break;

                case "ArrowUp":
                    e.preventDefault();
                    activer(actif - 1);
                    break;

                case "Enter":
                    // N'intercepte la soumission que si un item est surligné
                    if (actif >= 0) {
                        e.preventDefault();
                        choisir(actif);
                    }
                    break;

                case "Escape":
                    fermer();
                    break;

                case "Tab":
                    fermer();
                    break;
            }
        });


        // mousedown et pas click : le blur du champ fermerait la liste avant
        liste.addEventListener("mousedown", function (e) {

            const item = e.target.closest(".pseudo-suggest-item");

            if (!item) {
                return;
            }

            e.preventDefault();
            choisir(Number(item.dataset.index));
        });


        liste.addEventListener("mousemove", function (e) {

            const item = e.target.closest(".pseudo-suggest-item");

            if (item) {
                activer(Number(item.dataset.index));
            }
        });


        input.addEventListener("blur", function () {
            setTimeout(fermer, 120);
        });


        document.addEventListener("click", function (e) {
            if (!conteneur.contains(e.target)) {
                fermer();
            }
        });


        return {
            fermer: fermer,
            viderCache: function () { cache.clear(); }
        };
    };

}());
