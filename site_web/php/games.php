<?php
declare(strict_types=1);

session_start();

require_once __DIR__ . '/platforms.php';
require_once __DIR__ . '/links-model.php';
require_once __DIR__ . '/friends-model.php';

$config = require __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');

function mgs_games_error(int $status, string $message): never
{
    http_response_code($status);
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

if (!isset($_SESSION['user_id'])) {
    mgs_games_error(401, 'Session expirée, reconnecte-toi.');
}
$viewerId = (int) $_SESSION['user_id'];
session_write_close();

$targetId = mgs_resolve_profile_target($conn, $viewerId, $_GET['userId'] ?? null);

if ($targetId === null) {
    mgs_games_error(403, "Vous devez être ami avec cet utilisateur.");
}

$slug = mgs_resolve_platform($_GET['platform'] ?? '');

if ($slug === null) {
    mgs_games_error(400, 'Plateforme inconnue.');
}

$platform = mgs_platform($slug);

if (!$platform['enabled'] || !mgs_load_provider($slug) || !mgs_provider_supports($slug, 'fetch_games')) {
    mgs_games_error(501, 'Bibliothèque indisponible pour ' . $platform['label'] . '.');
}

// accountId lu en base, jamais depuis l'URL : sinon n'importe qui pourrait
// faire scanner la bibliothèque d'un tiers via notre serveur et notre clé API.
$accountId = mgs_get_link($conn, $targetId, $slug);

if ($accountId === null) {
    mgs_games_error(404, 'Aucun compte ' . $platform['label'] . ' lié.');
}

$result = mgs_provider_call($slug, 'fetch_games', $config['PLATFORMS'][$slug] ?? [], $accountId);

if (!$result['ok']) {
    mgs_games_error($result['status'] ?? 502, $result['error']);
}

echo json_encode([
    'platform' => $slug,
    'label'    => $platform['label'],
    'games'    => $result['games'],
    'totals'   => $result['totals'],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);