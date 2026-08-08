<?php
declare(strict_types=1);

require_once __DIR__ . '/platforms.php';

/**
 * @return array<string, ?string> ['steam' => '7656...', 'riot' => null, 'epic' => null]
 */
function mgs_get_user_links(mysqli $conn, int $userId): array
{
    $links = [];
    foreach (array_keys(mgs_platforms()) as $slug) {
        $links[$slug] = null;
    }

    $stmt = $conn->prepare(
        'SELECT platform, platform_user_id FROM platform_links WHERE user_id = ?'
    );
    $stmt->bind_param('i', $userId);
    $stmt->execute();
    $result = $stmt->get_result();

    while ($row = $result->fetch_assoc()) {
        if (array_key_exists($row['platform'], $links)) {
            $links[$row['platform']] = $row['platform_user_id'];
        }
    }
    $stmt->close();

    return $links;
}

function mgs_get_link(mysqli $conn, int $userId, string $platform): ?string
{
    $stmt = $conn->prepare(
        'SELECT platform_user_id FROM platform_links WHERE user_id = ? AND platform = ?'
    );
    $stmt->bind_param('is', $userId, $platform);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    return $row['platform_user_id'] ?? null;
}

/** Renvoie l'id du user MGS qui possède déjà ce compte, ou null. */
function mgs_get_link_owner(mysqli $conn, string $platform, string $accountId): ?int
{
    $stmt = $conn->prepare(
        'SELECT user_id FROM platform_links WHERE platform = ? AND platform_user_id = ?'
    );
    $stmt->bind_param('ss', $platform, $accountId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    return isset($row['user_id']) ? (int)$row['user_id'] : null;
}

function mgs_save_link(mysqli $conn, int $userId, string $platform, string $accountId): bool
{
    $stmt = $conn->prepare(
        'INSERT INTO platform_links (user_id, platform, platform_user_id)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE platform_user_id = VALUES(platform_user_id)'
    );
    $stmt->bind_param('iss', $userId, $platform, $accountId);
    $ok = $stmt->execute();
    $stmt->close();

    return $ok;
}

function mgs_delete_link(mysqli $conn, int $userId, string $platform): bool
{
    $stmt = $conn->prepare(
        'DELETE FROM platform_links WHERE user_id = ? AND platform = ?'
    );
    $stmt->bind_param('is', $userId, $platform);
    $ok = $stmt->execute();
    $stmt->close();

    return $ok;
}