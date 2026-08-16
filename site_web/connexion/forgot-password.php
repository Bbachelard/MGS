<?php
declare(strict_types=1);

/**
 * connexion/forgot-password.php — demande d'un lien de réinitialisation.
 *
 * La confirmation est la même que l'adresse existe ou non : sans ça, ce
 * formulaire dirait à un attaquant quelles adresses ont un compte.
 */

require_once __DIR__ . '/../php/views/head.php';

session_start();
?>
<!DOCTYPE html>
<html lang="fr">
<?php mgs_head('Mot de passe oublié', ['/content/css/stylesheet.css', '/content/css/styleLogin.css']); ?>
<body>
    <div class="page">
        <div class="login-wrapper">
            <?php if (isset($_GET['sent'])): ?>
                <h1>Mot de passe oublié</h1>
                <p>Si un compte correspondant à cette adresse existe, un email de réinitialisation vient d'être envoyé.</p>
                <div class="form-actions">
                    <a href="./index.php" class="button">Retour à la connexion</a>
                </div>
            <?php else: ?>
                <form action="../php/forgot-password-send.php" method="post" class="form_connect">
                    <h1>Mot de passe oublié</h1>
                    <p>Entre ton adresse email, on t'enverra un lien de réinitialisation.</p>

                    <div class="form-group">
                        <label for="email">Adresse email</label><br>
                        <input
                            class="text-field"
                            type="email"
                            name="email"
                            id="email"
                            placeholder="toi@example.com"
                            required
                        >
                    </div>

                    <div class="form-group">
                        <div class="form-actions">
                            <input class="button" type="submit" value="Envoyer le lien">
                            <a href="./index.php" class="button-2">Annuler</a>
                        </div>
                    </div>
                </form>
            <?php endif; ?>
        </div>
    </div>
</body>
</html>