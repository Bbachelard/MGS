<?php
declare(strict_types=1);

/**
 * php/api.php — carte de statistiques d'un compte (endpoint public).
 *
 *   GET /php/api.php?platform=steam&pseudo=xxx
 *   GET /php/api.php?platform=riot&accountId=euw1:xxx
 *   GET /php/api.php?…&refresh=1     force le rafraîchissement
 *
 * Réponse : la « carte » normalisée produite par le provider.
 */

require_once __DIR__ . '/core/bootstrap.php';
require_once __DIR__ . '/core/cache.php';
require_once __DIR__ . '/core/account-resolver.php';

mgs_json_header();

/** Les stats ne bougent pas à la minute : inutile de rappeler Steam
 *  ou Riot à chaque affichage de page. */
const MGS_API_CACHE_TTL = 600;   // 10 minutes

[$slug, $platform] = mgs_require_platform($_GET['platform'] ?? null, 'fetch_stats', 'Statistiques');

$accountId = mgs_resolve_public_account($slug, $platform);

$cacheFile = mgs_cache_file('api', $slug, [$accountId]);
mgs_cache_serve($cacheFile, MGS_API_CACHE_TTL);

$stats = mgs_provider_call($slug, 'fetch_stats', mgs_platform_config($slug), $accountId);

if (!$stats['ok']) {
    mgs_fail($stats['status'] ?? 502, $stats['error']);
}

// Alimente l'index d'autocomplétion à partir du pseudo réellement
// renvoyé par la plateforme (ne touche que des comptes déjà liés).
if (isset($conn) && $conn instanceof mysqli) {
    require_once __DIR__ . '/suggest-model.php';
    mgs_remember_display_name($conn, $slug, $accountId, $stats['card']['displayName'] ?? null);
}

mgs_cache_store_and_send($cacheFile, mgs_json_encode($stats['card']));
