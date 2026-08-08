<?php
declare(strict_types=1);

session_start();

require_once __DIR__ . '/platforms.php';
require_once __DIR__ . '/links-model.php';
require_once __DIR__ . '/friends-model.php';

$config = require __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');

if (!isset($_SESSION['user_id'])) {
    echo json_encode(['connected' => false]);
    exit;
}

$viewerId = (int) $_SESSION['user_id'];
session_write_close();

$targetId = mgs_resolve_profile_target($conn, $viewerId, $_GET['userId'] ?? null);

if ($targetId === null) {
    http_response_code(403);
    echo json_encode([
        'connected' => true,
        'error'     => "Vous devez être ami avec cet utilisateur pour voir son profil.",
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$isOwnProfile = ($targetId === $viewerId);

$stmt = $conn->prepare('SELECT username, email FROM users WHERE id = ?');
$stmt->bind_param('i', $targetId);
$stmt->execute();
$user = $stmt->get_result()->fetch_assoc();
$stmt->close();

$links = mgs_get_user_links($conn, $targetId);

$links     = mgs_get_user_links($conn, $userId);
$platforms = [];

foreach (mgs_platforms() as $slug => $platform) {
    $platforms[] = [
        'slug'      => $slug,
        'label'     => $platform['label'],
        'icon'      => $platform['icon'],
        'enabled'   => $platform['enabled'],
        'linkable'  => $platform['linkable'],
        'accountId' => $links[$slug],
        'linked'    => $links[$slug] !== null,
    ];
}

echo json_encode([
    'connected'    => true,
    'userId'       => $targetId,
    'isOwnProfile' => $isOwnProfile,
    'username'     => $user['username'] ?? '',
    // l'email ne sort jamais du profil de son propriétaire
    'email'        => $isOwnProfile ? ($user['email'] ?? '') : null,
    'platforms'    => $platforms,
], JSON_UNESCAPED_UNICODE);