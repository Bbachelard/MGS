<?php
declare(strict_types=1);

/**
 * signup/create_user.php — traitement du formulaire d'inscription.
 */

require_once __DIR__ . '/../php/core/bootstrap.php';

mgs_session_start();

/** Longueur minimale du mot de passe, alignée sur reset-password-process.php. */
const MGS_PASSWORD_MIN = 8;

if (mgs_is_logged()) {
    mgs_redirect('../logged/index.php');
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    mgs_redirect('../signup/index.php');
}

/** Redirige vers le formulaire en y déposant le message d'erreur. */
function mgs_signup_echec(string $message): never
{
    $_SESSION['signup_error'] = $message;
    mgs_redirect('../signup/index.php');
}

$username = trim((string) ($_POST['username'] ?? ''));
$email    = trim((string) ($_POST['email'] ?? ''));
$password = (string) ($_POST['password'] ?? '');

if ($username === '' || $email === '' || $password === '') {
    mgs_signup_echec('Tous les champs sont obligatoires.');
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    mgs_signup_echec('Adresse mail invalide.');
}

if (strlen($password) < MGS_PASSWORD_MIN) {
    mgs_signup_echec('Le mot de passe doit contenir au moins ' . MGS_PASSWORD_MIN . ' caractères.');
}

/* Contrôle d'unicité « à titre indicatif » : la vraie garantie est
   l'index unique en base, testé par le catch plus bas. Entre ce SELECT
   et l'INSERT, une autre inscription peut passer. */
$stmt = $conn->prepare('SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1');
$stmt->bind_param('ss', $username, $email);
$stmt->execute();
$existe = $stmt->get_result()->fetch_assoc() !== null;
$stmt->close();

if ($existe) {
    mgs_signup_echec("Ce nom d'utilisateur ou cette adresse mail est déjà utilisé.");
}

$passwordHash = password_hash($password, PASSWORD_DEFAULT);

try {
    $stmt = $conn->prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)');
    $stmt->bind_param('sss', $username, $email, $passwordHash);
    $ok     = $stmt->execute();
    $userId = (int) $conn->insert_id;
    $stmt->close();
} catch (mysqli_sql_exception $e) {
    if ((int) $e->getCode() === 1062) {
        mgs_signup_echec("Ce nom d'utilisateur ou cette adresse mail est déjà utilisé.");
    }

    error_log('mgs_create_user: ' . $e->getMessage());
    mgs_signup_echec('Une erreur est survenue, réessaie plus tard.');
}

if (!$ok || $userId <= 0) {
    mgs_signup_echec('Une erreur est survenue, réessaie plus tard.');
}

mgs_login($userId, $username);

mgs_redirect('../logged/index.php');
