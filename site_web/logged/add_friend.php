<?php
declare(strict_types=1);

/**
 * logged/add_friend.php — recherche d'un joueur et envoi d'une demande.
 *
 * Toute la logique (contrôles d'unicité, état de la relation, recherche
 * avec échappement des jokers LIKE) vit dans php/friends-model.php.
 */

require_once __DIR__ . '/../php/core/bootstrap.php';
require_once __DIR__ . '/../php/friends-model.php';
require_once __DIR__ . '/../php/views/navbar.php';

mgs_session_start();

$myId       = mgs_require_login_page();
$myUsername = mgs_username();
$banner     = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['add_friend_id'])) {
    $banner = mgs_send_request($conn, $myId, (int) $_POST['add_friend_id']);
}

$query   = trim((string) ($_GET['q'] ?? ''));
$results = mgs_search_users($conn, $myId, $query);

/** Étiquette / bouton selon l'état de la relation avec ce joueur. */
function mgs_relation_action(array $user): string
{
    $relation = $user['relation'];

    if ($relation === null) {
        return '<form action="" method="post">'
             . '<input type="hidden" name="add_friend_id" value="' . (int) $user['id'] . '">'
             . '<button type="submit" class="button">Ajouter en ami</button>'
             . '</form>';
    }

    if ($relation['status'] === 'accepted') {
        return '<span class="status-badge online">Déjà amis</span>';
    }

    return $relation['isSender']
        ? '<span class="status-badge">Demande envoyée</span>'
        : '<span class="status-badge">Vous a envoyé une demande</span>';
}
?>
<!DOCTYPE html>
<html lang="fr">
<?php mgs_head('Ajouter un ami'); ?>
<body>

<?php mgs_navbar([
    'username' => $myUsername,
    'actions'  => [['Mon profil', './index.php'], ['Amis', './inbox.php']],
    'logout'   => true,
]); ?>

<main>
    <div class="titre"><h1>Ajouter un ami</h1></div>

    <?php mgs_banner($banner); ?>

    <form action="" method="get" class="form-example">
        <div class="login-wrapper search-wrapper">
            <label for="q">Rechercher un joueur</label>
            <input type="text" id="q" name="q" class="text-field"
                   placeholder="Pseudo à rechercher"
                   value="<?= htmlspecialchars($query, ENT_QUOTES, 'UTF-8') ?>">
            <button type="submit" class="button">Rechercher</button>
        </div>
    </form>

    <div class="compte">
        <div class="stats-result">
            <?php if ($query !== '' && $results === []): ?>
                <p class="stats-info">
                    Aucun utilisateur trouvé pour « <?= htmlspecialchars($query, ENT_QUOTES, 'UTF-8') ?> ».
                </p>
            <?php endif; ?>

            <?php foreach ($results as $user): ?>
                <div class="player-card player-card--search">
                    <div class="player-header">
                        <div class="player-identity">
                            <h3><?= htmlspecialchars((string) $user['username'], ENT_QUOTES, 'UTF-8') ?></h3>
                        </div>
                    </div>
                    <?= mgs_relation_action($user) ?>
                </div>
            <?php endforeach; ?>
        </div>
    </div>
</main>
</body>
</html>
