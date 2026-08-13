<?php
declare(strict_types=1);

/* ==================================================================
 *  Un compte de plateforme (Steam / Riot / Epic) trouvé depuis
 *  l'accueil appartient-il à un membre MGS ?
 *
 *  Réponse volontairement minimale : id + pseudo MGS + état de la
 *  relation avec le visiteur. Rien d'autre ne sort d'ici — surtout
 *  pas l'email ni la liste des autres comptes liés.
 *
 *  GET /php/account-owner.php?platform=Steam&accountId=76561198…
 * ================================================================== */

session_start();

require_once __DIR__ . '/platforms.php';
require_once __DIR__ . '/links-model.php';
require_once __DIR__ . '/friends-model.php';

$config = require __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');

/* ---------------------------------------------------------
   Entrées
--------------------------------------------------------- */

$slug      = mgs_resolve_platform($_GET['platform'] ?? '');
$accountId = trim((string) ($_GET['accountId'] ?? ''));

if ($slug === null || $accountId === '') {
    http_response_code(400);
    echo json_encode(['isMember' => false], JSON_UNESCAPED_UNICODE);
    exit;
}

/* ---------------------------------------------------------
   Propriétaire du compte
--------------------------------------------------------- */

$ownerId = mgs_get_link_owner($conn, $slug, $accountId);

if ($ownerId === null) {
    // Compte non rattaché : cas le plus fréquent, on répond court.
    echo json_encode(['isMember' => false], JSON_UNESCAPED_UNICODE);
    exit;
}

$stmt = $conn->prepare('SELECT username FROM users WHERE id = ? LIMIT 1');
$stmt->bind_param('i', $ownerId);
$stmt->execute();
$owner = $stmt->get_result()->fetch_assoc();
$stmt->close();

if ($owner === null) {
    // Ligne orpheline dans platform_links (user supprimé) : on ne
    // prétend pas qu'il y a un membre derrière.
    echo json_encode(['isMember' => false], JSON_UNESCAPED_UNICODE);
    exit;
}

$username = (string) $owner['username'];

/* ---------------------------------------------------------
   Relation avec le visiteur
--------------------------------------------------------- */

$viewerId = isset($_SESSION['user_id']) ? (int) $_SESSION['user_id'] : 0;

// Plus rien n'a besoin de la session : on la relâche pour ne pas
// bloquer les requêtes parallèles de l'accueil (api + games + celle-ci).
session_write_close();

if ($viewerId <= 0) {
    echo json_encode([
        'isMember' => true,
        'username' => $username,
        'relation' => 'guest',
        'url'      => '/connexion/index.php',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($viewerId === $ownerId) {
    echo json_encode([
        'isMember' => true,
        'userId'   => $ownerId,
        'username' => $username,
        'relation' => 'self',
        'url'      => '/logged/index.php',
    ], JSON_UNESCAPED_UNICODE);
    exit;
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

echo json_encode([
    'isMember' => true,
    'userId'   => $ownerId,
    'username' => $username,
    'relation' => $relation,
    'url'      => $urls[$relation] ?? $urls['none'],
], JSON_UNESCAPED_UNICODE);
