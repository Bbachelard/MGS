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

function verifyEscape(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function verifyPost(params) {
    const response = await fetch('/php/verify.php', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
    });

    const data = await response.json().catch(() => ({}));

    // 202 = "pas encore vérifié", ce n'est pas un échec
    if (!response.ok && response.status !== 202) {
        throw new Error(data.error || 'Erreur inattendue.');
    }

    return data;
}

/* ------------------------------------------------------------------ */
/*  Modale                                                             */
/* ------------------------------------------------------------------ */

function fermerVerification() {
    if (!verifyModal) return;

    const slug = verifyModal.dataset.platform;
    verifyModal.remove();
    verifyModal = null;
    document.removeEventListener('keydown', verifyEchap);

    // On libère la vérification en attente côté serveur
    verifyPost({ action: 'cancel', platform: slug }).catch(() => {});
}

function verifyEchap(event) {
    if (event.key === 'Escape') fermerVerification();
}

function ouvrirVerification(platform, onLie) {
    fermerVerification();

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
                <p class="verify-hint">Tu pourras remettre ton ancienne icône juste après.</p>
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

    retour.addEventListener('click', () => etapeSaisie(platform, onLie));

    bouton.addEventListener('click', async () => {
        bouton.disabled = true;
        bouton.textContent = 'Vérification…';
        status.className = 'verify-status';
        status.textContent = '';

        try {
            const res = await verifyPost({ action: 'confirm', platform: platform.slug });

            if (res.step === 'linked') {
                etapeSucces(platform, res, onLie);
                return;
            }

            status.className = 'verify-status verify-status--warn';
            status.textContent = res.message || "L'icône ne correspond pas encore.";
        } catch (err) {
            status.className = 'verify-status verify-status--error';
            status.textContent = err.message;
        }

        bouton.disabled = false;
        bouton.textContent = 'Réessayer';
    });
}

/* --- Étape 3 : succès -------------------------------------------- */

function etapeSucces(platform, res, onLie) {
    const body = verifyModal.querySelector('.verify-body');

    body.innerHTML = `
        <p class="verify-success">✅ ${verifyEscape(res.message)}</p>
        <button class="link-btn verify-done" type="button">Voir mes stats</button>
    `;

    body.querySelector('.verify-done').addEventListener('click', () => {
        // On ferme sans envoyer "cancel" : la liaison est faite
        verifyModal.remove();
        verifyModal = null;
        document.removeEventListener('keydown', verifyEchap);

        if (typeof onLie === 'function') onLie(platform);
    });
}