<?php
declare(strict_types=1);

/**
 * connexion/index.php — formulaire de connexion.
 */

require_once __DIR__ . '/../php/core/auth.php';
require_once __DIR__ . '/../php/core/http.php';
require_once __DIR__ . '/../php/views/head.php';

mgs_session_start();

if (mgs_is_logged()) {
    mgs_redirect('../logged/index.php');
}

/* Les messages étaient produits par verify_user.php (?error=invalid) et
   reset-password-process.php (?reset=success) mais la page ne les
   affichait nulle part : l'utilisateur revenait sur un formulaire vide
   sans savoir ce qui s'était passé. */
$message = null;

if (isset($_GET['error'])) {
    $message = ['type' => 'error', 'text' => "Nom d'utilisateur ou mot de passe incorrect."];
} elseif (isset($_GET['reset'])) {
    $message = ['type' => 'success', 'text' => 'Mot de passe modifié. Tu peux te connecter.'];
}
?>
<!DOCTYPE html>
<html lang="fr">
<?php mgs_head('Connexion', ['/content/css/stylesheet.css', '/content/css/styleLogin.css']); ?>
<body>
    <header class="navbar">
        <div class="logo">
            <a href="../index.html" aria-label="Accueil My Gamers Stats">
                <img src="../content/image/mgs_letters.png" width="100" alt="My Gamers Stats">
            </a>
        </div>

        <nav class="nav-main" aria-label="Navigation principale">
            <a href="../game/index.php" class="nav-main__link">Games</a>
        </nav>
    </header>

    <div class="page">
        <div class="login-wrapper">
            <form action="verify_user.php" method="post" class="form_connect">
                <h1>Connexion</h1>
                <p>Entre tes identifiants pour accéder à ton espace.</p>

                <?php if ($message !== null): ?>
                    <p class="<?= $message['type'] === 'error' ? 'error-message' : 'success-message' ?>">
                        <?= htmlspecialchars($message['text'], ENT_QUOTES, 'UTF-8') ?>
                    </p>
                <?php endif; ?>

                <div class="form-group">
                    <label for="username">Nom d'utilisateur</label>
                    <br>
                    <input class="text-field" type="text" name="username" id="username"
                           placeholder="Ton pseudo" autocomplete="username" required>
                </div>

                <div class="form-group">
                    <label for="password">Mot de passe</label>
                    <br>
                    <input class="text-field" type="password" name="password" id="password"
                           placeholder="••••••••" autocomplete="current-password" required>
                </div>

                <div class="form-group">
                    <div class="form-actions">
                        <input class="button" type="submit" value="Se connecter">
                        <a href="../signup/index.php" class="button-2">S'inscrire</a>
                    </div>
                    <p class="forgot-link"><a href="./forgot-password.php">Mot de passe oublié ?</a></p>
                </div>
            </form>
        </div>
    </div>
</body>
</html>
