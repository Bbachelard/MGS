document.addEventListener("DOMContentLoaded", async () => {
    const resultBox = document.getElementById("stats-result");
    if (!resultBox) return;

    try {
        const statusResponse = await fetch("../php/session-status.php", {
            credentials: "include"
        });
        const status = await statusResponse.json();

        if (!status.connected) {
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
    } catch (err) {
        console.error("Erreur lors du chargement des stats liées :", err);
        resultBox.innerHTML = `<p class="stats-error">Une erreur est survenue.</p>`;
    }
});