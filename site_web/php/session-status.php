<?php
declare(strict_types=1);

session_start();

require_once __DIR__ . '/platforms.php';
require_once __DIR__ . '/links-model.php';

$config = require __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');

if (!isset($_SESSION['user_id'])) {
    echo json_encode(['connected' => false]);
    exit;
}

$userId = (int)$_SESSION['user_id'];
session_write_close();

$stmt = $conn->prepare('SELECT username, email FROM users WHERE id = ?');
$stmt->bind_param('i', $userId);
$stmt->execute();
$user = $stmt->get_result()->fetch_assoc();
$stmt->close();

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
    'connected' => true,
    'username'  => $user['username'] ?? '',
    'email'     => $user['email'] ?? '',
    'platforms' => $platforms,
], JSON_UNESCAPED_UNICODE);