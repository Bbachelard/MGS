<?php
declare(strict_types=1);

session_start();
header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../config.php';

function jsonError(int $status, string $message): never
{
    http_response_code($status);
    echo json_encode([
        'connected' => false,
        'error' => $message,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if (!isset($_SESSION['logged']) || $_SESSION['logged'] !== true || empty($_SESSION['user_id'])) {
    jsonError(401, 'Non connecté.');
}

$myId = (int) $_SESSION['user_id'];
$friendId = (int) ($_GET['id'] ?? 0);

if ($friendId <= 0) {
    jsonError(400, 'Identifiant invalide.');
}

if ($friendId === $myId) {
    jsonError(400, 'Utilisez votre propre profil pour consulter vos statistiques.');
}

// Vérifie côté serveur que la relation d'amitié est bien acceptée,
// quel que soit le sens sender/receiver.
$stmt = $conn->prepare(
    "SELECT 1
     FROM friendships
     WHERE status = 'accepted'
       AND (
            (sender_id = ? AND receiver_id = ?)
         OR (sender_id = ? AND receiver_id = ?)
       )
     LIMIT 1"
);

if ($stmt === false) {
    jsonError(500, 'Erreur serveur.');
}

$stmt->bind_param('iiii', $myId, $friendId, $friendId, $myId);
$stmt->execute();
$stmt->store_result();
$isFriend = $stmt->num_rows > 0;
$stmt->close();

if (!$isFriend) {
    jsonError(403, 'Vous devez être ami avec cet utilisateur pour voir son profil.');
}

// Récupère l'utilisateur et son éventuelle liaison Steam.
// LEFT JOIN permet de distinguer "utilisateur existant sans Steam" d'un utilisateur inexistant.
$stmt = $conn->prepare(
    "SELECT u.id, sl.steam_id
     FROM users AS u
     LEFT JOIN steam_links AS sl ON sl.user_id = u.id
     WHERE u.id = ?
     LIMIT 1"
);

if ($stmt === false) {
    jsonError(500, 'Erreur serveur.');
}

$stmt->bind_param('i', $friendId);
$stmt->execute();
$result = $stmt->get_result();
$row = $result->fetch_assoc();
$stmt->close();

if ($row === null) {
    jsonError(404, 'Utilisateur introuvable.');
}

echo json_encode([
    'connected' => true,
    'steamId' => $row['steam_id'] ?? null,
], JSON_UNESCAPED_UNICODE);