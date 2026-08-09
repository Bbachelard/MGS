<?php
declare(strict_types=1);

/**
 * Miroir public de games.php, mais pour une recherche anonyme (accueil),
 * exactement comme api.php l'est déjà pour les stats. Aucune session
 * requise : on résout l'accountId via pseudo (ou on prend l'accountId
 * fourni directement), avec la MÊME logique publique que api.php.
 *
 * Ne remplace pas games.php : celui-ci reste strictement réservé au
 * profil connecté / aux amis, avec l'accountId lu en base uniquement.
 */

require_once __DIR__ . '/platforms.php';

header('Content-Type: application/json; charset=utf-8');

$config = require __DIR__ . '/../config.php';

function mgs_games_public_error(int $status, string $message): never
{
    http_response_code($status);
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

$slug = mgs_resolve_platform($_GET['platform'] ?? '');

if ($slug === null) {
    mgs_games_public_error(400, 'Plateforme inconnue.');
}

$platform = mgs_platform($slug);

if (!$platform['enabled'] || !mgs_load_provider($slug) || !mgs_provider_supports($slug, 'fetch_games')) {
    mgs_games_public_error(501, 'Bibliothèque indisponible pour ' . $platform['label'] . '.');
}

// Même résolution publique que api.php : accountId direct, sinon pseudo.
$accountId = trim((string)($_GET['accountId'] ?? ''));
$pseudo    = trim((string)($_GET['pseudo'] ?? ''));

if ($accountId === '' && $pseudo === '') {
    mgs_games_public_error(400, 'Merci de saisir un pseudo.');
}

if ($accountId === '') {
    if (!$platform['searchable'] || !mgs_provider_supports($slug, 'resolve_account_id')) {
        mgs_games_public_error(501, 'La recherche par pseudo n\'est pas disponible pour ' . $platform['label'] . '.');
    }

    $resolved = mgs_provider_call($slug, 'resolve_account_id', $config['PLATFORMS'][$slug] ?? [], $pseudo);

    if (!$resolved['ok']) {
        mgs_games_public_error($resolved['status'] ?? 404, $resolved['error']);
    }

    $accountId = $resolved['accountId'];
}

$result = mgs_provider_call($slug, 'fetch_games', $config['PLATFORMS'][$slug] ?? [], $accountId);

if (!$result['ok']) {
    mgs_games_public_error($result['status'] ?? 502, $result['error']);
}

echo json_encode([
    'platform' => $slug,
    'label'    => $platform['label'],
    'games'    => $result['games'],
    'totals'   => $result['totals'],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);