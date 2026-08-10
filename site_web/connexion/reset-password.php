<?php
declare(strict_types=1);
session_start();
require __DIR__ . '/../config.php';

$tokenBrut = (string) ($_GET['token'] ?? '');
$tokenValide = false;

if ($tokenBrut !== '') {
    $tokenHash = hash('sha256', $tokenBrut);
    $stmt = $conn->prepare('SELECT id, expires_at FROM password_resets WHERE token_hash = ? LIMIT 1');
    $stmt->bind_param('s', $tokenHash);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if ($row !== null && strtotime((string) $row['expires_at']) > time()) {
        $tokenValide = true;
    }
}
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Réinitialisation du mot de passe — My Gamers Stats</title>
    <link rel="stylesheet" href="../content/css/stylesheet.css">
    <link rel="stylesheet" href="../content/css/styleLogin.css">
</head>
<body>
    <div class="page">
        <div class="login-wrapper">
            <?php if (!$tokenValide): ?>
                <h1>Lien invalide</h1>
                <p>Ce lien de réinitialisation est invalide ou a expiré.</p>
                <div class="form-actions">
                    <a href="./forgot-password.php" class="button">Demander un nouveau lien</a>
                </div>
            <?php else: ?>
                <form action="../php/reset-password-process.php" method="post" class="form_connect">
                    <h1>Nouveau mot de passe</h1>
                    <p>Choisis un nouveau mot de passe pour ton compte.</p>

                    <?php if (isset($_GET['error'])): ?>
                        <p class="reset-error">Les mots de passe ne correspondent pas, sont trop courts, ou le lien a expiré entre-temps.</p>
                    <?php endif; ?>

                    <input type="hidden" name="token" value="<?= htmlspecialchars($tokenBrut, ENT_QUOTES, 'UTF-8') ?>">

                    <div class="form-group">
                        <label for="password">Nouveau mot de passe</label></br>
                        <input class="text-field" type="password" name="password" id="password"
                               placeholder="••••••••" minlength="8" required>
                    </div>

                    <div class="form-group">
                        <label for="password_confirm">Confirme le mot de passe</label></br>
                        <input class="text-field" type="password" name="password_confirm" id="password_confirm"
                               placeholder="••••••••" minlength="8" required>
                    </div>

                    <div class="form-group">
                        <div class="form-actions">
                            <input class="button" type="submit" value="Réinitialiser">
                        </div>
                    </div>
                </form>
            <?php endif; ?>
        </div>
    </div>
</body>
</html>