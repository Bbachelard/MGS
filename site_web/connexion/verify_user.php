<?php
declare(strict_types=1);

/**
 * connexion/verify_user.php — traitement du formulaire de connexion.
 *
 * Le message d'erreur est volontairement le même que l'identifiant
 * n'existe pas ou que le mot de passe soit faux : distinguer les deux
 * permettrait d'énumérer les comptes du site.
 */

require_once __DIR__ . '/../php/core/bootstrap.php';

mgs_session_start();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    mgs_redirect('index.php');
}

$username = trim((string) ($_POST['username'] ?? ''));
$password = (string) ($_POST['password'] ?? '');

if ($username === '' || $password === '') {
    mgs_redirect('index.php?error=invalid');
}

$stmt = $conn->prepare('SELECT id, password_hash FROM users WHERE username = ? LIMIT 1');
$stmt->bind_param('s', $username);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

/* password_verify() est appelé même sans utilisateur, sur un haché
   factice : sans ça, le temps de réponse trahirait l'existence du
   compte (attaque temporelle). */
const MGS_DUMMY_HASH = '$2y$12$3uhneKa2cdj.qya4jmvCC.DmnVnSovuKmZ6tUE/1/FP2mA1dzaKmC';

$hash = (string) ($row['password_hash'] ?? MGS_DUMMY_HASH);

if ($row === null || !password_verify($password, $hash)) {
    mgs_redirect('index.php?error=invalid');
}

mgs_login((int) $row['id'], $username);

mgs_redirect('../logged/index.php');
