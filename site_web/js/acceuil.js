document.addEventListener("DOMContentLoaded", () => {

    // =====================================================
    // LOGO + SONS ALÉATOIRES
    // =====================================================

    const logoImg = document.querySelector(".titre img");

    if (logoImg) {

        const logoSounds = [
            "content/sound/logo-click1.mp3",
            "content/sound/logo-click2.mp3",
            "content/sound/logo-click3.mp3",
            "content/sound/logo-click4.mp3"
        ];

        let lastSoundIndex = -1;

        logoImg.addEventListener("click", () => {

            // Choisit un son différent du précédent
            let randomIndex;

            do {
                randomIndex = Math.floor(Math.random() * logoSounds.length);
            } while (
                randomIndex === lastSoundIndex &&
                logoSounds.length > 1
            );

            lastSoundIndex = randomIndex;

            // Crée un nouvel Audio à chaque clic
            const audio = new Audio(logoSounds[randomIndex]);

            audio.volume = 0.6;

            audio.play().catch((error) => {
                console.log("Erreur lecture audio :", error);
            });


            // Animation du logo
            logoImg.classList.remove("is-pressed");

            void logoImg.offsetWidth;

            logoImg.classList.add("is-pressed");
        });


        logoImg.addEventListener("animationend", () => {
            logoImg.classList.remove("is-pressed");
        });
    }


    // =====================================================
    // RECHERCHE DES STATS
    // =====================================================

    const platformSelect = document.getElementById("platformSelect");
    const platformToggle = document.getElementById("platformToggle");
    const platformValue = document.getElementById("platformValue");
    const platformMenu = document.getElementById("platformMenu");
    const statsForm = document.getElementById("statsForm");
    const pseudoField = document.getElementById("pseudoField");
    const resultBox = document.getElementById("stats-result");

    // Plateforme sélectionnée par défaut
    let selectedPlatform = "Steam";


    // Ouvre / ferme le menu
    platformToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        platformSelect.classList.toggle("open");
    });


    // Sélection d'une plateforme
    platformMenu.querySelectorAll("li").forEach((item) => {

        item.addEventListener("click", () => {

            const choix = item.getAttribute("data-value");

            selectedPlatform = choix;

            platformValue.innerHTML =
                choix + ' <span class="arrow">▾</span>';

            platformSelect.classList.remove("open");
        });

    });


    // Ferme le menu si on clique ailleurs
    document.addEventListener("click", () => {
        platformSelect.classList.remove("open");
    });


    // =====================================================
    // SOUMISSION DU FORMULAIRE
    // =====================================================

    statsForm.addEventListener("submit", async (e) => {

        e.preventDefault();

        const pseudo = pseudoField.value.trim();


        if (!pseudo) {

            resultBox.innerHTML =
                `<p class="stats-error">
                    Merci de saisir un pseudo.
                </p>`;

            return;
        }


        resultBox.innerHTML =
            `<p class="stats-loading">
                Recherche en cours...
            </p>`;


        try {

            const url =
                `/php/api.php?platform=${encodeURIComponent(selectedPlatform)}&pseudo=${encodeURIComponent(pseudo)}`;

            const response = await fetch(url);

            const data = await response.json();


            if (data.error) {

                resultBox.innerHTML =
                    `<p class="stats-error">
                        ${data.error}
                    </p>`;

                return;
            }


            afficherResultat(data, resultBox);


        } catch (err) {

            console.error(
                "Erreur lors de la récupération des stats :",
                err
            );


            resultBox.innerHTML =
                `<p class="stats-error">
                    Une erreur est survenue, réessaie plus tard.
                </p>`;
        }

    });

});