<?php
declare(strict_types=1);

/**
 * php/unlink.php — délie un compte de plateforme.
 *
 *   POST linkId=<id de platform_links>
 *
 * On délie une LIAISON précise, plus une plateforme entière : avec
 * plusieurs comptes Riot, « platform=riot » ne désignerait plus rien.
 */

require_once __DIR__ . '/core/bootstrap.php';
require_once __DIR__ . '/links-model.php';

mgs_session_start();
mgs_json_header();

$userId = mgs_require_login();
mgs_require_method('POST');

$linkId = (int) ($_POST['linkId'] ?? 0);

if ($linkId <= 0) {
    mgs_fail(400, 'Compte à délier non précisé.');
}

$result = mgs_delete_link($conn, $userId, $linkId);

if (!$result['ok']) {
    mgs_fail(404, $result['error']);
}

mgs_json([
    'success'  => true,
    'linkId'   => $linkId,
    'platform' => $result['platform'],
]);
