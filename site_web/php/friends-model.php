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