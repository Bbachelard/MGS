<?php
declare(strict_types=1);

/**
 * signup/index.php — formulaire d'inscription.
 */

require_once __DIR__ . '/../php/core/auth.php';
require_once __DIR__ . '/../php/core/http.php';
require_once __DIR__ . '/../php/views/navbar.php';

mgs_session_start();

if (mgs_is_logged()) {
    mgs_redirect('../logged/index.php');
}

$erreur = $_SESSION['signup_error'] ?? null;
unset($_SESSION['signup_error']);
?>
<!DOCTYPE html>
<html lang="fr">
<?php mgs_head('Inscription', ['/content/css/stylesheet.css', '/content/css/styleLogin.css']); ?>
<body>

<?php
/* Les icônes de plateforme étaient ici trois <a href=""> morts, qui
   rechargeaient la page. Elles sont désormais décoratives : on ne peut
   pas lier un compte avant d'en avoir créé un. */
mgs_navbar(['platforms' => 'static', 'login' => true]);
?>

<div class="page">
    <div class="login-wrapper">
        <form action="create_user.php" method="post" class="form_connect">
            <h1>Inscription</h1>

            <?php if ($erreur !== null): ?>
                <p class="error-message"><?= htmlspecialchars((string) $erreur, ENT_QUOTES, 'UTF-8') ?></p>
            <?php endif; ?>

            <p>Complète les champs suivants pour créer ta page.</p>

            <div class="form-group">
                <label for="username">Nom d'utilisateur</label>
                <br>
                <input class="text-field" type="text" name="username" id="username"
                       placeholder="Ton pseudo" autocomplete="username" required>
            </div>

            <div class="form-group">
                <label for="email">Adresse mail</label>
                <br>
                <input class="text-field" type="email" name="email" id="email"
                       placeholder="toi@example.com" autocomplete="email" required>
            </div>

            <div class="form-group">
                <label for="password">Mot de passe</label>
                <br>
                <input class="text-field" type="password" name="password" id="password"
                       placeholder="••••••••" minlength="8" autocomplete="new-password" required>
                <small class="field-hint">8 caractères minimum.</small>
            </div>

            <div class="form-group">
                <div class="form-actions">
                    <input class="button" type="submit" value="Créer mon compte">
                </div>
            </div>
        </form>
    </div>
</div>
</body>
</html>
