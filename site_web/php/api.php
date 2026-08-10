<?php
declare(strict_types=1);

require_once __DIR__ . '/platforms.php';

header('Content-Type: application/json; charset=utf-8');

$config = require __DIR__ . '/../config.php';

function mgs_json_error(int $status, string $message): void
{
    http_response_code($status);
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

$slug = mgs_resolve_platform($_GET['platform'] ?? '');

if ($slug === null) {
    mgs_json_error(400, 'Plateforme inconnue.');
}

$platform = mgs_platform($slug);

if (!$platform['enabled'] || !mgs_load_provider($slug)) {
    mgs_json_error(501, $platform['label'] . " n'est pas encore disponible.");
}

// accountId direct (compte lié) ; "steamid" gardé pour compat
$accountId = trim((string)($_GET['accountId'] ?? $_GET['steamid'] ?? ''));
$pseudo    = trim((string)($_GET['pseudo'] ?? ''));

if ($accountId === '' && $pseudo === '') {
    mgs_json_error(400, 'Merci de saisir un pseudo.');
}

if ($accountId === '') {
    if (!$platform['searchable'] || !mgs_provider_supports($slug, 'resolve_account_id')) {
        mgs_json_error(501, 'La recherche par pseudo n\'est pas disponible pour ' . $platform['label'] . '.');
    }

    $resolved = mgs_provider_call($slug, 'resolve_account_id', $config['PLATFORMS'][$slug] ?? [], $pseudo);

    if (!$resolved['ok']) {
        mgs_json_error($resolved['status'] ?? 404, $resolved['error']);
    }

    $accountId = $resolved['accountId'];
}

/* --- Cache disque : les stats ne bougent pas à la minute, inutile de
       rappeler Steam / Riot à chaque affichage de page. --- */
const MGS_API_CACHE_TTL = 600;   // 10 minutes

$cacheDir = __DIR__ . '/../cache/api';

if (!is_dir($cacheDir)) {
    @mkdir($cacheDir, 0775, true);
}

$cacheFile = $cacheDir . '/' . $slug . '-' . sha1($accountId) . '.json';

// ?refresh=1 pour forcer un rafraîchissement (bouton "actualiser")
if (!isset($_GET['refresh'])
    && is_file($cacheFile)
    && (time() - filemtime($cacheFile)) < MGS_API_CACHE_TTL) {

    header('X-MGS-Cache: hit');
    readfile($cacheFile);
    exit;
}


$stats = mgs_provider_call($slug, 'fetch_stats', $config['PLATFORMS'][$slug] ?? [], $accountId);

if (!$stats['ok']) {
    mgs_json_error($stats['status'] ?? 502, $stats['error']);
}

$json = json_encode($stats['card'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

@file_put_contents($cacheFile, $json, LOCK_EX);

header('X-MGS-Cache: miss');
echo $json;