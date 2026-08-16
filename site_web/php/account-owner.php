<?php
declare(strict_types=1);

/**
 * php/account-owner.php — un compte trouvé depuis l'accueil
 * appartient-il à un membre MGS ?
 *
 *   GET /php/account-owner.php?platform=Steam&accountId=76561198…
 *
 * Réponse volontairement minimale : id + pseudo MGS + état de la
 * relation avec le visiteur. Rien d'autre ne sort d'ici — surtout pas
 * l'email ni la liste des autres comptes liés.
 */

require_once __DIR__ . '/core/bootstrap.php';
require_once __DIR__ . '/links-model.php';
require_once __DIR__ . '/friends-model.php';

mgs_session_start();
mgs_json_header();

/** Réponse courte du cas le plus fréquent : compte non rattaché. */
function mgs_owner_inconnu(): never
{
    mgs_json(['isMember' => false]);
}

$slug      = mgs_resolve_platform($_GET['platform'] ?? '');
$accountId = trim((string) ($_GET['accountId'] ?? ''));

if ($slug === null || $accountId === '') {
    mgs_json(['isMember' => false], 400);
}

$ownerId = mgs_get_link_owner($conn, $slug, $accountId);

if ($ownerId === null) {
    mgs_owner_inconnu();
}

$stmt = $conn->prepare('SELECT username FROM users WHERE id = ? LIMIT 1');
$stmt->bind_param('i', $ownerId);
$stmt->execute();
$owner = $stmt->get_result()->fetch_assoc();
$stmt->close();

if ($owner === null) {
    // Ligne orpheline dans platform_links (utilisateur supprimé) : on ne
    // prétend pas qu'il y a un membre derrière.
    mgs_owner_inconnu();
}

$username = (string) $owner['username'];
$viewerId = mgs_user_id();

// Plus rien n'a besoin de la session : on la relâche pour ne pas bloquer
// les requêtes parallèles de l'accueil (api + games + celle-ci).
session_write_close();

if ($viewerId === null) {
    mgs_json([
        'isMember' => true,
        'username' => $username,
        'relation' => 'guest',
        'url'      => '/connexion/index.php',
    ]);
}

if ($viewerId === $ownerId) {
    mgs_json([
        'isMember' => true,
        'userId'   => $ownerId,
        'username' => $username,
        'relation' => 'self',
        'url'      => '/logged/index.php',
    ]);
}

$relation = mgs_friendship_state($conn, $viewerId, $ownerId);

/* friend           -> profil accessible
   pending_sent     -> demande déjà partie, on ne repropose pas
   pending_received -> à traiter dans l'inbox
   none             -> on propose l'ajout

   Pour l'ajout, on renvoie vers add_friend.php pré-rempli plutôt que
   d'insérer ici : la page tient déjà les contrôles (doublon, auto-ajout,
   refus antérieur) et il n'y a aucune raison de les réécrire. */
$urls = [
    'friend'           => '/logged/friend_profile.php?id=' . $ownerId,
    'pending_sent'     => '/logged/inbox.php',
    'pending_received' => '/logged/inbox.php',
    'none'             => '/logged/add_friend.php?q=' . rawurlencode($username),
];

mgs_json([
    'isMember' => true,
    'userId'   => $ownerId,
    'username' => $username,
    'relation' => $relation,
    'url'      => $urls[$relation] ?? $urls['none'],
]);
