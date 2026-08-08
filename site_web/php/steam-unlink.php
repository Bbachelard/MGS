<?php

session_start();
require __DIR__ . '/../config.php';
header('Content-Type: application/json');

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['error' => 'Session expirée, reconnecte-toi.']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Méthode non autorisée.']);
    exit;
}

$userId = $_SESSION['user_id'];

$stmt = $conn->prepare('DELETE FROM steam_links WHERE user_id = ?');
$stmt->bind_param("i", $userId);
$stmt->execute();

echo json_encode(['success' => true]);