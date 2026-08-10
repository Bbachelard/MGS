<?php
declare(strict_types=1);

session_start();

require_once __DIR__ . '/platforms.php';
require_once __DIR__ . '/links-model.php';

$config = require __DIR__ . '/../config.php';

$siteUrl   = rtrim($config['SITE_URL'], '/');
$loggedUrl = $siteUrl . '/logged/index.php';

function mgs_link_redirect(string $url): never
{
    header('Location: ' . $url);
    exit;
}

if (mgs_load_provider('epic')) {
    epic_log('ENTREE get=' . json_encode($_GET) . ' sid=' . session_id());
}

if (!isset($_SESSION['user_id'])) {
    mgs_link_redirect($siteUrl . '/connexion/index.php?error=session');
}

$slug     = mgs_resolve_platform($_GET['platform'] ?? $_SESSION['link_platform'] ?? '');
$platform = mgs_platform($slug);

if ($slug === null || !$platform['linkable'] || !mgs_load_provider($slug)) {
    mgs_link_redirect($loggedUrl . '?error=platform_indisponible');
}

$userId = (int)$_SESSION['user_id'];

/* --- Aller : on part vers la plateforme --- */
if (!mgs_provider_call($slug, 'should_complete_link')) {

    if (mgs_count_accounts($conn, $userId, $slug) >= mgs_max_accounts($slug)) {
        mgs_link_redirect($loggedUrl . '?error=max&platform=' . $slug);
    }

    $state = bin2hex(random_bytes(16));
    $_SESSION['link_state']    = $state;
    $_SESSION['link_platform'] = $slug;
    unset($_SESSION['link_consent_tries']);   // nouvelle liaison = compteur remis à zéro

    $returnUrl = $siteUrl . '/php/link.php?platform=' . $slug . '&state=' . $state;

    mgs_link_redirect(
        mgs_provider_call($slug, 'begin_link', $config['PLATFORMS'][$slug] ?? [], $returnUrl)
    );
}

/* --- Retour : on valide --- */
$state = (string)($_GET['state'] ?? '');

if ($state === ''
    || !isset($_SESSION['link_state'])
    || !hash_equals($_SESSION['link_state'], $state)
    || ($_SESSION['link_platform'] ?? '') !== $slug) {
    unset($_SESSION['link_state'], $_SESSION['link_platform'], $_SESSION['link_consent_tries']);
    mgs_link_redirect($loggedUrl . '?error=state&platform=' . $slug);
}

unset($_SESSION['link_state'], $_SESSION['link_platform']);

$returnUrl = $siteUrl . '/php/link.php?platform=' . $slug . '&state=' . $state;
$result    = mgs_provider_call($slug, 'complete_link', $config['PLATFORMS'][$slug] ?? [], $returnUrl);

/* ===== C'EST ICI QUE VA LE NOUVEAU BLOC ===== */
if (!$result['ok']) {

    // Action corrective Epic : on renvoie l'utilisateur donner son accord.
    // Le state est remis en session car Epic reviendra avec un nouveau code.
    if (($result['reason'] ?? '') === 'consent' && !empty($result['continuationUrl'])) {

        $essais = (int)($_SESSION['link_consent_tries'] ?? 0);

        if ($essais < 2) {                       // garde-fou anti-boucle
            $_SESSION['link_consent_tries'] = $essais + 1;
            $_SESSION['link_state']         = $state;
            $_SESSION['link_platform']      = $slug;

            mgs_link_redirect((string)$result['continuationUrl']);
        }

        unset($_SESSION['link_consent_tries']);
        mgs_link_redirect($loggedUrl . '?error=auth&platform=' . $slug . '&reason=consent_boucle');
    }

    mgs_link_redirect(
        $loggedUrl . '?error=auth&platform=' . $slug
        . '&reason=' . urlencode((string)($result['reason'] ?? 'inconnu'))
    );
}
/* ===== FIN DU NOUVEAU BLOC ===== */

$ajout = mgs_add_link($conn, $userId, $slug, (string)$result['accountId']);

if (!$ajout['ok']) {
    mgs_link_redirect($loggedUrl . '?error=' . urlencode($ajout['code']) . '&platform=' . $slug);
}

unset($_SESSION['link_consent_tries']);
mgs_link_redirect($loggedUrl . '?linked=' . $slug);