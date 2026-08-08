let etatPlateformes = [];

document.addEventListener("DOMContentLoaded", () => {
    chargerProfil();
});

async function chargerProfil() {
    const container = document.getElementById("platform-hub");
    if (!container) return;

    container.innerHTML = `<p class="stats-loading">Chargement de tes stats...</p>`;

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

    // Un fetch par plateforme liée, tous en parallèle
    etatPlateformes = await Promise.all(
        status.platforms.map(plateforme => chargerPlateforme(plateforme))
    );

    dessinerHub(container);
    majAvatarNavbar();
    const steam = etatPlateformes.find(r => r.data && r.platform.slug === "steam");
    if (steam) {
        chargerBibliotheque("steam");
    }

}

async function chargerPlateforme(platform) {
    if (!platform.linked) {
        return { platform, data: null, error: null };
    }

    try {
        const url = `/php/api.php?platform=${encodeURIComponent(platform.slug)}`
                  + `&accountId=${encodeURIComponent(platform.accountId)}`;
        const response = await fetch(url);
        const data = await response.json();

        return data.error
            ? { platform, data: null, error: data.error }
            : { platform, data, error: null };

    } catch (err) {
        console.error(`Stats ${platform.slug}:`, err);
        return { platform, data: null, error: "Stats indisponibles." };
    }
}

function dessinerHub(container) {
    container.innerHTML = "";

    container.appendChild(construireBandeauComptes(etatPlateformes, delierPlateforme));

    const resume = construireResume(etatPlateformes);
    if (resume) container.appendChild(resume);

    const details = construireDetails(etatPlateformes);
    if (details) {
        container.appendChild(details);
    } else {
        const vide = document.createElement("p");
        vide.className = "stats-info";
        vide.textContent = "Lie un compte pour voir apparaître tes statistiques ici.";
        container.appendChild(vide);
    }
}

/** Prend l'avatar du premier compte lié pour la navbar. */
function majAvatarNavbar() {
    const img = document.getElementById("navAvatar");
    if (!img) return;

    const premier = etatPlateformes.find(r => r.data && r.data.avatar);
    if (!premier) return;

    img.src = premier.data.avatar;
    img.classList.add("is-linked");
    img.title = premier.data.displayName;
}

async function delierPlateforme(platform, btn) {
    if (!confirm(`Confirmer la suppression de la liaison avec ton compte ${platform.label} ?`)) {
        return;
    }

    btn.disabled = true;

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
            return;
        }

        // On met à jour l'état local et on redessine tout le hub
        etatPlateformes = etatPlateformes.map(r =>
            r.platform.slug === platform.slug
                ? { platform: { ...r.platform, linked: false, accountId: null }, data: null, error: null }
                : r
        );

        dessinerHub(document.getElementById("platform-hub"));

        const img = document.getElementById("navAvatar");
        if (img) { img.src = "../content/image/mgs_icon.png"; img.classList.remove("is-linked"); }
        majAvatarNavbar();

    } catch (err) {
        console.error("unlink:", err);
        alert("Une erreur est survenue, réessaie plus tard.");
        btn.disabled = false;
    }
}