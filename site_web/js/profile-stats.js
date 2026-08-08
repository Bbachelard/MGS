document.addEventListener("DOMContentLoaded", () => {
    loadSteamProfile();
});

async function loadSteamProfile() {
    const resultBox = document.getElementById("stats-result");
    if (!resultBox) return;

    resultBox.innerHTML = `<p class="stats-loading">Chargement...</p>`;

    try {
        const statusResponse = await fetch("../php/session-status.php", {
            credentials: "include"
        });
        const status = await statusResponse.json();

        if (!status.connected) {
            resultBox.innerHTML = "";
            return;
        }

        if (!status.steamId) {
            resultBox.innerHTML = `<p class="stats-info">Aucun compte Steam lié pour le moment.</p>`;
            return;
        }

        resultBox.innerHTML = `<p class="stats-loading">Chargement de tes stats Steam...</p>`;

        const url = `../php/api.php?platform=Steam&steamid=${encodeURIComponent(status.steamId)}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            resultBox.innerHTML = `<p class="stats-error">${data.error}</p>`;
            return;
        }

        // Fonction définie dans stats-display.js
        afficherResultat(data, resultBox);

        // Ajout du bouton "Délier" sous la carte joueur
        ajouterBoutonDelier(resultBox);

    } catch (err) {
        console.error("Erreur lors du chargement des stats liées :", err);
        resultBox.innerHTML = `<p class="stats-error">Une erreur est survenue.</p>`;
    }
}

function ajouterBoutonDelier(resultBox) {
    const btn = document.createElement("button");
    btn.className = "unlink-btn";
    btn.textContent = "Délier mon compte Steam";

    btn.addEventListener("click", async () => {
        const confirmation = confirm("Confirmer la suppression de la liaison avec ton compte Steam ?");
        if (!confirmation) return;

        btn.disabled = true;
        btn.textContent = "Suppression en cours...";

        try {
            const response = await fetch("../php/steam-unlink.php", {
                method: "POST",
                credentials: "include"
            });
            const data = await response.json();

            if (data.error) {
                alert(data.error);
                btn.disabled = false;
                btn.textContent = "Délier mon compte Steam";
                return;
            }

            resultBox.innerHTML = `<p class="stats-info">Compte Steam délié.</p>`;
        } catch (err) {
            console.error("Erreur lors de la suppression de la liaison :", err);
            alert("Une erreur est survenue, réessaie plus tard.");
            btn.disabled = false;
            btn.textContent = "Délier mon compte Steam";
        }
    });

    resultBox.appendChild(btn);
}