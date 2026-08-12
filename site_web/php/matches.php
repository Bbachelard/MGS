<?php
declare(strict_types=1);

/**
 * php/matches.php — pagination des dernières parties.
 *
 * Appelé par le bouton « Voir plus » de match-detail.js. Même logique de
 * résolution que api.php : accountId direct si on l'a, sinon pseudo.
 *
 * Le premier lot (les 5 parties affichées d'emblée) est déjà dans la réponse
 * d'api.php : cet endpoint ne sert QUE pour start > 0.
 *
 *   GET /php/matches.php?platform=riot&accountId=euw1:xxx&start=5&count=5
 *   GET /php/matches.php?platform=riot&pseudo=BlackBen%23BOZO&start=5
 *
 * Réponse :
 *   { platform, matches: [...], assets: {...}, start, count, hasMore }
 */

require_once __DIR__ . '/platforms.php';

header('Content-Type: application/json; charset=utf-8');

$config = require __DIR__ . '/../config.php';

/** Durée de vie d'une page de parties. Les parties elles-mêmes ont leur
 *  propre cache long dans le provider : ici on ne met en cache que la
 *  liste, qui bouge dès que le joueur fait une nouvelle partie. */
const MGS_MATCHES_CACHE_TTL = 900;   // 15 minutes

function mgs_matches_error(int $status, string $message): never
{
    http_response_code($status);
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

$slug = mgs_resolve_platform($_GET['platform'] ?? '');

if ($slug === null) {
    mgs_matches_error(400, 'Plateforme inconnue.');
}

$platform = mgs_platform($slug);

if (!$platform['enabled'] || !mgs_load_provider($slug) || !mgs_provider_supports($slug, 'fetch_matches')) {
    mgs_matches_error(501, 'Historique des parties indisponible pour ' . $platform['label'] . '.');
}

/* --- Résolution du compte (identique à api.php) --- */
$accountId = trim((string)($_GET['accountId'] ?? ''));
$pseudo    = trim((string)($_GET['pseudo'] ?? ''));

if ($accountId === '' && $pseudo === '') {
    mgs_matches_error(400, 'Compte manquant.');
}

if ($accountId === '') {
    if (!$platform['searchable'] || !mgs_provider_supports($slug, 'resolve_account_id')) {
        mgs_matches_error(501, 'La recherche par pseudo n\'est pas disponible pour ' . $platform['label'] . '.');
    }

    $resolved = mgs_provider_call($slug, 'resolve_account_id', $config['PLATFORMS'][$slug] ?? [], $pseudo);

    if (!$resolved['ok']) {
        mgs_matches_error($resolved['status'] ?? 404, $resolved['error']);
    }

    $accountId = $resolved['accountId'];
}

/* --- Pagination bornée côté serveur --- */
$start = max(0, (int)($_GET['start'] ?? 0));
$count = (int)($_GET['count'] ?? 5);
$count = max(1, min($count, 10));

/* --- Cache disque --- */
$cacheDir = __DIR__ . '/../cache/matches';

if (!is_dir($cacheDir)) {
    @mkdir($cacheDir, 0775, true);
}

$cacheFile = sprintf(
    '%s/%s-%s-%d-%d.json',
    $cacheDir,
    $slug,
    sha1($accountId),
    $start,
    $count
);

if (!isset($_GET['refresh'])
    && is_file($cacheFile)
    && (time() - filemtime($cacheFile)) < MGS_MATCHES_CACHE_TTL) {

    header('X-MGS-Cache: hit');
    readfile($cacheFile);
    exit;
}

$result = mgs_provider_call(
    $slug,
    'fetch_matches',
    $config['PLATFORMS'][$slug] ?? [],
    $accountId,
    $start,
    $count
);

if (!$result['ok']) {
    mgs_matches_error($result['status'] ?? 502, $result['error']);
}

$json = json_encode([
    'platform' => $slug,
    'matches'  => $result['matches'],
    'assets'   => $result['assets'] ?? null,
    'start'    => $result['start'] ?? $start,
    'count'    => $result['count'] ?? $count,
    'hasMore'  => $result['hasMore'] ?? false,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

@file_put_contents($cacheFile, $json, LOCK_EX);

header('X-MGS-Cache: miss');
echo $json;