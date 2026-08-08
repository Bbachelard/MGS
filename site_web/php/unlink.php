<?php
declare(strict_types=1);

session_start();

require_once __DIR__ . '/platforms.php';
require_once __DIR__ . '/links-model.php';

$config = require __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');

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

$slug = mgs_resolve_platform($_POST['platform'] ?? '');

if ($slug === null) {
    http_response_code(400);
    echo json_encode(['error' => 'Plateforme inconnue.']);
    exit;
}

mgs_delete_link($conn, (int)$_SESSION['user_id'], $slug);

echo json_encode(['success' => true, 'platform' => $slug]);