<?php
declare(strict_types=1);

/**
 * php/forgot-password-send.php — envoi du lien de réinitialisation.
 *
 * POST email=<adresse>
 *
 * Répond TOUJOURS par la même redirection (?sent=1), quel que soit le
 * résultat : dire « cet email n'existe pas » transformerait ce
 * formulaire en énumérateur de comptes.
 *
 * Les journaux ne contiennent ni email, ni pseudo, ni token — seulement
 * de quoi diagnostiquer une panne (RGPD : minimisation des données).
 */

session_start();

require_once __DIR__ . '/core/bootstrap.php';
require_once __DIR__ . '/mailer.php';

/** Délai minimum entre deux demandes pour un même compte (secondes). */
const MGS_RESET_COOLDOWN = 120;

/** Durée de validité du lien (secondes). Doit rester cohérent avec l'email. */
const MGS_RESET_TTL = 3600;

$redirect = '../connexion/forgot-password.php?sent=1';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    mgs_redirect('../connexion/forgot-password.php');
}

$email = trim((string) ($_POST['email'] ?? ''));

if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    mgs_redirect($redirect);
}

try {
    $user = mgs_reset_find_user($conn, $email);

    if ($user !== null && mgs_reset_cooldown_ecoule($conn, (int) $user['id'])) {
        mgs_reset_envoyer($conn, $user);
    }
} catch (\Throwable $e) {
    // On avale l'erreur côté utilisateur (réponse constante) mais on la
    // trace sans donnée personnelle pour pouvoir diagnostiquer.
    error_log('mgs_reset: ' . get_class($e) . ' — ' . $e->getMessage()
              . ' (' . $e->getFile() . ':' . $e->getLine() . ')');
}

mgs_redirect($redirect);

/* ================================================================== */

/** @return array{id:int, username:string, email:string}|null */
function mgs_reset_find_user(mysqli $conn, string $email): ?array
{
    $stmt = $conn->prepare('SELECT id, username, email FROM users WHERE email = ? LIMIT 1');
    $stmt->bind_param('s', $email);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    return $row === null ? null : [
        'id'       => (int) $row['id'],
        'username' => (string) $row['username'],
        'email'    => (string) $row['email'],
    ];
}

/**
 * Anti-martelage : au plus une demande toutes les MGS_RESET_COOLDOWN
 * secondes par compte. Sans ça, le formulaire sert de canon à spam
 * contre l'adresse d'un tiers.
 */
function mgs_reset_cooldown_ecoule(mysqli $conn, int $userId): bool
{
    $stmt = $conn->prepare(
        'SELECT created_at FROM password_resets
          WHERE user_id = ?
       ORDER BY created_at DESC
          LIMIT 1'
    );
    $stmt->bind_param('i', $userId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if ($row === null) {
        return true;
    }

    $ts = strtotime((string) $row['created_at']);

    return $ts === false || (time() - $ts) >= MGS_RESET_COOLDOWN;
}

/**
 * Crée le token, l'enregistre haché et envoie l'email.
 *
 * Seul le HACHÉ va en base : une fuite de la table password_resets ne
 * permet pas de réinitialiser un mot de passe.
 *
 * @param array{id:int, username:string, email:string} $user
 */
function mgs_reset_envoyer(mysqli $conn, array $user): void
{
    $tokenBrut = bin2hex(random_bytes(32));
    $tokenHash = hash('sha256', $tokenBrut);
    $expiration = date('Y-m-d H:i:s', time() + MGS_RESET_TTL);

    $stmt = $conn->prepare(
        'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
    );
    $stmt->bind_param('iss', $user['id'], $tokenHash, $expiration);

    if (!$stmt->execute()) {
        $stmt->close();
        throw new RuntimeException('INSERT password_resets a échoué.');
    }

    $stmt->close();

    $lien = rtrim(mgs_config('SITE_URL', 'https://my-gamers-stats.com'), '/')
          . '/connexion/reset-password.php?token=' . urlencode($tokenBrut);

    try {
        mgs_send_password_reset_email($user['email'], $user['username'], $lien);
    } catch (\Throwable $e) {
        // Le token reste valide : l'utilisateur peut redemander un envoi.
        error_log('mgs_reset SMTP: ' . get_class($e) . ' — ' . $e->getMessage());
    }
}
