<?php
declare(strict_types=1);

session_start();

error_log('================ RESET PASSWORD ================');
error_log('[RESET] Début forgot-password-send.php');
error_log('[RESET] Méthode HTTP : ' . ($_SERVER['REQUEST_METHOD'] ?? 'INCONNUE'));

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    error_log('[RESET] Requête non POST -> redirection');
    header('Location: ../connexion/forgot-password.php');
    exit;
}

try {
    error_log('[RESET] Chargement config.php');
    require __DIR__ . '/../config.php';
    error_log('[RESET] config.php chargé');

    error_log('[RESET] Chargement mailer.php');
    require __DIR__ . '/mailer.php';
    error_log('[RESET] mailer.php chargé');
} catch (\Throwable $e) {
    error_log('[RESET] ERREUR chargement fichiers : ' . $e->getMessage());
    error_log('[RESET] Fichier : ' . $e->getFile() . ':' . $e->getLine());

    header('Location: ../connexion/forgot-password.php?sent=1');
    exit;
}

$email = trim((string) ($_POST['email'] ?? ''));
$redirect = '../connexion/forgot-password.php?sent=1';

error_log('[RESET] Email reçu : ' . $email);

// Adresse invalide
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    error_log('[RESET] Email vide ou invalide');
    header('Location: ' . $redirect);
    exit;
}

try {
    /*
     * Recherche de l'utilisateur
     */
    error_log('[RESET] Recherche utilisateur en BDD');

    $stmt = $conn->prepare(
        'SELECT id, username, email
         FROM users
         WHERE email = ?
         LIMIT 1'
    );

    if (!$stmt) {
        throw new RuntimeException(
            'Erreur prepare SELECT user : ' . $conn->error
        );
    }

    $stmt->bind_param('s', $email);
    $stmt->execute();

    $result = $stmt->get_result();
    $user = $result->fetch_assoc();

    $stmt->close();

    if ($user === null) {
        error_log('[RESET] Aucun utilisateur trouvé pour cet email');

        header('Location: ' . $redirect);
        exit;
    }

    error_log(
        '[RESET] Utilisateur trouvé : ID='
        . $user['id']
        . ' username='
        . $user['username']
        . ' email='
        . $user['email']
    );

    $userId = (int) $user['id'];

    /*
     * Vérification anti-spam
     */
    error_log('[RESET] Vérification anti-spam');

    $stmt = $conn->prepare(
        'SELECT created_at
         FROM password_resets
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 1'
    );

    if (!$stmt) {
        throw new RuntimeException(
            'Erreur prepare SELECT password_resets : ' . $conn->error
        );
    }

    $stmt->bind_param('i', $userId);
    $stmt->execute();

    $dernier = $stmt->get_result()->fetch_assoc();

    $stmt->close();

    $peutEnvoyer = true;

    if ($dernier !== null) {
        error_log(
            '[RESET] Dernière demande trouvée : '
            . $dernier['created_at']
        );

        $tsDernier = strtotime((string) $dernier['created_at']);

        if ($tsDernier !== false) {
            $age = time() - $tsDernier;

            error_log(
                '[RESET] Âge de la dernière demande : '
                . $age
                . ' seconde(s)'
            );

            if ($age < 120) {
                $peutEnvoyer = false;

                error_log(
                    '[RESET] ENVOI BLOQUÉ : délai anti-spam de 120 secondes'
                );
            }
        }
    } else {
        error_log('[RESET] Aucune demande précédente');
    }

    if ($peutEnvoyer) {
        error_log('[RESET] Création du token');

        $tokenBrut = bin2hex(random_bytes(32));
        $tokenHash = hash('sha256', $tokenBrut);

        $expiration = date(
            'Y-m-d H:i:s',
            time() + 3600
        );

        error_log(
            '[RESET] Expiration du token : '
            . $expiration
        );

        /*
         * Enregistrement du token en BDD
         */
        error_log('[RESET] Insertion du token en BDD');

        $stmt = $conn->prepare(
            'INSERT INTO password_resets
                (user_id, token_hash, expires_at)
             VALUES (?, ?, ?)'
        );

        if (!$stmt) {
            throw new RuntimeException(
                'Erreur prepare INSERT password_resets : '
                . $conn->error
            );
        }

        $stmt->bind_param(
            'iss',
            $userId,
            $tokenHash,
            $expiration
        );

        if (!$stmt->execute()) {
            throw new RuntimeException(
                'Erreur INSERT password_resets : '
                . $stmt->error
            );
        }

        error_log(
            '[RESET] Token enregistré en BDD, ID='
            . $stmt->insert_id
        );

        $stmt->close();

        /*
         * Construction du lien
         */
        $lien =
            'https://my-gamers-stats.com/connexion/reset-password.php?token='
            . urlencode($tokenBrut);

        error_log('[RESET] Lien de reset créé');
        // On ne log volontairement PAS le token.

        /*
         * Envoi SMTP
         */
        try {
            error_log('[RESET] Appel de mgs_send_password_reset_email()');

            mgs_send_password_reset_email(
                (string) $user['email'],
                (string) $user['username'],
                $lien
            );

            error_log(
                '[RESET] SUCCESS : fonction SMTP terminée sans exception'
            );
        } catch (\Throwable $e) {
            error_log(
                '[RESET] ERREUR SMTP : '
                . $e->getMessage()
            );

            error_log(
                '[RESET] Exception : '
                . get_class($e)
            );

            error_log(
                '[RESET] Fichier : '
                . $e->getFile()
                . ':'
                . $e->getLine()
            );

            error_log(
                '[RESET] Trace : '
                . $e->getTraceAsString()
            );
        }
    }
} catch (\Throwable $e) {
    error_log(
        '[RESET] ERREUR GÉNÉRALE : '
        . $e->getMessage()
    );

    error_log(
        '[RESET] Exception : '
        . get_class($e)
    );

    error_log(
        '[RESET] Fichier : '
        . $e->getFile()
        . ':'
        . $e->getLine()
    );

    error_log(
        '[RESET] Trace : '
        . $e->getTraceAsString()
    );
}

error_log('[RESET] Fin du traitement -> redirection');
error_log('================================================');

header('Location: ' . $redirect);
exit;
