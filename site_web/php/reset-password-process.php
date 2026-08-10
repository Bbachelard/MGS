<?php
declare(strict_types=1);
session_start();
require __DIR__ . '/../config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: ../connexion/index.php');
    exit;
}

$tokenBrut       = (string) ($_POST['token'] ?? '');
$password        = (string) ($_POST['password'] ?? '');
$passwordConfirm = (string) ($_POST['password_confirm'] ?? '');

function mgs_echec_reset(string $token): void
{
    header('Location: ../connexion/reset-password.php?token=' . urlencode($token) . '&error=1');
    exit;
}

if ($tokenBrut === '' || $password === '' || $passwordConfirm === '') {
    mgs_echec_reset($tokenBrut);
}

if ($password !== $passwordConfirm) {
    mgs_echec_reset($tokenBrut);
}

if (strlen($password) < 8) {
    mgs_echec_reset($tokenBrut);
}

$tokenHash = hash('sha256', $tokenBrut);

$stmt = $conn->prepare('SELECT id, user_id, expires_at FROM password_resets WHERE token_hash = ? LIMIT 1');
$stmt->bind_param('s', $tokenHash);
$stmt->execute();
$reset = $stmt->get_result()->fetch_assoc();
$stmt->close();

if ($reset === null || strtotime((string) $reset['expires_at']) <= time()) {
    mgs_echec_reset($tokenBrut);
}

$userId = (int) $reset['user_id'];
$hash   = password_hash($password, PASSWORD_DEFAULT);

$stmt = $conn->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
$stmt->bind_param('si', $hash, $userId);
$stmt->execute();
$stmt->close();

// Le token utilisé est supprimé, ainsi que tout autre token en attente pour ce compte
$stmt = $conn->prepare('DELETE FROM password_resets WHERE user_id = ?');
$stmt->bind_param('i', $userId);
$stmt->execute();
$stmt->close();

header('Location: ../connexion/index.php?reset=success');
exit;