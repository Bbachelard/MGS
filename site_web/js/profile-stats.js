const PROFILE = window.PROFILE_TARGET || { userId: null, isOwnProfile: true };
const PROFILE_QS = PROFILE.userId ? `?userId=${encodeURIComponent(PROFILE.userId)}` : "";

let etatPlateformes = [];
let lectureSeule = false;


document.addEventListener("DOMContentLoaded", () => {
    chargerProfil();
});

async function chargerProfil() {
    const container = document.getElementById("platform-hub");
    if (!container) return;

   container.innerHTML = `<p class="stats-loading">Chargement des stats...</p>`;

let status;
try {
    const response = await fetch(`/php/session-status.php${PROFILE_QS}`, { credentials: "include" });
    status = await response.json();
} catch (err) {
    console.error("session-status:", err);
    container.innerHTML = `<p class="stats-error">Impossible de charger le profil.</p>`;
    return;
}

if (!status.connected) {
    window.location.href = "/connexion/index.php";
    return;
}

if (status.error) {
    container.innerHTML = `<p class="stats-error">${escapeHtml(status.error)}</p>`;
    return;
}

lectureSeule = status.isOwnProfile === false;

const steam = status.platforms.find(p => p.slug === "steam" && p.linked);
if (steam) {
    chargerBibliotheque("steam", { userId: PROFILE.userId, lectureSeule });
}

// État initial : les comptes liés sont marqués "en chargement"
etatPlateformes = status.platforms.map(platform => ({
    platform,
    data:       null,
    error:      null,
    chargement: platform.linked === true,
}));

dessinerHub(container);   // la page s'affiche tout de suite, avec squelettes
majAvatarNavbar();

// Chaque plateforme remplace son squelette dès qu'elle répond
status.platforms.forEach((platform, i) => {
    if (!platform.linked) return;

    chargerPlateforme(platform).then(resultat => {
        etatPlateformes[i] = { ...resultat, chargement: false };
        dessinerHub(container);
    });
});

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

    container.appendChild(
    construireBandeauComptes(etatPlateformes, delierPlateforme, { lectureSeule })
);
    const resume = construireResume(etatPlateformes);
    if (resume) {
        if (etatPlateformes.some(r => r.chargement)) {
            resume.classList.add('hub-global--partiel');
        }
        container.appendChild(resume);
}

    const details = construireDetails(etatPlateformes);
    if (details) {
        container.appendChild(details);
    } else {
        const vide = document.createElement("p");
        vide.className = "stats-info";
        vide.textContent = lectureSeule
    ? "Cet utilisateur n'a lié aucun compte."
    : "Lie un compte pour voir apparaître tes statistiques ici.";
        container.appendChild(vide);
    }
      if (!lectureSeule) brancherBoutonsVerification();
}

/** Branche les boutons "Lier" qui passent par la vérification d'icône. */
function brancherBoutonsVerification() {
    document.querySelectorAll('.js-verify').forEach(bouton => {
        if (bouton.dataset.branche === '1') return;   // le hub est redessiné souvent
        bouton.dataset.branche = '1';

        bouton.addEventListener('click', () => {
            const trouve = etatPlateformes.find(
                r => r.platform.slug === bouton.dataset.platform
            );

            if (trouve) {
                ouvrirVerification(trouve.platform, () => chargerProfil());
            }
        });
    });
}

/** Prend l'avatar du premier compte lié pour la navbar. */
function majAvatarNavbar() {
    if (lectureSeule) return;
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