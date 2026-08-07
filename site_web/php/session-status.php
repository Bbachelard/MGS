<?php
session_start();
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: https://my-gamers-stats.com/');
header('Access-Control-Allow-Credentials: true');
require __DIR__ . '/db.php';

if (!isset($_SESSION['user_id'])) {
    echo json_encode(['connected' => false]);
    exit;
}

$pdo = getPDO();
$stmt = $pdo->prepare('SELECT email FROM users WHERE id = ?');
$stmt->execute([$_SESSION['user_id']]);
$user = $stmt->fetch();

$stmt = $pdo->prepare('SELECT steam_id FROM steam_links WHERE user_id = ?');
$stmt->execute([$_SESSION['user_id']]);
$link = $stmt->fetch();

echo json_encode([
    'connected' => true,
    'email'     => $user['email'],
    'steamId'   => $link['steam_id'] ?? null,
]);