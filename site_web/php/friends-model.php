<?php
declare(strict_types=1);

/** Vrai si les deux utilisateurs sont amis (demande acceptée). */
function mgs_are_friends(mysqli $conn, int $userA, int $userB): bool
{
    $stmt = $conn->prepare(
        "SELECT 1 FROM friendships
         WHERE status = 'accepted'
           AND ((sender_id = ? AND receiver_id = ?)
             OR (sender_id = ? AND receiver_id = ?))
         LIMIT 1"
    );
    $stmt->bind_param('iiii', $userA, $userB, $userB, $userA);
    $stmt->execute();
    $stmt->store_result();
    $ok = $stmt->num_rows > 0;
    $stmt->close();

    return $ok;
}

/**
 * Id du profil à afficher.
 *   null / 0 / soi-même  -> son propre profil
 *   un ami accepté       -> le profil de l'ami
 *   tout le reste        -> null (interdit)
 */
function mgs_resolve_profile_target(mysqli $conn, int $viewerId, mixed $requested): ?int
{
    $targetId = (int) ($requested ?? 0);

    if ($targetId <= 0 || $targetId === $viewerId) {
        return $viewerId;
    }

    return mgs_are_friends($conn, $viewerId, $targetId) ? $targetId : null;
}


/**
 * État de la relation entre deux utilisateurs, du point de vue de $viewerId.
 *
 * Retourne : 'friend' | 'pending_sent' | 'pending_received' | 'none'
 *
 * Un refus antérieur ('refused' / 'declined' en base) est traité comme
 * 'none' : rien n'interdit de retenter, et c'est add_friend.php qui
 * arbitre au moment de l'envoi.
 */
function mgs_friendship_state(mysqli $conn, int $viewerId, int $otherId): string
{
    $stmt = $conn->prepare(
        "SELECT sender_id, status FROM friendships
          WHERE (sender_id = ? AND receiver_id = ?)
             OR (sender_id = ? AND receiver_id = ?)
          LIMIT 1"
    );
    $stmt->bind_param('iiii', $viewerId, $otherId, $otherId, $viewerId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if ($row === null) {
        return 'none';
    }

    if ($row['status'] === 'accepted') {
        return 'friend';
    }

    if ($row['status'] === 'pending') {
        return ((int) $row['sender_id'] === $viewerId)
            ? 'pending_sent'
            : 'pending_received';
    }

    return 'none';
}
/* ==================================================================
 *  Requêtes de liste, remontées ici depuis logged/inbox.php et
 *  logged/add_friend.php, qui écrivaient chacun leur SQL en pleine
 *  page HTML.
 * ================================================================== */

/**
 * Demandes d'ami reçues et encore en attente.
 *
 * @return list<array{friendship_id:int, user_id:int, username:string}>
 */
function mgs_pending_requests(mysqli $conn, int $userId): array
{
    $stmt = $conn->prepare(
        "SELECT f.id AS friendship_id, u.id AS user_id, u.username
           FROM friendships f
           INNER JOIN users u ON u.id = f.sender_id
          WHERE f.receiver_id = ? AND f.status = 'pending'
       ORDER BY f.id DESC"
    );
    $stmt->bind_param('i', $userId);
    $stmt->execute();
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    return $rows;
}

/**
 * Liste des amis acceptés, quel que soit qui a envoyé la demande.
 *
 * @return list<array{id:int, username:string}>
 */
function mgs_friend_list(mysqli $conn, int $userId): array
{
    $stmt = $conn->prepare(
        "SELECT u.id, u.username
           FROM friendships f
           INNER JOIN users u
                   ON u.id = CASE WHEN f.sender_id = ? THEN f.receiver_id ELSE f.sender_id END
          WHERE f.status = 'accepted'
            AND (f.sender_id = ? OR f.receiver_id = ?)
       ORDER BY u.username ASC"
    );
    $stmt->bind_param('iii', $userId, $userId, $userId);
    $stmt->execute();
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    return $rows;
}

/**
 * Accepte ou refuse une demande reçue.
 *
 * receiver_id et status='pending' sont dans le WHERE : une demande qui
 * ne t'est pas destinée, ou déjà traitée, ne touche aucune ligne. Le
 * contrôle de propriété n'a donc pas à être fait en amont.
 *
 * @param  string $action 'accept' ou 'refuse'
 * @return array{type:string, text:string}  bannière à afficher
 */
function mgs_answer_request(mysqli $conn, int $userId, int $friendshipId, string $action): array
{
    if (!in_array($action, ['accept', 'refuse'], true)) {
        return ['type' => 'error', 'text' => 'Action invalide.'];
    }

    $sql = $action === 'accept'
        ? "UPDATE friendships SET status = 'accepted'
            WHERE id = ? AND receiver_id = ? AND status = 'pending'"
        : "DELETE FROM friendships
            WHERE id = ? AND receiver_id = ? AND status = 'pending'";

    $stmt = $conn->prepare($sql);
    $stmt->bind_param('ii', $friendshipId, $userId);
    $ok      = $stmt->execute();
    $touchee = $stmt->affected_rows > 0;
    $stmt->close();

    if (!$ok) {
        return ['type' => 'error', 'text' => 'Une erreur est survenue.'];
    }

    if (!$touchee) {
        return ['type' => 'error', 'text' => "Cette demande n'existe pas ou a déjà été traitée."];
    }

    return [
        'type' => 'success',
        'text' => $action === 'accept' ? "Demande d'ami acceptée." : "Demande d'ami refusée.",
    ];
}

/**
 * Envoie une demande d'ami.
 *
 * @return array{type:string, text:string}  bannière à afficher
 */
function mgs_send_request(mysqli $conn, int $userId, int $targetId): array
{
    if ($targetId <= 0 || $targetId === $userId) {
        return ['type' => 'error', 'text' => "Tu ne peux pas t'ajouter toi-même."];
    }

    $stmt = $conn->prepare('SELECT id FROM users WHERE id = ? LIMIT 1');
    $stmt->bind_param('i', $targetId);
    $stmt->execute();
    $existe = $stmt->get_result()->fetch_assoc() !== null;
    $stmt->close();

    if (!$existe) {
        return ['type' => 'error', 'text' => "Cet utilisateur n'existe pas."];
    }

    $etat = mgs_friendship_state($conn, $userId, $targetId);

    $refus = [
        'friend'           => 'Vous êtes déjà amis.',
        'pending_sent'     => 'Demande déjà envoyée, en attente de réponse.',
        'pending_received' => "Cet utilisateur t'a déjà envoyé une demande d'ami.",
    ];

    if (isset($refus[$etat])) {
        return ['type' => 'error', 'text' => $refus[$etat]];
    }

    try {
        $stmt = $conn->prepare('INSERT INTO friendships (sender_id, receiver_id) VALUES (?, ?)');
        $stmt->bind_param('ii', $userId, $targetId);
        $ok = $stmt->execute();
        $stmt->close();
    } catch (mysqli_sql_exception $e) {
        error_log('mgs_send_request: ' . $e->getMessage());
        $ok = false;
    }

    return $ok
        ? ['type' => 'success', 'text' => "Demande d'ami envoyée."]
        : ['type' => 'error', 'text' => 'Une erreur est survenue, réessaie plus tard.'];
}

/**
 * Recherche d'utilisateurs par pseudo, avec l'état de la relation.
 *
 * Les jokers du LIKE sont échappés : sans ça, taper « % » ramenait
 * l'annuaire entier du site.
 *
 * @return list<array{id:int, username:string, relation:?array{status:string, isSender:bool}}>
 */
function mgs_search_users(mysqli $conn, int $viewerId, string $query, int $limit = 20): array
{
    $query = trim($query);

    if ($query === '') {
        return [];
    }

    require_once __DIR__ . '/suggest-model.php';   // mgs_like_escape()

    $like  = '%' . mgs_like_escape($query) . '%';
    $limit = max(1, min($limit, 50));

    $stmt = $conn->prepare(
        "SELECT id, username FROM users
          WHERE username LIKE ? ESCAPE '!' AND id <> ?
       ORDER BY username
          LIMIT ?"
    );
    $stmt->bind_param('sii', $like, $viewerId, $limit);
    $stmt->execute();
    $results = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    if ($results === []) {
        return [];
    }

    /* Une seule requête pour toutes les relations, plutôt qu'un
       mgs_friendship_state() par ligne affichée. */
    $ids     = array_map('intval', array_column($results, 'id'));
    $trous   = implode(',', array_fill(0, count($ids), '?'));
    $params  = array_merge([$viewerId], $ids, [$viewerId], $ids);

    $stmt = $conn->prepare(
        "SELECT sender_id, receiver_id, status FROM friendships
          WHERE (sender_id = ? AND receiver_id IN ($trous))
             OR (receiver_id = ? AND sender_id IN ($trous))"
    );
    $stmt->bind_param(str_repeat('i', count($params)), ...$params);
    $stmt->execute();
    $relations = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    $parUtilisateur = [];

    foreach ($relations as $rel) {
        $estEmetteur = (int) $rel['sender_id'] === $viewerId;
        $autre       = $estEmetteur ? (int) $rel['receiver_id'] : (int) $rel['sender_id'];

        $parUtilisateur[$autre] = [
            'status'   => (string) $rel['status'],
            'isSender' => $estEmetteur,
        ];
    }

    foreach ($results as &$ligne) {
        $ligne['id']       = (int) $ligne['id'];
        $ligne['relation'] = $parUtilisateur[$ligne['id']] ?? null;
    }
    unset($ligne);

    return $results;
}
