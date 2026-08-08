<?php
declare(strict_types=1);

session_start();

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../config.php';

if (
    !isset($_SESSION['logged']) ||
    $_SESSION['logged'] !== true ||
    empty($_SESSION['user_id'])
) {
    http_response_code(401);

    echo json_encode([
        'connected' => false,
        'error' => 'Non connecté.'
    ]);

    exit;
}

$myId = (int) $_SESSION['user_id'];
$friendId = (int) ($_GET['id'] ?? 0);

if ($friendId <= 0) {
    http_response_code(400);

    echo json_encode([
        'connected' => false,
        'error' => 'Identifiant invalide.'
    ]);

    exit;
}


/*
 * Vérification de l'amitié.
 * L'amitié doit être acceptée, peu importe qui a envoyé
 * la demande à l'origine.
 */
$stmt = $conn->prepare("
    SELECT 1
    FROM friendships
    WHERE status = 'accepted'
      AND (
            (sender_id = ? AND receiver_id = ?)
         OR (sender_id = ? AND receiver_id = ?)
      )
    LIMIT 1
");

if (!$stmt) {
    http_response_code(500);

    echo json_encode([
        'connected' => false,
        'error' => 'Erreur serveur.'
    ]);

    exit;
}

$stmt->bind_param(
    "iiii",
    $myId,
    $friendId,
    $friendId,
    $myId
);

$stmt->execute();

$result = $stmt->get_result();
$isFriend = $result->num_rows > 0;

$stmt->close();

if (!$isFriend) {
    http_response_code(403);

    echo json_encode([
        'connected' => false,
        'error' => 'Vous devez être ami avec cet utilisateur.'
    ]);

    exit;
}


/*
 * Récupération du compte Steam de l'ami.
 */
$stmt = $conn->prepare("
    SELECT
        u.id,
        pl.platform_user_id
    FROM users u
    LEFT JOIN platform_links pl
        ON pl.user_id = u.id
       AND pl.platform = 'steam'
    WHERE u.id = ?
    LIMIT 1
");

if (!$stmt) {
    http_response_code(500);

    echo json_encode([
        'connected' => false,
        'error' => 'Erreur serveur.'
    ]);

    exit;
}

$stmt->bind_param("i", $friendId);
$stmt->execute();

$result = $stmt->get_result();
$user = $result->fetch_assoc();

$stmt->close();

if (!$user) {
    http_response_code(404);

    echo json_encode([
        'connected' => false,
        'error' => 'Utilisateur introuvable.'
    ]);

    exit;
}

echo json_encode([
    'connected' => true,
    'steamId' => $user['platform_user_id'] ?? null
]);

exit;