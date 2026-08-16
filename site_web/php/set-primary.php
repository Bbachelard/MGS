<?php
declare(strict_types=1);

/**
 * php/set-primary.php — désigne un compte comme principal.
 *
 *   POST linkId=<id de platform_links>
 *
 * Le compte principal est celui dont l'avatar part dans la navbar.
 */

require_once __DIR__ . '/core/bootstrap.php';
require_once __DIR__ . '/links-model.php';

mgs_session_start();
mgs_json_header();

$userId = mgs_require_login();
mgs_require_method('POST');

$linkId = (int) ($_POST['linkId'] ?? 0);

if ($linkId <= 0) {
    mgs_fail(400, 'Compte non précisé.');
}

$result = mgs_set_primary($conn, $userId, $linkId);

if (!$result['ok']) {
    mgs_fail(404, $result['error']);
}

mgs_json([
    'success'  => true,
    'linkId'   => $linkId,
    'platform' => $result['platform'],
]);
