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