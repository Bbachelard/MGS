<?php
declare(strict_types=1);

/**
 * php/reset-password-process.php — application d'un nouveau mot de passe.
 *
 *   POST token, password, password_confirm
 *
 * Tous les échecs renvoient au même endroit avec ?error=1 : le
 * formulaire n'a pas à distinguer « token expiré » de « mots de passe
 * différents », et un message plus précis renseignerait un attaquant
 * sur la validité d'un token.
 */

require_once __DIR__ . '/core/bootstrap.php';

mgs_session_start();

/** Doit rester aligné sur signup/create_user.php et le minlength du formulaire. */
const MGS_PASSWORD_MIN = 8;

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    mgs_redirect('../connexion/index.php');
}

$tokenBrut       = (string) ($_POST['token'] ?? '');
$password        = (string) ($_POST['password'] ?? '');
$passwordConfirm = (string) ($_POST['password_confirm'] ?? '');

/** Retour au formulaire en conservant le token. */
function mgs_echec_reset(string $token): never
{
    mgs_redirect('../connexion/reset-password.php?token=' . urlencode($token) . '&error=1');
}

if ($tokenBrut === ''
    || $password === ''
    || $password !== $passwordConfirm
    || strlen($password) < MGS_PASSWORD_MIN) {
    mgs_echec_reset($tokenBrut);
}

$tokenHash = hash('sha256', $tokenBrut);

$stmt = $conn->prepare(
    'SELECT id, user_id, expires_at FROM password_resets WHERE token_hash = ? LIMIT 1'
);
$stmt->bind_param('s', $tokenHash);
$stmt->execute();
$reset = $stmt->get_result()->fetch_assoc();
$stmt->close();

if ($reset === null || strtotime((string) $reset['expires_at']) <= time()) {
    mgs_echec_reset($tokenBrut);
}

$userId = (int) $reset['user_id'];
$hash   = password_hash($password, PASSWORD_DEFAULT);

$conn->begin_transaction();

try {
    $stmt = $conn->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
    $stmt->bind_param('si', $hash, $userId);
    $stmt->execute();
    $stmt->close();

    // Le token utilisé est supprimé, ainsi que tout autre token en
    // attente pour ce compte : un lien plus ancien resté dans une boîte
    // mail ne doit plus rien pouvoir.
    $stmt = $conn->prepare('DELETE FROM password_resets WHERE user_id = ?');
    $stmt->bind_param('i', $userId);
    $stmt->execute();
    $stmt->close();

    $conn->commit();
} catch (mysqli_sql_exception $e) {
    $conn->rollback();
    error_log('mgs_reset_process: ' . $e->getMessage());
    mgs_echec_reset($tokenBrut);
}

/* Le mot de passe a changé : on repart d'une session neuve. Une session
   ouverte ailleurs (l'attaquant, justement) ne doit pas survivre. */
mgs_logout();

mgs_redirect('../connexion/index.php?reset=success');
