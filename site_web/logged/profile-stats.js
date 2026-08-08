document.addEventListener("DOMContentLoaded", () => {
    loadSteamProfile();
});

function setStatsMessage(resultBox, className, message) {
    resultBox.replaceChildren();

    const p = document.createElement("p");
    p.className = className;
    p.textContent = String(message ?? "");

    resultBox.appendChild(p);
}

async function readJsonResponse(response) {
    try {
        return await response.json();
    } catch {
        throw new Error(`Réponse serveur invalide (${response.status}).`);
    }
}

async function loadSteamProfile() {
    const resultBox = document.getElementById("stats-result");
    if (!resultBox) return;

    const target = window.PROFILE_TARGET || null;
    const targetUserId = Number(target?.userId);

    const isFriendProfile = Boolean(
        target &&
        Number.isInteger(targetUserId) &&
        targetUserId > 0 &&
        target.isOwnProfile === false
    );

    setStatsMessage(resultBox, "stats-loading", "Chargement...");

    try {
        const statusUrl = isFriendProfile
            ? `./friend-status.php?id=${encodeURIComponent(targetUserId)}`
            : "../php/session-status.php";

        const statusResponse = await fetch(statusUrl, {
            credentials: "include"
        });

        const status = await readJsonResponse(statusResponse);

        if (!statusResponse.ok || !status.connected) {
            if (isFriendProfile) {
                setStatsMessage(
                    resultBox,
                    "stats-error",
                    status.error || "Impossible de charger ce profil."
                );
            } else {
                resultBox.replaceChildren();
            }

            return;
        }

        if (!status.steamId) {
            setStatsMessage(
                resultBox,
                "stats-info",
                isFriendProfile
                    ? "Cet utilisateur n'a pas encore lié de compte Steam."
                    : "Aucun compte Steam lié pour le moment."
            );

            return;
        }

        setStatsMessage(
            resultBox,
            "stats-loading",
            isFriendProfile
                ? "Chargement des stats Steam..."
                : "Chargement de tes stats Steam..."
        );

        const url =
            `../php/api.php?platform=Steam&steamid=${encodeURIComponent(status.steamId)}`;

        const response = await fetch(url, {
            credentials: "include"
        });

        const data = await readJsonResponse(response);

        if (!response.ok || data.error) {
            setStatsMessage(
                resultBox,
                "stats-error",
                data.error || "Impossible de charger les statistiques Steam."
            );

            return;
        }

        // Fonction définie dans stats-display.js
        afficherResultat(data, resultBox);

        // Le bouton "Délier" n'existe que sur son propre profil.
        if (!isFriendProfile) {
            ajouterBoutonDelier(resultBox);
        }

    } catch (err) {
        console.error(
            "Erreur lors du chargement des stats liées :",
            err
        );

        setStatsMessage(
            resultBox,
            "stats-error",
            "Une erreur est survenue."
        );
    }
}

function ajouterBoutonDelier(resultBox) {
    const btn = document.createElement("button");

    btn.className = "unlink-btn";
    btn.textContent = "Délier mon compte Steam";

    btn.addEventListener("click", async () => {
        const confirmation = confirm(
            "Confirmer la suppression de la liaison avec ton compte Steam ?"
        );

        if (!confirmation) return;

        btn.disabled = true;
        btn.textContent = "Suppression en cours...";

        try {
            const response = await fetch("../php/steam-unlink.php", {
                method: "POST",
                credentials: "include"
            });

            const data = await readJsonResponse(response);

            if (!response.ok || data.error) {
                alert(
                    data.error ||
                    "Impossible de délier le compte Steam."
                );

                btn.disabled = false;
                btn.textContent = "Délier mon compte Steam";

                return;
            }

            setStatsMessage(
                resultBox,
                "stats-info",
                "Compte Steam délié."
            );

        } catch (err) {
            console.error(
                "Erreur lors de la suppression de la liaison :",
                err
            );

            alert(
                "Une erreur est survenue, réessaie plus tard."
            );

            btn.disabled = false;
            btn.textContent = "Délier mon compte Steam";
        }
    });

    resultBox.appendChild(btn);
}