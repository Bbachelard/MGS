<?php
declare(strict_types=1);

/**
 * php/session-status.php — état du profil affiché.
 *
 *   GET /php/session-status.php[?userId=42]
 *
 * Renvoie le pseudo, et pour chaque plateforme la liste des comptes
 * liés (principal en tête) plus ce que le visiteur a le droit de faire.
 * L'email ne sort jamais du profil de son propriétaire.
 */

require_once __DIR__ . '/core/bootstrap.php';
require_once __DIR__ . '/links-model.php';
require_once __DIR__ . '/friends-model.php';

mgs_session_start();
mgs_json_header();

if (!mgs_is_logged()) {
    mgs_json(['connected' => false]);
}

$viewerId = mgs_user_id();
session_write_close();

$targetId = mgs_resolve_profile_target($conn, $viewerId, $_GET['userId'] ?? null);

if ($targetId === null) {
    mgs_json([
        'connected' => true,
        'error'     => 'Vous devez être ami avec cet utilisateur pour voir son profil.',
    ], 403);
}

$isOwnProfile = ($targetId === $viewerId);

$stmt = $conn->prepare('SELECT username, email FROM users WHERE id = ? LIMIT 1');
$stmt->bind_param('i', $targetId);
$stmt->execute();
$user = $stmt->get_result()->fetch_assoc();
$stmt->close();

$comptes   = mgs_get_user_accounts($conn, $targetId);
$platforms = [];

foreach (mgs_platforms() as $slug => $platform) {
    $liste = $comptes[$slug] ?? [];
    $max   = mgs_max_accounts($slug);

    $aBibliotheque = $platform['enabled']
                     && mgs_load_provider($slug)
                     && mgs_provider_supports($slug, 'fetch_games');

    $platforms[] = [
        'slug'        => $slug,
        'label'       => $platform['label'],
        'icon'        => $platform['icon'],
        'enabled'     => $platform['enabled'],
        'linkable'    => $platform['linkable'],
        'verifiable'  => !empty($platform['verifiable']),
        'hasLibrary'  => $aBibliotheque,
        'maxAccounts' => $max,

        // Un objet par compte lié, principal en tête.
        'accounts'    => array_map(
            static fn (array $c): array => [
                'id'        => $c['id'],
                'accountId' => $c['accountId'],
                'isPrimary' => $c['isPrimary'],
            ],
            $liste
        ),

        'linked'      => $liste !== [],

        // Champ historique : vaut le compte principal. Gardé pour que
        // le reste du site (recherche, liens directs) ne casse pas.
        'accountId'   => $liste[0]['accountId'] ?? null,

        // Le bouton « ajouter » ne s'affiche que sur son propre profil
        // et tant que le quota n'est pas atteint.
        'canAdd'      => $isOwnProfile
                         && $platform['enabled']
                         && (!empty($platform['linkable']) || !empty($platform['verifiable']))
                         && count($liste) < $max,
    ];
}

mgs_json([
    'connected'    => true,
    'userId'       => $targetId,
    'isOwnProfile' => $isOwnProfile,
    'username'     => $user['username'] ?? '',
    'email'        => $isOwnProfile ? ($user['email'] ?? '') : null,
    'platforms'    => $platforms,
]);
