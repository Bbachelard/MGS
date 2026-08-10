<?php
declare(strict_types=1);

session_start();

require_once __DIR__ . '/platforms.php';
require_once __DIR__ . '/links-model.php';

$config = require __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');

/* ==================================================================
 *  Désigne un compte comme principal pour sa plateforme.
 *
 *  POST linkId=<id de platform_links>
 *
 *  Le compte principal est celui dont l'avatar part dans la navbar.
 * ================================================================== */

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

$linkId = (int)($_POST['linkId'] ?? 0);

if ($linkId <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'Compte non précisé.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$result = mgs_set_primary($conn, (int)$_SESSION['user_id'], $linkId);

if (!$result['ok']) {
    http_response_code(404);
    echo json_encode(['error' => $result['error']], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode([
    'success'  => true,
    'linkId'   => $linkId,
    'platform' => $result['platform'],
], JSON_UNESCAPED_UNICODE);