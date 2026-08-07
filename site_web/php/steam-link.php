<?php
session_start();
require __DIR__ . '/vendor/autoload.php';
$config = require __DIR__ . '/../config.php'; 

use xPaw\SteamOpenID\SteamOpenID;
use xPaw\SteamOpenID\SteamOpenIDException;

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    exit('Session expirée, reconnecte-toi.');
}

$steam = new SteamOpenID($config['SITE_URL'] . '/php/steam-link-callback.php');

try {
    $steamId = $steam->Validate();
} catch (SteamOpenIDException $e) {
    http_response_code(400);
    exit('Authentification Steam invalide.');
}

$userId = $_SESSION['user_id'];


$stmt = $conn->prepare('SELECT user_id FROM steam_links WHERE steam_id = ?');
$stmt->bind_param("s", $steamId);
$stmt->execute();
$existing = $stmt->get_result()->fetch_assoc();

if ($existing && (int)$existing['user_id'] !== (int)$userId) {
    header('Location: ' . $config['SITE_URL'] . '/index.html?error=steam_deja_lie');
    exit;
}

$stmt = $conn->prepare(
    'INSERT INTO steam_links (user_id, steam_id) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE steam_id = VALUES(steam_id)'
);
$stmt->bind_param("is", $userId, $steamId);
$stmt->execute();

header('Location: ' . $config['SITE_URL'] . '/index.html?linked=1');
exit;