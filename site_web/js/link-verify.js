/* ============================================================
   Liaison d'un compte par vérification d'icône de profil.
   Utilisé pour Riot tant que RSO n'est pas accordé.

   API publique : ouvrirVerification(platform, onLie)
   ============================================================ */

const VERIFY_PLACEHOLDERS = {
    riot: 'Pseudo#TAG (ex. Faker#KR1)',
};

const VERIFY_AIDES = {
    riot: 'Ton Riot ID complet, tag inclus. Ajoute <code>@euw1</code>, <code>@na1</code>… si tu joues hors Europe de l\'Ouest.',
};

let verifyModal = null;

/* Échappement mutualisé (js/core/mgs-core.js). La version locale
   oubliait l'apostrophe : un pseudo contenant « ' » cassait tout
   attribut HTML délimité par des apostrophes. */
const verifyEscape = MGS.escapeHtml;

/**
 * Appelle verify.php.
 *
 * On lit le corps en texte avant de le parser : une réponse vide ou du HTML
 * (warning PHP, json_encode qui échoue) doit remonter comme une vraie erreur,
 * et non se transformer en objet vide qui ferait afficher un message de repli
 * trompeur du genre "l'icône ne correspond pas".
 */
async function verifyPost(params) {
    const response = await fetch('/php/verify.php', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
    });

    const texte = (await response.text()).trim();

    if (texte === '') {
        throw new Error(
            `Le serveur a répondu ${response.status} avec un corps vide. `
            + `Regarde l'onglet Réseau des outils de développement.`
        );
    }

    let data;
    try {
        data = JSON.parse(texte);
    } catch (err) {
        console.error('Réponse non-JSON de verify.php :', texte);
        throw new Error(
            `Réponse illisible du serveur (HTTP ${response.status}). `
            + `Détail dans la console.`
        );
    }

    // 202 = "pas encore vérifié", ce n'est pas un échec
    if (!response.ok && response.status !== 202) {
        throw new Error(data.error || `Erreur serveur (HTTP ${response.status}).`);
    }

    // Filet : un corps 200 qui contient quand même une erreur
    if (data.error) {
        throw new Error(data.error);
    }

    return data;
}

/* ------------------------------------------------------------------ */
/*  Modale                                                             */
/* ------------------------------------------------------------------ */

function fermerVerification({ annuler = true } = {}) {
    if (!verifyModal) return;

    const slug = verifyModal.dataset.platform;
    verifyModal.remove();
    verifyModal = null;
    document.removeEventListener('keydown', verifyEchap);

    // On ne libère le défi que si l'utilisateur abandonne vraiment.
    // Fermer par erreur ne doit plus lui coûter une nouvelle icône à poser.
    if (annuler) {
        verifyPost({ action: 'cancel', platform: slug }).catch(() => {});
    }
}

function verifyEchap(event) {
    if (event.key === 'Escape') fermerVerification();
}

function ouvrirVerification(platform, onLie) {
    fermerVerification({ annuler: false });

    verifyModal = document.createElement('div');
    verifyModal.className = 'verify-modal';
    verifyModal.dataset.platform = platform.slug;

    verifyModal.innerHTML = `
        <div class="verify-box" role="dialog" aria-modal="true">
            <button class="verify-close" type="button" aria-label="Fermer">&times;</button>
            <h3 class="verify-title">Lier mon compte ${verifyEscape(platform.label)}</h3>
            <div class="verify-body"></div>
        </div>
    `;

    verifyModal.addEventListener('click', event => {
        if (event.target === verifyModal || event.target.classList.contains('verify-close')) {
            fermerVerification();
        }
    });

    document.addEventListener('keydown', verifyEchap);
    document.body.appendChild(verifyModal);

    etapeSaisie(platform, onLie);
}

/* --- Étape 1 : saisie de l'identifiant --------------------------- */

function etapeSaisie(platform, onLie, erreur = '') {
    const body = verifyModal.querySelector('.verify-body');

    body.innerHTML = `
        <p class="verify-lead">Renseigne ton identifiant de jeu. On te demandera ensuite
           une petite manipulation en jeu pour prouver que le compte t'appartient.</p>
        <label class="verify-label" for="verifyPseudo">Identifiant</label>
        <input id="verifyPseudo" class="verify-input" type="text" autocomplete="off"
               placeholder="${verifyEscape(VERIFY_PLACEHOLDERS[platform.slug] || 'Ton identifiant')}">
        <p class="verify-hint">${VERIFY_AIDES[platform.slug] || ''}</p>
        ${erreur ? `<p class="verify-error">${verifyEscape(erreur)}</p>` : ''}
        <button class="link-btn verify-submit" type="button">Continuer</button>
    `;

    const input = body.querySelector('#verifyPseudo');
    const bouton = body.querySelector('.verify-submit');

    const lancer = async () => {
        const pseudo = input.value.trim();
        if (!pseudo) return;

        bouton.disabled = true;
        bouton.textContent = 'Recherche…';

        try {
            const data = await verifyPost({
                action: 'start',
                platform: platform.slug,
                pseudo,
            });
            etapeIcone(platform, data, onLie);
        } catch (err) {
            etapeSaisie(platform, onLie, err.message);
        }
    };

    bouton.addEventListener('click', lancer);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') lancer(); });
    input.focus();
}

/* --- Étape 2 : changement d'icône -------------------------------- */

function etapeIcone(platform, data, onLie) {
    const body = verifyModal.querySelector('.verify-body');

    body.innerHTML = `
        <p class="verify-account">Compte trouvé : <strong>${verifyEscape(data.account)}</strong></p>

        ${data.reprise ? `<p class="verify-hint">Vérification déjà en cours reprise : c'est la même icône qu'avant.</p>` : ''}

        <div class="verify-icon-block">
            <img class="verify-icon" src="${verifyEscape(data.iconUrl)}" alt="Icône à appliquer">
            <div class="verify-steps">
                <p>Pour prouver que ce compte est bien le tien :</p>
                <ol>
                    <li>Ouvre le client League of Legends</li>
                    <li>Clique sur ton icône de profil, puis <em>Modifier l'icône</em></li>
                    <li>Choisis exactement l'icône affichée ici (n°${Number(data.iconId)})</li>
                    <li>Reviens et clique sur « J'ai changé mon icône »</li>
                </ol>
                <p class="verify-hint">Riot peut mettre plus de dix minutes à propager le changement.
                   Laisse cette fenêtre ouverte : la vérification se relance toute seule.</p>
            </div>
        </div>

        <p class="verify-status" aria-live="polite"></p>
        <div class="verify-actions">
            <button class="link-btn verify-check" type="button">J'ai changé mon icône</button>
            <button class="verify-back" type="button">Annuler</button>
        </div>
    `;

    const bouton = body.querySelector('.verify-check');
    const retour = body.querySelector('.verify-back');
    const status = body.querySelector('.verify-status');

    let sondage = null;

    const stopper = () => { if (sondage) { clearInterval(sondage); sondage = null; } };

    retour.addEventListener('click', () => { stopper(); etapeSaisie(platform, onLie); });

    const verifier = async ({ auto = false } = {}) => {
        if (!verifyModal) { stopper(); return; }

        bouton.disabled = true;
        bouton.textContent = auto ? 'Vérification automatique…' : 'Vérification…';

        try {
            const res = await verifyPost({ action: 'confirm', platform: platform.slug });

            if (res.step === 'linked') {
                stopper();
                etapeSucces(platform, res, onLie);
                return;
            }

            status.className = 'verify-status verify-status--warn';
            status.textContent = res.message || 'En attente de la propagation côté Riot…';

            // Premier échec manuel : on prend le relais toutes les 20 s
            if (!auto && !sondage) {
                sondage = setInterval(() => verifier({ auto: true }), 20000);
            }

        } catch (err) {
            stopper();
            status.className = 'verify-status verify-status--error';
            status.textContent = err.message;
        }

        bouton.disabled = false;
        bouton.textContent = 'Réessayer maintenant';
    };

    bouton.addEventListener('click', () => verifier());
}

/* --- Étape 3 : succès -------------------------------------------- */

function etapeSucces(platform, res, onLie) {
    const body = verifyModal.querySelector('.verify-body');

    body.innerHTML = `
        <p class="verify-success">✅ ${verifyEscape(res.message)}</p>
        <button class="link-btn verify-done" type="button">Voir mes stats</button>
    `;

    body.querySelector('.verify-done').addEventListener('click', () => {
        fermerVerification({ annuler: false });
        if (typeof onLie === 'function') onLie(platform);
    });
}