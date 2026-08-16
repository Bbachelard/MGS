<?php
declare(strict_types=1);

/**
 * php/matches.php — pagination des dernières parties.
 *
 * Appelé par le bouton « Voir plus » de match-detail.js. Le premier lot
 * est déjà dans la réponse d'api.php : cet endpoint ne sert QUE pour
 * start > 0.
 *
 *   GET /php/matches.php?platform=riot&accountId=euw1:xxx&start=5&count=5
 *   GET /php/matches.php?platform=riot&pseudo=BlackBen%23BOZO&start=5
 *
 * Réponse : { platform, matches, assets, start, count, hasMore }
 */

require_once __DIR__ . '/core/bootstrap.php';
require_once __DIR__ . '/core/cache.php';
require_once __DIR__ . '/core/account-resolver.php';

mgs_json_header();

/** Les parties elles-mêmes ont leur propre cache long dans le provider :
 *  ici on ne met en cache que la liste, qui bouge à chaque partie jouée. */
const MGS_MATCHES_CACHE_TTL = 900;   // 15 minutes

/** Bornes serveur de la pagination : le client ne dicte pas la charge. */
const MGS_MATCHES_COUNT_MAX = 10;

[$slug, $platform] = mgs_require_platform($_GET['platform'] ?? null, 'fetch_matches', 'Historique des parties');

$accountId = mgs_resolve_public_account($slug, $platform, 'Compte manquant.');

$start = max(0, (int) ($_GET['start'] ?? 0));
$count = max(1, min((int) ($_GET['count'] ?? 5), MGS_MATCHES_COUNT_MAX));

$cacheFile = mgs_cache_file('matches', $slug, [$accountId, $start, $count]);
mgs_cache_serve($cacheFile, MGS_MATCHES_CACHE_TTL);

$result = mgs_provider_call(
    $slug,
    'fetch_matches',
    mgs_platform_config($slug),
    $accountId,
    $start,
    $count
);

if (!$result['ok']) {
    mgs_fail($result['status'] ?? 502, $result['error']);
}

mgs_cache_store_and_send($cacheFile, mgs_json_encode([
    'platform' => $slug,
    'matches'  => $result['matches'],
    'assets'   => $result['assets'] ?? null,
    'start'    => $result['start'] ?? $start,
    'count'    => $result['count'] ?? $count,
    'hasMore'  => $result['hasMore'] ?? false,
]));
