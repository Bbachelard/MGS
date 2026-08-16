<?php
declare(strict_types=1);

/**
 * logged/friend_profile.php — profil d'un ami, en lecture seule.
 *
 * Même coquille que logged/index.php : c'est profile-stats.js qui
 * remplit la page, en lisant window.PROFILE_TARGET pour savoir quel
 * profil demander et qu'il est en lecture seule.
 */

require_once __DIR__ . '/../php/core/bootstrap.php';
require_once __DIR__ . '/../php/views/navbar.php';
require_once __DIR__ . '/../php/friends-model.php';

mgs_session_start();

$myId       = mgs_require_login_page();
$myUsername = mgs_username();
$friendId   = (int) ($_GET['id'] ?? 0);

if ($friendId <= 0) {
    http_response_code(400);
    exit('Identifiant invalide.');
}

// Ouvrir friend_profile.php avec son propre id renvoie au profil perso.
if ($friendId === $myId) {
    mgs_redirect('./index.php');
}

if (!mgs_are_friends($conn, $myId, $friendId)) {
    http_response_code(403);
    ?>
    <!DOCTYPE html>
    <html lang="fr">
    <?php mgs_head('Accès refusé', ['/content/css/stylesheet.css', '/content/css/styleLogin.css']); ?>
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

$stmt = $conn->prepare('SELECT username FROM users WHERE id = ? LIMIT 1');
$stmt->bind_param('i', $friendId);
$stmt->execute();
$friend = $stmt->get_result()->fetch_assoc();
$stmt->close();

if ($friend === null) {
    http_response_code(404);
    exit('Utilisateur introuvable.');
}

$friendUsername = (string) $friend['username'];
?>
<!DOCTYPE html>
<html lang="fr">
<?php mgs_head($friendUsername); ?>
<body>

<?php
/* La navbar reste LA TIENNE (ton pseudo, pas d'avatar dynamique), et
   les icônes de plateforme sont décoratives : on ne lie pas un compte
   depuis le profil de quelqu'un d'autre. */
mgs_navbar([
    'username'  => $myUsername,
    'avatar'    => false,
    'platforms' => 'static',
    'actions'   => [['Mon profil', './index.php'], ['Amis', './inbox.php']],
    'logout'    => true,
]);
?>

<main>
    <section class="hero">
        <p class="hero-hello">Profil de</p>
        <h1 class="hero-name"><?= htmlspecialchars($friendUsername, ENT_QUOTES, 'UTF-8') ?></h1>
        <p class="hero-sub">Toutes ses stats, réunies au même endroit.</p>
    </section>

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
        userId: <?= $friendId ?>,
        isOwnProfile: false
    };
</script>
<script src="<?= mgs_asset('../js/core/mgs-core.js') ?>"></script>
<script src="<?= mgs_asset('../js/match-detail.js') ?>"></script>
<script src="<?= mgs_asset('../js/stats-display.js') ?>"></script>
<script src="<?= mgs_asset('../js/hub-resume.js') ?>"></script>
<script src="<?= mgs_asset('../js/games-table.js') ?>"></script>
<script src="<?= mgs_asset('../js/profile-stats.js') ?>"></script>
</body>
</html>
