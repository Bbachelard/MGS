<?php
declare(strict_types=1);
session_start();
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mot de passe oublié — My Gamers Stats</title>
    <link rel="stylesheet" href="../content/css/stylesheet.css">
    <link rel="stylesheet" href="../content/css/styleLogin.css">
</head>
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
                        <label for="email">Adresse email</label></br>
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