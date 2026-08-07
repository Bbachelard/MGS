<?php

require __DIR__ . '/../config.php';


session_start();
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: https://my-gamers-stats.com/');
header('Access-Control-Allow-Credentials: true');

if (!isset($_SESSION['user_id'])) {
    echo json_encode(['connected' => false]);
    exit;
}

$userId = $_SESSION['user_id'];

$stmt = $conn->prepare('SELECT email FROM users WHERE id = ?');
$stmt->bind_param("i", $userId);
$stmt->execute();
$user = $stmt->get_result()->fetch_assoc();

$stmt = $conn->prepare('SELECT steam_id FROM steam_links WHERE user_id = ?');
$stmt->bind_param("i", $userId);
$stmt->execute();
$link = $stmt->get_result()->fetch_assoc();

echo json_encode([
    'connected' => true,
    'username'  => $user['username'],
    'email'     => $user['email'],
    'steamId'   => $link['steam_id'] ?? null,
]);