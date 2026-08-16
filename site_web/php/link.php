<?php
declare(strict_types=1);

/**
 * php/link.php — liaison d'un compte de plateforme par OAuth / OpenID.
 *
 * Le même script sert l'aller et le retour :
 *   aller  : on redirige vers la plateforme avec un state signé en session
 *   retour : la plateforme nous renvoie ici, on valide le state puis on
 *            enregistre le compte
 *
 * C'est le provider qui tranche via <slug>_should_complete_link().
 */

require_once __DIR__ . '/core/bootstrap.php';
require_once __DIR__ . '/links-model.php';

mgs_session_start();

$loggedUrl = mgs_site_url() . '/logged/index.php';

$userId = mgs_user_id();

if ($userId === null) {
    mgs_redirect(mgs_site_url() . '/connexion/index.php?error=session');
}

$slug     = mgs_resolve_platform($_GET['platform'] ?? $_SESSION['link_platform'] ?? '');
$platform = mgs_platform($slug);

if ($slug === null || !$platform['linkable'] || !mgs_load_provider($slug)) {
    mgs_redirect($loggedUrl . '?error=platform_indisponible');
}

$platformCfg = mgs_platform_config($slug);

/* ------------------------------------------------------------------
   Aller : on part vers la plateforme
------------------------------------------------------------------ */
if (!mgs_provider_call($slug, 'should_complete_link')) {

    if (mgs_count_accounts($conn, $userId, $slug) >= mgs_max_accounts($slug)) {
        mgs_redirect($loggedUrl . '?error=max&platform=' . $slug);
    }

    $state = bin2hex(random_bytes(16));

    $_SESSION['link_state']    = $state;
    $_SESSION['link_platform'] = $slug;

    $returnUrl = mgs_site_url() . '/php/link.php?platform=' . $slug . '&state=' . $state;

    mgs_redirect(mgs_provider_call($slug, 'begin_link', $platformCfg, $returnUrl));
}

/* ------------------------------------------------------------------
   Retour : on valide le state avant toute chose (anti-CSRF)
------------------------------------------------------------------ */
$state = (string) ($_GET['state'] ?? '');

if ($state === ''
    || !isset($_SESSION['link_state'])
    || !hash_equals($_SESSION['link_state'], $state)
    || ($_SESSION['link_platform'] ?? '') !== $slug) {
    mgs_redirect($loggedUrl . '?error=state&platform=' . $slug);
}

unset($_SESSION['link_state'], $_SESSION['link_platform']);

$returnUrl = mgs_site_url() . '/php/link.php?platform=' . $slug . '&state=' . $state;
$result    = mgs_provider_call($slug, 'complete_link', $platformCfg, $returnUrl);

if (!$result['ok']) {

    // Action corrective Epic : on renvoie l'utilisateur donner son accord.
    if (($result['reason'] ?? '') === 'consent' && !empty($result['continuationUrl'])) {
        $_SESSION['link_consent_url'] = (string) $result['continuationUrl'];
        mgs_redirect($loggedUrl . '?error=consent&platform=' . $slug);
    }

    mgs_redirect(
        $loggedUrl . '?error=auth&platform=' . $slug
        . '&reason=' . urlencode((string) ($result['reason'] ?? 'inconnu'))
    );
}

$ajout = mgs_add_link($conn, $userId, $slug, (string) $result['accountId']);

if (!$ajout['ok']) {
    mgs_redirect($loggedUrl . '?error=' . urlencode($ajout['code']) . '&platform=' . $slug);
}

mgs_redirect($loggedUrl . '?linked=' . $slug);
