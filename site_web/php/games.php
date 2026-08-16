<?php
declare(strict_types=1);

/**
 * php/games.php — bibliothèque d'un profil connecté (ou d'un ami).
 *
 *   GET /php/games.php?platform=steam[&userId=42][&accountId=…]
 *
 * L'accountId transmis par le client est TOUJOURS recoupé avec la base
 * (mgs_resolve_owned_account) : sans ça, n'importe qui ferait scanner la
 * bibliothèque d'un tiers via notre serveur et notre clé d'API.
 */

require_once __DIR__ . '/core/bootstrap.php';
require_once __DIR__ . '/core/account-resolver.php';
require_once __DIR__ . '/friends-model.php';

mgs_session_start();
mgs_json_header();

$viewerId = mgs_require_login();

// Plus rien n'a besoin d'écrire en session : on la relâche pour ne pas
// sérialiser les requêtes parallèles du profil.
session_write_close();

$targetId = mgs_resolve_profile_target($conn, $viewerId, $_GET['userId'] ?? null);

if ($targetId === null) {
    mgs_fail(403, 'Vous devez être ami avec cet utilisateur.');
}

[$slug, $platform] = mgs_require_platform($_GET['platform'] ?? null, 'fetch_games', "La bibliothèque n'est pas disponible pour %s.");

$accountId = mgs_resolve_owned_account($conn, $targetId, $slug, $platform);

$result = mgs_provider_call($slug, 'fetch_games', mgs_platform_config($slug), $accountId);

if (!$result['ok']) {
    mgs_fail($result['status'] ?? 502, $result['error']);
}

mgs_json([
    'platform'  => $slug,
    'label'     => $platform['label'],
    'accountId' => $accountId,
    'games'     => $result['games'],
    'totals'    => $result['totals'],
]);
