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

require_once __DIR__ . '/cache.php';

$cle = "card:{$slug}:{$accountId}";

if ($cachee = mgs_cache_get($cle, 300)) {           // 5 min
    header('X-Cache: HIT');
    echo json_encode($cachee, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$stats = mgs_provider_call($slug, 'fetch_stats', $config['PLATFORMS'][$slug] ?? [], $accountId);

if (!$stats['ok']) {
    mgs_json_error($stats['status'] ?? 502, $stats['error']);
}

mgs_cache_set($cle, $stats['card']);
header('X-Cache: MISS');
echo json_encode($stats['card'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

$stats = mgs_provider_call($slug, 'fetch_stats', $config['PLATFORMS'][$slug] ?? [], $accountId);

if (!$stats['ok']) {
    mgs_json_error($stats['status'] ?? 502, $stats['error']);
}

echo json_encode($stats['card'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);