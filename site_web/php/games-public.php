<?php
declare(strict_types=1);

/**
 * php/games-public.php — bibliothèque d'un compte, recherche anonyme.
 *
 * Miroir public de games.php pour l'accueil, exactement comme api.php
 * l'est pour les stats : aucune session requise, l'accountId est résolu
 * depuis un pseudo ou fourni directement.
 *
 * Ne remplace pas games.php, qui reste strictement réservé au profil
 * connecté / aux amis avec un accountId lu en base uniquement.
 */

require_once __DIR__ . '/core/bootstrap.php';
require_once __DIR__ . '/core/account-resolver.php';

mgs_json_header();

[$slug, $platform] = mgs_require_platform($_GET['platform'] ?? null, 'fetch_games', 'Bibliothèque');

$accountId = mgs_resolve_public_account($slug, $platform);

$result = mgs_provider_call($slug, 'fetch_games', mgs_platform_config($slug), $accountId);

if (!$result['ok']) {
    mgs_fail($result['status'] ?? 502, $result['error']);
}

mgs_json([
    'platform' => $slug,
    'label'    => $platform['label'],
    'games'    => $result['games'],
    'totals'   => $result['totals'],
]);
