<?php
declare(strict_types=1);

session_start();

require_once __DIR__ . '/platforms.php';
require_once __DIR__ . '/links-model.php';

$config = require __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');

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

const MGS_VERIFY_TTL     = 900; // 15 min pour finir la manip
const MGS_VERIFY_MAX_TRY = 12;  // anti-martelage de l'API Riot
const MGS_VERIFY_COOLDOWN = 4;  // secondes entre deux "confirm"

function mgs_verify_error(int $status, string $message): never
{
    http_response_code($status);
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

if (!isset($_SESSION['user_id'])) {
    mgs_verify_error(401, 'Session expirée, reconnecte-toi.');
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    mgs_verify_error(405, 'Méthode non autorisée.');
}

$userId = (int)$_SESSION['user_id'];
$slug   = mgs_resolve_platform($_POST['platform'] ?? '');

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

$cfg    = $config['PLATFORMS'][$slug] ?? [];
$action = (string)($_POST['action'] ?? '');

/* ------------------------------------------------------------------ */
/*  cancel                                                             */
/* ------------------------------------------------------------------ */
if ($action === 'cancel') {
    unset($_SESSION['verify']);
    echo json_encode(['step' => 'idle']);
    exit;
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

    $icons = mgs_provider_call($slug, 'verification_icons', $cfg);

    if (!$icons) {
        mgs_verify_error(502, 'Impossible de préparer la vérification, réessaie.');
    }

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

    echo json_encode([
        'step'      => 'pending',
        'platform'  => $slug,
        'label'     => $platform['label'],
        'account'   => mgs_provider_supports($slug, 'display_name')
                       ? mgs_provider_call($slug, 'display_name', $cfg, $accountId)
                       : $pseudo,
        'iconId'    => (int)$target['id'],
        'iconUrl'   => $target['url'],
        'expiresIn' => MGS_VERIFY_TTL,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
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
        http_response_code(202); // "pas encore", ce n'est pas une erreur
        echo json_encode([
            'step'      => 'pending',
            'matched'   => false,
            'message'   => "L'icône n'a pas encore changé. Riot met parfois 1 à 2 minutes à la propager — "
                           . "vérifie qu'elle est bien appliquée dans le client, puis réessaie.",
            'triesLeft' => MGS_VERIFY_MAX_TRY - (int)$_SESSION['verify']['tries'],
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // Re-contrôle du propriétaire : quelqu'un a pu lier ce compte entre-temps
    $owner = mgs_get_link_owner($conn, $slug, $pending['accountId']);

    if ($owner !== null && $owner !== $userId) {
        unset($_SESSION['verify']);
        mgs_verify_error(409, 'Ce compte vient d\'être lié à un autre compte MGS.');
    }

    if (!mgs_save_link($conn, $userId, $slug, (string)$pending['accountId'])) {
        mgs_verify_error(500, 'Enregistrement impossible, réessaie.');
    }

    unset($_SESSION['verify']);

    echo json_encode([
        'step'     => 'linked',
        'matched'  => true,
        'platform' => $slug,
        'message'  => 'Compte ' . $platform['label'] . ' vérifié et lié. Tu peux remettre ton icône d\'origine.',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

mgs_verify_error(400, 'Action inconnue.');