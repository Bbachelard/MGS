<?php
declare(strict_types=1);
session_start();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: ../connexion/forgot-password.php');
    exit;
}

require __DIR__ . '/../config.php'; // doit fournir $conn (mysqli)
require __DIR__ . '/mailer.php';

$email = trim((string) ($_POST['email'] ?? ''));
$redirect = '../connexion/forgot-password.php?sent=1';

// Adresse invalide : on redirige quand même vers le message générique
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    header('Location: ' . $redirect);
    exit;
}

$stmt = $conn->prepare('SELECT id, username, email FROM users WHERE email = ? LIMIT 1');
$stmt->bind_param('s', $email);
$stmt->execute();
$user = $stmt->get_result()->fetch_assoc();
$stmt->close();

if ($user !== null) {
    $userId = (int) $user['id'];

    // --- Anti-spam : pas plus d'une demande toutes les 2 minutes par compte ---
    $stmt = $conn->prepare('SELECT created_at FROM password_resets WHERE user_id = ? ORDER BY created_at DESC LIMIT 1');
    $stmt->bind_param('i', $userId);
    $stmt->execute();
    $dernier = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    $peutEnvoyer = true;
    if ($dernier !== null) {
        $tsDernier = strtotime((string) $dernier['created_at']);
        if ($tsDernier !== false && (time() - $tsDernier) < 120) {
            $peutEnvoyer = false;
        }
    }

    if ($peutEnvoyer) {
        $tokenBrut  = bin2hex(random_bytes(32));
        $tokenHash  = hash('sha256', $tokenBrut);
        $expiration = date('Y-m-d H:i:s', time() + 3600); // 1 heure

        $stmt = $conn->prepare(
            'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
        );
        $stmt->bind_param('iss', $userId, $tokenHash, $expiration);
        $stmt->execute();
        $stmt->close();

        $lien = 'https://my-gamers-stats.com/connexion/reset-password.php?token=' . urlencode($tokenBrut);

        try {
            mgs_send_password_reset_email((string) $user['email'], (string) $user['username'], $lien);
        } catch (\Throwable $e) {
            error_log('Erreur envoi email reset password : ' . $e->getMessage());
            // On ne révèle rien à l'utilisateur même en cas d'échec d'envoi
        }
    }
}

// Toujours la même redirection, compte existant ou non
header('Location: ' . $redirect);
exit;