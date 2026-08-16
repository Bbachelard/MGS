<?php
declare(strict_types=1);

/* ==================================================================
 *  Liaison par preuve de propriété (sans OAuth).
 *
 *  POST action=start   + platform + pseudo  -> renvoie l'icône à poser
 *  POST action=confirm + platform           -> vérifie et enregistre
 *  POST action=cancel  + platform           -> abandonne
 *
 *  L'accountId résolu vit uniquement en session : le client ne peut
 *  pas nous faire enregistrer un compte qu'il n'a pas fait vérifier.
 * ================================================================== */

require_once __DIR__ . '/core/bootstrap.php';
require_once __DIR__ . '/links-model.php';

mgs_session_start();
mgs_json_header();

const MGS_VERIFY_TTL      = 3600; // 1 h : Riot peut mettre >10 min à propager l'icône
const MGS_VERIFY_MAX_TRY  = 40;   // anti-martelage de l'API Riot
const MGS_VERIFY_COOLDOWN = 4;    // secondes entre deux "confirm"

/**
 * Sortie JSON du script. Le corps de la fonction vivait ici en entier :
 * il est parti dans core/http.php, qui porte déjà le repli sur octets
 * non-UTF8 (les pseudos de joueurs en sont pleins, et « echo false »
 * renvoyait un corps vide en 200). Ce nom reste comme simple alias.
 */
function mgs_verify_send(int $status, array $payload): never
{
    mgs_json($payload, $status);
}

function mgs_verify_error(int $status, string $message): never
{
    mgs_fail($status, $message);
}

$userId = mgs_require_login();
mgs_require_method('POST');

$slug = mgs_resolve_platform($_POST['platform'] ?? '');

if ($slug === null) {
    mgs_verify_error(400, 'Plateforme inconnue.');
}

$platform = mgs_platform($slug);

if (empty($platform['verifiable'])
    || !mgs_load_provider($slug)
    || !mgs_provider_supports($slug, 'resolve_account_id')
    || !mgs_provider_supports($slug, 'profile_icon')
    || !mgs_provider_supports($slug, 'verification_icons')) {
    mgs_verify_error(501, 'Vérification indisponible pour ' . $platform['label'] . '.');
}

$cfg    = mgs_platform_config($slug);
$action = (string)($_POST['action'] ?? '');

/* ------------------------------------------------------------------ */
/*  cancel                                                             */
/* ------------------------------------------------------------------ */
if ($action === 'cancel') {
    unset($_SESSION['verify']);
    mgs_verify_send(200, ['step' => 'idle']);
}

/* ------------------------------------------------------------------ */
/*  start : on résout le compte et on tire une icône cible             */
/* ------------------------------------------------------------------ */
if ($action === 'start') {

    $pseudo = trim((string)($_POST['pseudo'] ?? ''));

    if ($pseudo === '') {
        mgs_verify_error(400, 'Saisis ton identifiant de jeu.');
    }

    $resolved = mgs_provider_call($slug, 'resolve_account_id', $cfg, $pseudo);

    if (!$resolved['ok']) {
        mgs_verify_error($resolved['status'] ?? 404, $resolved['error']);
    }

    $accountId = (string)$resolved['accountId'];
    $owner     = mgs_get_link_owner($conn, $slug, $accountId);

    if ($owner !== null && $owner !== $userId) {
        mgs_verify_error(409, 'Ce compte ' . $platform['label'] . ' est déjà lié à un autre compte MGS.');
    }

    // Le compte est déjà dans SON profil : rien à vérifier.
    if (mgs_user_owns_account($conn, $userId, $slug, $accountId)) {
        mgs_verify_error(409, 'Ce compte ' . $platform['label'] . ' est déjà dans ton profil.');
    }

    // Quota contrôlé ici : inutile de faire changer une icône de profil
    // à quelqu'un pour lui refuser l'enregistrement 10 minutes plus tard.
    $max = mgs_max_accounts($slug);

    if (mgs_count_accounts($conn, $userId, $slug) >= $max) {
        mgs_verify_error(409, 'Limite atteinte : ' . $max . ' comptes ' . $platform['label'] . ' maximum.');
    }

    $icons = mgs_provider_call($slug, 'verification_icons', $cfg);

    if (!$icons) {
        mgs_verify_error(502, 'Impossible de préparer la vérification, réessaie.');
    }

    $encours = $_SESSION['verify'] ?? null;

    // Un défi déjà en cours sur le MÊME compte est repris tel quel.
    // Sans ça, rouvrir la modale tirait une nouvelle icône : l'utilisateur
    // devait tout recommencer alors qu'il venait d'attendre la propagation.
    $reprise = is_array($encours)
               && ($encours['platform'] ?? '') === $slug
               && ($encours['accountId'] ?? '') === $accountId
               && time() < (int)($encours['expires'] ?? 0);

    if ($reprise) {
        $cible = (int)$encours['iconId'];

        foreach ($icons as $icon) {
            if ((int)$icon['id'] === $cible) {
                $target = $icon;
                break;
            }
        }
    }

    if (!isset($target)) {
        // On évite de tomber sur l'icône déjà portée : sinon le joueur
        // n'aurait rien à changer et n'importe qui pourrait "prouver" le compte.
        $current    = mgs_provider_call($slug, 'profile_icon', $cfg, $accountId);
        $candidates = array_values(array_filter(
            $icons,
            static fn (array $icon): bool => $icon['id'] !== $current
        ));

        if (!$candidates) {
            $candidates = $icons;
        }

        $target = $candidates[random_int(0, count($candidates) - 1)];

        $_SESSION['verify'] = [
            'platform'  => $slug,
            'accountId' => $accountId,
            'iconId'    => (int)$target['id'],
            'previous'  => $current,
            'expires'   => time() + MGS_VERIFY_TTL,
            'tries'     => 0,
            'lastTry'   => 0,
        ];
    }

    mgs_verify_send(200, [
        'step'      => 'pending',
        'reprise'   => $reprise,
        'platform'  => $slug,
        'label'     => $platform['label'],
        'account'   => mgs_provider_supports($slug, 'display_name')
                       ? mgs_provider_call($slug, 'display_name', $cfg, $accountId)
                       : $pseudo,
        'iconId'    => (int)$target['id'],
        'iconUrl'   => $target['url'],
        'expiresIn' => max(0, (int)$_SESSION['verify']['expires'] - time()),
    ]);
}

/* ------------------------------------------------------------------ */
/*  confirm : on relit l'icône portée et on compare                    */
/* ------------------------------------------------------------------ */
if ($action === 'confirm') {

    $pending = $_SESSION['verify'] ?? null;

    if (!is_array($pending) || ($pending['platform'] ?? '') !== $slug) {
        mgs_verify_error(400, 'Aucune vérification en cours. Recommence depuis le début.');
    }

    if (time() > (int)$pending['expires']) {
        unset($_SESSION['verify']);
        mgs_verify_error(410, 'Le délai est écoulé. Relance la vérification.');
    }

    if ((int)$pending['tries'] >= MGS_VERIFY_MAX_TRY) {
        unset($_SESSION['verify']);
        mgs_verify_error(429, 'Trop de tentatives. Relance la vérification.');
    }

    if (time() - (int)$pending['lastTry'] < MGS_VERIFY_COOLDOWN) {
        mgs_verify_error(429, 'Patiente quelques secondes avant de réessayer.');
    }

    $_SESSION['verify']['tries']   = (int)$pending['tries'] + 1;
    $_SESSION['verify']['lastTry'] = time();

    $current = mgs_provider_call($slug, 'profile_icon', $cfg, $pending['accountId']);

    if ($current === null) {
        mgs_verify_error(502, 'Le service ' . $platform['label'] . ' ne répond pas, réessaie dans un instant.');
    }

    if ($current !== (int)$pending['iconId']) {
        // 202 : "pas encore", ce n'est pas une erreur
        mgs_verify_send(202, [
            'step'      => 'pending',
            'matched'   => false,
            'attendu'   => (int)$pending['iconId'],
            'recu'      => $current,
            'message'   => "L'icône lue est la n°{$current}, on attend la n°{$pending['iconId']}. "
                           . "Riot met parfois plus de 10 minutes à propager le changement : "
                           . "garde cette fenêtre ouverte et réessaie.",
            'triesLeft' => MGS_VERIFY_MAX_TRY - (int)$_SESSION['verify']['tries'],
        ]);
    }

    // Re-contrôle du propriétaire : quelqu'un a pu lier ce compte entre-temps
    $owner = mgs_get_link_owner($conn, $slug, (string)$pending['accountId']);

    if ($owner !== null && $owner !== $userId) {
        unset($_SESSION['verify']);
        mgs_verify_error(409, "Ce compte vient d'être lié à un autre compte MGS.");
    }

    $ajout = mgs_add_link($conn, $userId, $slug, (string)$pending['accountId']);

    if (!$ajout['ok']) {
        // Sur un échec définitif seulement, on libère le défi. Une erreur
        // technique ne doit pas coûter un nouveau changement d'icône.
        if (in_array($ajout['code'] ?? '', ['deja_lie', 'deja_present', 'max'], true)) {
            unset($_SESSION['verify']);
        }
        mgs_verify_error(409, $ajout['error']);
    }

    unset($_SESSION['verify']);

    mgs_verify_send(200, [
        'step'     => 'linked',
        'matched'  => true,
        'platform' => $slug,
        'message'  => 'Compte ' . $platform['label'] . " vérifié et lié. Tu peux remettre ton icône d'origine.",
    ]);
}

mgs_verify_error(400, 'Action inconnue.');