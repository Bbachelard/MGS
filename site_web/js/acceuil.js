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
 
            afficherResultat(data);
        } catch (err) {
            console.error("Erreur lors de la récupération des stats :", err);
            resultBox.innerHTML = `<p class="stats-error">Une erreur est survenue, réessaie plus tard.</p>`;
        }
    });
 
    function afficherResultat(data) {
        const dateCreation = data.timecreated ? new Date(data.timecreated * 1000).toLocaleDateString('fr-FR') : 'Inconnue';
        const derniereConnexion = data.lastlogoff ? new Date(data.lastlogoff * 1000).toLocaleString('fr-FR') : 'Inconnue';
        const enJeu = data.gameextrainfo ? `<p>🎮 En train de jouer à : <strong>${data.gameextrainfo}</strong></p>` : '';

        const jeuxRecents = (data.recentGames || []).slice(0, 5).map(g =>
            `<li>${g.name} — ${(g.playtime_2weeks / 60).toFixed(1)}h (2 sem.)</li>`
        ).join('');

        resultBox.innerHTML = `
            <div class="stats-card">
                <img src="${data.avatar}" alt="avatar" width="64">
                <div>
                    <h3>${data.pseudo} ${data.realname ? `(${data.realname})` : ''}</h3>
                    <p>Plateforme : ${data.platform}</p>
                    <p>Statut : ${data.statut}</p>
                    ${enJeu}
                    <p>Profil : ${data.communityvisibilitystate}</p>
                    <p>Niveau Steam : ${data.steamLevel ?? '-'} | XP : ${data.xp ?? '-'}</p>
                    <p>Pays : ${data.loccountrycode || '-'}</p>
                    <p>Membre depuis : ${dateCreation}</p>
                    <p>Dernière connexion : ${derniereConnexion}</p>
                    <p>Jeux possédés : ${data.ownedGamesCount ?? 0}</p>
                    ${jeuxRecents ? `<p>Récemment joués :</p><ul>${jeuxRecents}</ul>` : ''}
                    <a href="${data.profileUrl}" target="_blank">Voir le profil</a>
                </div>
            </div>
        `;
        resultBox.scrollIntoView({ behavior: "smooth", block: "center" });
    }
});