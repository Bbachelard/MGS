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

if (!mgs_are_friends($conn, $myId, $friendId)) {
    http_response_code(403);
    // ...ta page "Accès refusé" existante, inchangée...
    exit;
}

$myId = (int) ($_SESSION['user_id'] ?? 0);
$friendId = (int) ($_GET['id'] ?? 0);

if ($myId <= 0) {
    header('Location: ../connexion/index.php');
    exit;
}

if ($friendId <= 0) {
    http_response_code(400);
    exit('Identifiant invalide.');
}

// Si quelqu'un ouvre friend_profile.php avec son propre ID,
// on le renvoie simplement vers son profil personnel.
if ($friendId === $myId) {
    header('Location: ./index.php');
    exit;
}

// Vérification serveur de l'amitié.
$stmt = $conn->prepare(
    "SELECT 1
     FROM friendships
     WHERE status = 'accepted'
       AND (
            (sender_id = ? AND receiver_id = ?)
         OR (sender_id = ? AND receiver_id = ?)
       )
     LIMIT 1"
);

if ($stmt === false) {
    http_response_code(500);
    exit('Erreur serveur.');
}

$stmt->bind_param('iiii', $myId, $friendId, $friendId, $myId);
$stmt->execute();
$stmt->store_result();
$isFriend = $stmt->num_rows > 0;
$stmt->close();

if (!$isFriend) {
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

// Récupère uniquement les informations publiques nécessaires au profil.
$stmt = $conn->prepare(
    "SELECT id, username
     FROM users
     WHERE id = ?
     LIMIT 1"
);

if ($stmt === false) {
    http_response_code(500);
    exit('Erreur serveur.');
}

$stmt->bind_param('i', $friendId);
$stmt->execute();
$result = $stmt->get_result();
$friend = $result->fetch_assoc();
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
    <title><?= $friendUsername ?> — Profil</title>
    <link rel="stylesheet" href="../content/css/stylesheet.css">
    <link rel="stylesheet" href="../content/css/styleAceuil.css">
    <link rel="stylesheet" href="../content/css/ajouts-stats.css">
</head>
<body>

<header class="navbar">
    <div class="logo">
        <a href="https://my-gamers-stats.com">
            <img src="../content/image/mgs_letters.png" width="100" alt="My Gamer Stats">
        </a>
    </div>

    <div class="nav-box1"><a href=""><img src="../content/image/Steam_icon.webp" width="50" alt="Steam"></a></div>
    <div class="nav-box2"><a href=""><img src="../content/image/riot-icon.png" width="50" alt="Riot Games"></a></div>
    <div class="nav-box3"><a href=""><img src="../content/image/Epic_icon.webp" width="50" alt="Epic Games"></a></div>

    <div class="friends-actions">
        <a href="./inbox.php" class="nav-link-btn" title="Voir mes amis">Amis</a>
        <a href="./add_friend.php" class="nav-link-btn" title="Ajouter un ami">Ajouter un ami</a>
    </div>

    <div class="login"><a href="./disconnect.php">Déconnexion</a></div>
</header>

<main>
    <section class="hero">
        <p class="hero-hello">Profil de</p>
        <h1 class="hero-name"><?= $friendUsername ?></h1>
        <p class="hero-sub">Stats gaming de <?= $friendUsername ?>.</p>
    </section>

    <div id="platform-hub" class="platform-hub"></div>

    <div id="games-table" class="games-section"></div>


    <div id="imageModal" class="image-modal">
        <span class="image-modal-close">&times;</span>
        <img class="image-modal-content" id="imageModalContent" alt="Aperçu">
    </div>
</main>

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