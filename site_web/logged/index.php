<?php
declare(strict_types=1);

session_start();

if (!isset($_SESSION["logged"]) || $_SESSION["logged"] !== true) {
    header("Location: ../connexion/index.php");
    exit;
}

require_once __DIR__ . '/../php/platforms.php';
$config = require __DIR__ . '/../config.php';

$username = $_SESSION['username'] ?? '';

// Bannières de retour de liaison
$banner = null;
$linked = mgs_resolve_platform($_GET['linked'] ?? null);
$errorP = mgs_resolve_platform($_GET['platform'] ?? null);

if ($linked !== null) {
    $banner = ['type' => 'success', 'text' => 'Compte ' . mgs_platform($linked)['label'] . ' lié avec succès.'];
} elseif (isset($_GET['error'])) {
    $label = $errorP !== null ? mgs_platform($errorP)['label'] : 'la plateforme';
    $messages = [
        'deja_lie'               => "Ce compte {$label} est déjà lié à un autre compte MGS.",
        'auth'                   => "L'authentification {$label} a échoué. Réessaie dans un instant.",
        'state'                  => "Session de liaison expirée. Relance la liaison depuis cette page.",
        'platform_indisponible'  => "Cette plateforme n'est pas encore disponible.",
    ];
    $banner = ['type' => 'error', 'text' => $messages[$_GET['error']] ?? "Une erreur est survenue."];
}
?>
<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mon profil — My gamers stats</title>
    <link rel="stylesheet" href="../content/css/stylesheet.css">
    <link rel="stylesheet" href="../content/css/styleLogin.css">
    <link rel="stylesheet" href="../content/css/ajouts-stats.css">
  </head>
  <body>
    <header class="navbar">
        <div class="logo"><a href="../index.html"><img src="../content/image/mgs_letters.png" width="100"></a></div>
        <div class="user-chip">
            <img id="navAvatar" class="nav-avatar" src="../content/image/mgs_icon.png" alt="Avatar">
            <span class="nav-username"><?= htmlspecialchars($username) ?></span>
        </div>
        <?php $i = 1; foreach (mgs_platforms() as $slug => $platform): ?>
            <div class="nav-box<?= $i++ ?>">
                <?php if ($platform['enabled'] && $platform['linkable']): ?>
                    <a href="../php/link.php?platform=<?= urlencode($slug) ?>" title="Lier mon compte <?= htmlspecialchars($platform['label']) ?>">
                        <img src="<?= htmlspecialchars($platform['icon']) ?>" width="50">
                    </a>
                <?php else: ?>
                    <img src="<?= htmlspecialchars($platform['icon']) ?>" width="50" style="opacity:.35" title="Bientôt disponible">
                <?php endif; ?>
            </div>
        <?php endforeach; ?>

        <div class="friends-actions">
            <a href="./inbox.php" class="nav-link-btn" title="Voir mes amis">Amis</a>
            <a href="./add_friend.php" class="nav-link-btn" title="Ajouter un ami">Ajouter un ami</a>
        </div>

        <div class="login"><a href="./disconnect.php">Déconnexion</a></div>
    </header>

    <main>
        <section class="hero">
            <p class="hero-hello">Bonjour</p>
            <h1 class="hero-name"><?= htmlspecialchars($username) ?></h1>
            <p class="hero-sub">Toutes tes stats, réunies au même endroit.</p>
        </section>

        <?php if ($banner): ?>
            <div class="banner banner--<?= $banner['type'] ?>"><?= htmlspecialchars($banner['text']) ?></div>
        <?php endif; ?>

        <div id="platform-hub" class="platform-hub">

        <div id="games-table" class="games-section"></div>

        </div>


        <div id="imageModal" class="image-modal">
            <span class="image-modal-close">&times;</span>
            <img class="image-modal-content" id="imageModalContent">
        </div>
    </main>

    <script src="../js/stats-display.js?v=4"></script>
    <script src="../js/games-table.js?v=1"></script>
    <script src="../js/profile-stats.js?v=4"></script>
  </body>
</html>