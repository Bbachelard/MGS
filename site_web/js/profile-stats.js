/* ============================================================
   PROFIL — chargement et rendu du hub

   Depuis le multi-comptes, l'unité de travail n'est plus la
   plateforme mais LE COMPTE. etatComptes contient une entrée par
   compte lié, plus une entrée "vide" par plateforme sans compte :

     { platform, account, data, error }

   platform : l'objet renvoyé par session-status.php
   account  : { id, accountId, isPrimary, displayName } ou null
   ============================================================ */

const PROFILE = window.PROFILE_TARGET || { userId: null, isOwnProfile: true };
const PROFILE_QS = PROFILE.userId ? `?userId=${encodeURIComponent(PROFILE.userId)}` : "";

let etatPlateformes = [];   // brut de session-status.php (pour les boutons "ajouter")
let etatComptes     = [];   // une entrée par compte
let lectureSeule    = false;

document.addEventListener("DOMContentLoaded", () => {
    chargerProfil();
});

async function chargerProfil() {
    const container = document.getElementById("platform-hub");
    if (!container) return;

    container.innerHTML = `<p class="stats-loading">Chargement des stats...</p>`;

    let status;
    let reponseOk = false;

    try {
        const response = await fetch(`/php/session-status.php${PROFILE_QS}`, { credentials: "include" });
        reponseOk = response.ok;

        // Corps lu en TEXTE d'abord : une panne serveur peut renvoyer un
        // corps vide ou du HTML, et response.json() lèverait une exception
        // qui masquerait le vrai code HTTP.
        const texte = await response.text();
        status = texte ? JSON.parse(texte) : null;
    } catch (err) {
        console.error("session-status:", err);
        container.innerHTML = `<p class="stats-error">Impossible de charger le profil.</p>`;
        return;
    }

    /* Une erreur serveur n'est PAS une déconnexion.
       Sans ce contrôle, un 500 sur session-status.php renvoyait un objet
       sans clé "connected" : le test ci-dessous le prenait pour une
       session expirée et redirigeait vers la page de connexion, qui
       renvoyait aussitôt vers ce profil puisque la session, elle, était
       bien valide — la page se rechargeait en boucle. */
    if (!reponseOk) {
        const detail = (status && status.error) || `Erreur ${"" + status}`;
        console.error("session-status:", detail);
        container.innerHTML =
            `<p class="stats-error">Le serveur n'a pas pu charger ce profil.<br>`
            + `${escapeHtml(detail)}</p>`;
        return;
    }

    if (!status) {
        container.innerHTML = `<p class="stats-error">Réponse vide du serveur.</p>`;
        return;
    }

    if (!status.connected) {
        // Garde anti-boucle : on ne repart vers la connexion qu'une fois.
        // Si on en revient déjà, mieux vaut afficher le problème que de
        // faire clignoter le navigateur indéfiniment.
        if (sessionStorage.getItem("mgs-redirect-connexion") === "1") {
            sessionStorage.removeItem("mgs-redirect-connexion");
            container.innerHTML =
                `<p class="stats-error">Session non reconnue par le serveur. `
                + `<a href="/connexion/index.php">Se reconnecter</a></p>`;
            return;
        }

        sessionStorage.setItem("mgs-redirect-connexion", "1");
        window.location.href = "/connexion/index.php";
        return;
    }

    sessionStorage.removeItem("mgs-redirect-connexion");

    if (status.error) {
        container.innerHTML = `<p class="stats-error">${escapeHtml(status.error)}</p>`;
        return;
    }

    lectureSeule    = status.isOwnProfile === false;
    etatPlateformes = status.platforms || [];


    /* Une requête de stats par compte lié. Les plateformes sans compte
       produisent quand même une entrée : le bandeau doit afficher leur
       pastille "Lier". */
    const taches = [];

    etatPlateformes.forEach(platform => {
        const comptes = platform.accounts || [];

        if (comptes.length === 0) {
            taches.push(Promise.resolve({ platform, account: null, data: null, error: null }));
            return;
        }

        comptes.forEach(compte => taches.push(chargerCompte(platform, compte)));
    });

    etatComptes = await Promise.all(taches);

    marquerComptesMultiples();

    // Le tableau a besoin des stats déjà chargées : c'est de là que viennent
    // les lignes LoL / Fortnite, que games.php ne sait pas produire.
    chargerBibliotheques(etatComptes, { userId: PROFILE.userId, lectureSeule });

    dessinerHub(container);
}

/** Stats d'un compte précis. */
async function chargerCompte(platform, compte) {
    try {
        const url = `/php/api.php?platform=${encodeURIComponent(platform.slug)}`
                  + `&accountId=${encodeURIComponent(compte.accountId)}`;
        const response = await fetch(url);
        const data = await response.json();

        return data.error
            ? { platform, account: compte, data: null, error: data.error }
            : { platform, account: compte, data, error: null };

    } catch (err) {
        console.error(`Stats ${platform.slug} (${compte.accountId}):`, err);
        return { platform, account: compte, data: null, error: "Stats indisponibles." };
    }
}

/**
 * Quand une plateforme porte plusieurs comptes, ses blocs de détail
 * s'appelleraient tous "Riot Games" et seraient indiscernables.
 * On enrichit donc le libellé avec le nom du compte — construireDetails()
 * et construireCarte() lisent déjà platformLabel, rien d'autre à toucher.
 */
function marquerComptesMultiples() {
    etatComptes.forEach(entree => {
        if (!entree.account) return;

        // Le nom lisible vient des stats ; sinon on retombe sur l'identifiant.
        entree.account.displayName = (entree.data && entree.data.displayName)
            ? entree.data.displayName
            : entree.account.accountId;

        const nbComptes = (entree.platform.accounts || []).length;
        if (nbComptes > 1 && entree.data) {
            entree.data.platformLabel = `${entree.platform.label} — ${entree.account.displayName}`;
        }
    });
}

function dessinerHub(container) {
    container.innerHTML = "";

    container.appendChild(
        construireBandeauComptes(
            etatComptes,
            etatPlateformes,
            { onDelier: delierCompte, onPrincipal: definirPrincipal },
            { lectureSeule }
        )
    );

    const resume = construireResume(etatComptes);
    if (resume) container.appendChild(resume);

    const details = construireDetails(etatComptes);
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

/** Branche les boutons "Lier" / "Ajouter" qui passent par la vérification d'icône. */
function brancherBoutonsVerification() {
    document.querySelectorAll('.js-verify').forEach(bouton => {
        if (bouton.dataset.branche === '1') return;   // le hub est redessiné souvent
        bouton.dataset.branche = '1';

        bouton.addEventListener('click', () => {
            const platform = etatPlateformes.find(p => p.slug === bouton.dataset.platform);
            if (platform) {
                ouvrirVerification(platform, () => chargerProfil());
            }
        });
    });
}

/* ------------------------------------------------------------
   Actions sur un compte
   ------------------------------------------------------------ */

async function delierCompte(entree, btn) {
    const nom = (entree.account && entree.account.displayName) || entree.platform.label;

    if (!confirm(`Confirmer la suppression de la liaison avec le compte ${nom} ?`)) {
        return;
    }

    btn.disabled = true;

    try {
        const response = await fetch("/php/unlink.php", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ linkId: entree.account.id })
        });
        const data = await response.json();

        if (data.error) {
            alert(data.error);
            btn.disabled = false;
            return;
        }

        // Rechargement complet : délier peut promouvoir un autre compte
        // principal côté serveur, l'état local ne peut pas le deviner.
        await chargerProfil();

    } catch (err) {
        console.error("unlink:", err);
        alert("Une erreur est survenue, réessaie plus tard.");
        btn.disabled = false;
    }
}

async function definirPrincipal(entree, btn) {
    if (!entree.account || entree.account.isPrimary) return;

    btn.disabled = true;

    try {
        const response = await fetch("/php/set-primary.php", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ linkId: entree.account.id })
        });
        const data = await response.json();

        if (data.error) {
            alert(data.error);
            btn.disabled = false;
            return;
        }

        await chargerProfil();

    } catch (err) {
        console.error("set-primary:", err);
        alert("Une erreur est survenue, réessaie plus tard.");
        btn.disabled = false;
    }
}