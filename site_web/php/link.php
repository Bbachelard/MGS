<?php
declare(strict_types=1);

session_start();

file_put_contents('/tmp/epic-debug.log',
    date('H:i:s') . " ENTREE get=" . json_encode($_GET) . "\n", FILE_APPEND);

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

if (!isset($_SESSION['user_id'])) {
    mgs_link_redirect($siteUrl . '/connexion/index.php?error=session');
}

$slug = mgs_resolve_platform($_GET['platform'] ?? $_SESSION['link_platform'] ?? '');
$platform = mgs_platform($slug);

if ($slug === null || !$platform['linkable'] || !mgs_load_provider($slug)) {
    mgs_link_redirect($loggedUrl . '?error=platform_indisponible');
}

$userId = (int)$_SESSION['user_id'];

/* --- Aller : on part vers la plateforme --- */
if (!mgs_provider_call($slug, 'should_complete_link')) {

    // Quota vérifié AVANT le voyage : inutile d'envoyer l'utilisateur
    // s'authentifier chez Steam pour lui dire non au retour.
    if (mgs_count_accounts($conn, $userId, $slug) >= mgs_max_accounts($slug)) {
        mgs_link_redirect($loggedUrl . '?error=max&platform=' . $slug);
    }

    $state = bin2hex(random_bytes(16));
    $_SESSION['link_state']    = $state;
    $_SESSION['link_platform'] = $slug;

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
    unset($_SESSION['link_state'], $_SESSION['link_platform']);
    mgs_link_redirect($loggedUrl . '?error=state&platform=' . $slug);
}

unset($_SESSION['link_state'], $_SESSION['link_platform']);

// L'URL doit être reconstruite à l'identique de celle envoyée à la plateforme
$returnUrl = $siteUrl . '/php/link.php?platform=' . $slug . '&state=' . $state;
$result    = mgs_provider_call($slug, 'complete_link', $config['PLATFORMS'][$slug] ?? [], $returnUrl);

if (!$result['ok']) {
    mgs_link_redirect($loggedUrl . '?error=auth&platform=' . $slug);
}

$ajout = mgs_add_link($conn, $userId, $slug, (string)$result['accountId']);

if (!$ajout['ok']) {
    mgs_link_redirect($loggedUrl . '?error=' . urlencode($ajout['code']) . '&platform=' . $slug);
}

mgs_link_redirect($loggedUrl . '?linked=' . $slug);