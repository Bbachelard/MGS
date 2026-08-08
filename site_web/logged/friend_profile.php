<?php
declare(strict_types=1);

session_start();

if (!isset($_SESSION['logged']) || $_SESSION['logged'] !== true) {
    header('Location: ../connexion/index.php');
    exit;
}

require __DIR__ . '/../config.php';
require_once __DIR__ . '/../php/friends-model.php';
require_once __DIR__ . '/../php/platforms.php';

$myId       = (int) ($_SESSION['user_id'] ?? 0);
$myUsername = $_SESSION['username'] ?? '';
$friendId   = (int) ($_GET['id'] ?? 0);

if ($myId <= 0) {
    header('Location: ../connexion/index.php');
    exit;
}

if ($friendId <= 0) {
    http_response_code(400);
    exit('Identifiant invalide.');
}

// Ouvrir friend_profile.php avec son propre id renvoie vers le profil perso.
if ($friendId === $myId) {
    header('Location: ./index.php');
    exit;
}

/* ---------------------------------------------------------
   Contrôle d'amitié (désormais mutualisé dans friends-model)
--------------------------------------------------------- */
if (!mgs_are_friends($conn, $myId, $friendId)) {
    http_response_code(403);
    ?>
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Accès refusé</title>
        <link rel="stylesheet" href="../content/css/stylesheet.css">
        <link rel="stylesheet" href="../content/css/styleLogin.css">
    </head>
    <body>
        <div class="page">
            <div class="login-wrapper">
                <h1>Accès refusé</h1>
                <p>Vous devez être ami avec cet utilisateur pour voir son profil.</p>
                <div class="form-actions">
                    <a href="./inbox.php" class="button">Voir mes amis</a>
                </div>
            </div>
        </div>
    </body>
    </html>
    <?php
    exit;
}

/* ---------------------------------------------------------
   Informations publiques de l'ami
--------------------------------------------------------- */
$stmt = $conn->prepare('SELECT id, username FROM users WHERE id = ? LIMIT 1');

if ($stmt === false) {
    http_response_code(500);
    exit('Erreur serveur.');
}

$stmt->bind_param('i', $friendId);
$stmt->execute();
$friend = $stmt->get_result()->fetch_assoc();
$stmt->close();

if ($friend === null) {
    http_response_code(404);
    exit('Utilisateur introuvable.');
}

$friendUsername = htmlspecialchars((string) $friend['username'], ENT_QUOTES, 'UTF-8');
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= $friendUsername ?> — My gamers stats</title>

    <!-- Mêmes feuilles de style que logged/index.php -->
    <link rel="stylesheet" href="../content/css/stylesheet.css">
    <link rel="stylesheet" href="../content/css/styleLogin.css">
    <link rel="stylesheet" href="../content/css/ajouts-stats.css">
</head>
<body>

<header class="navbar">
    <div class="logo">
        <a href="../index.html">
            <img src="../content/image/mgs_letters.png" width="100" alt="My Gamer Stats">
        </a>
    </div>

    <!-- Pas d'id="navAvatar" ici : la navbar reste la tienne, pas celle de l'ami -->
    <div class="user-chip">
        <img class="nav-avatar" src="../content/image/mgs_icon.png" alt="Avatar">
        <span class="nav-username"><?= htmlspecialchars($myUsername) ?></span>
    </div>

    <!-- Icônes plateformes : décoratives, aucun lien de liaison -->
    <?php $i = 1; foreach (mgs_platforms() as $slug => $platform): ?>
        <div class="nav-box<?= $i++ ?>">
            <img src="<?= htmlspecialchars($platform['icon']) ?>"
                 width="50"
                 alt="<?= htmlspecialchars($platform['label']) ?>"
                 <?= $platform['enabled'] ? '' : 'style="opacity:.35"' ?>>
        </div>
    <?php endforeach; ?>

    <div class="friends-actions">
        <a href="./index.php" class="nav-link-btn">Mon profil</a>
        <a href="./inbox.php" class="nav-link-btn">Amis</a>
    </div>

    <div class="login"><a href="./disconnect.php">Déconnexion</a></div>
</header>

<main>
    <section class="hero">
        <p class="hero-hello">Profil de</p>
        <h1 class="hero-name"><?= $friendUsername ?></h1>
        <p class="hero-sub">Toutes ses stats, réunies au même endroit.</p>
    </section>

    <!-- Mêmes conteneurs que index.php : le JS les remplit à l'identique -->
    <div id="platform-hub" class="platform-hub"></div>

    <div id="games-table" class="games-section"></div>

    <div id="imageModal" class="image-modal">
        <span class="image-modal-close">&times;</span>
        <img class="image-modal-content" id="imageModalContent" alt="Aperçu">
    </div>
</main>

<!-- Doit rester AVANT profile-stats.js, qui lit cette variable au chargement -->
<script>
    window.PROFILE_TARGET = {
        userId: <?= (int) $friendId ?>,
        isOwnProfile: false
    };
</script>
<script src="../js/stats-display.js?v=5"></script>
<script src="../js/games-table.js?v=2"></script>
<script src="../js/profile-stats.js?v=5"></script>
</body>
</html>