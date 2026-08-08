document.addEventListener("DOMContentLoaded", () => {
    chargerProfil();
});

async function chargerProfil() {
    const container = document.getElementById("platform-cards");
    if (!container) return;

    container.innerHTML = `<p class="stats-loading">Chargement...</p>`;

    let status;
    try {
        const response = await fetch("/php/session-status.php", { credentials: "include" });
        status = await response.json();
    } catch (err) {
        console.error("session-status:", err);
        container.innerHTML = `<p class="stats-error">Impossible de charger ton profil.</p>`;
        return;
    }

    if (!status.connected) {
        window.location.href = "/connexion/index.php";
        return;
    }

    container.innerHTML = "";

    // Une carte par plateforme, chargées en parallèle
    const rendus = status.platforms.map(platform => rendrePlateforme(platform, container));
    await Promise.allSettled(rendus);
}

async function rendrePlateforme(platform, container) {
    // Emplacement réservé pour garder l'ordre du registre
    const slot = document.createElement("div");
    slot.className = "card-slot";
    container.appendChild(slot);

    if (!platform.linked) {
        slot.appendChild(construireCarteVide(platform));
        return;
    }

    slot.innerHTML = `<p class="stats-loading">Chargement ${platform.label}...</p>`;

    try {
        const url = `/php/api.php?platform=${encodeURIComponent(platform.slug)}`
                  + `&accountId=${encodeURIComponent(platform.accountId)}`;
        const response = await fetch(url);
        const data = await response.json();

        slot.innerHTML = "";

        if (data.error) {
            slot.appendChild(construireCarteErreur(platform, data.error));
            return;
        }

        const card = construireCarte(data);
        card.appendChild(construireBoutonDelier(platform, slot));
        slot.appendChild(card);

    } catch (err) {
        console.error(`Stats ${platform.slug}:`, err);
        slot.innerHTML = "";
        slot.appendChild(construireCarteErreur(platform, "Une erreur est survenue."));
    }
}

function construireCarteErreur(platform, message) {
    const card = document.createElement("div");
    card.className = "player-card player-card--empty";
    card.innerHTML = `
        <div class="platform-tag">${escapeHtml(platform.label)}</div>
        <div class="empty-body">
            <p class="stats-error">${escapeHtml(message)}</p>
        </div>
    `;
    card.appendChild(construireBoutonDelier(platform, card));
    return card;
}

function construireBoutonDelier(platform, slot) {
    const btn = document.createElement("button");
    btn.className = "unlink-btn";
    btn.textContent = `Délier mon compte ${platform.label}`;

    btn.addEventListener("click", async () => {
        if (!confirm(`Confirmer la suppression de la liaison avec ton compte ${platform.label} ?`)) {
            return;
        }

        btn.disabled = true;
        btn.textContent = "Suppression en cours...";

        try {
            const response = await fetch("/php/unlink.php", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ platform: platform.slug })
            });
            const data = await response.json();

            if (data.error) {
                alert(data.error);
                btn.disabled = false;
                btn.textContent = `Délier mon compte ${platform.label}`;
                return;
            }

            slot.innerHTML = "";
            slot.appendChild(construireCarteVide({ ...platform, linked: false, accountId: null }));

        } catch (err) {
            console.error("unlink:", err);
            alert("Une erreur est survenue, réessaie plus tard.");
            btn.disabled = false;
            btn.textContent = `Délier mon compte ${platform.label}`;
        }
    });

    return btn;
}