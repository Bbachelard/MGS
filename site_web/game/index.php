<?php
declare(strict_types=1);

/**
 * game/index.php — le catalogue des jeux du groupe MGS.
 *
 * Page publique : elle s'affiche connecté ou non, seule la navbar
 * change (pastille + déconnexion d'un côté, Connexion / S'inscrire de
 * l'autre). Aucun accès à la base de données : le catalogue vit dans
 * php/games-mgs-model.php, qu'il suffit d'éditer pour ajouter un jeu.
 *
 * Les styles chargés sont ceux de mgs_head() par défaut (stylesheet +
 * styleLogin + ajouts-stats) : .button et .empty-state viennent de
 * styleLogin.css, pas d'ajouts-stats.css. Ne pas les retirer sans
 * vérifier la page.
 */

require_once __DIR__ . '/../php/core/auth.php';
require_once __DIR__ . '/../php/views/navbar.php';
require_once __DIR__ . '/../php/views/friend-card.php';   // mgs_empty_state()
require_once __DIR__ . '/../php/views/game-card.php';

mgs_session_start();

$logged   = mgs_is_logged();
$username = $logged ? mgs_username() : '';

$games  = mgs_group_games();
$compte = mgs_games_compte($games);
?>
<!DOCTYPE html>
<html lang="fr">
<?php mgs_head('Games', [], '..', 'index, follow'); ?>
<body>

<?php
if ($logged) {
    mgs_navbar([
        'username'  => $username,
        'platforms' => 'static',
        'actions'   => [['Mon profil', '../logged/index.php']],
        'logout'    => true,
        'active'    => 'game',
    ]);
} else {
    mgs_navbar([
        'platforms' => 'static',
        'login'     => true,
        'active'    => 'game',
    ]);
}
?>

<main class="games-page">

    <header class="games-header">
        <h1>Les jeux MGS</h1>
        <p class="games-header__sub">
            Les jeux faits par le groupe : ceux qui se jouent directement dans le
            navigateur, et ceux qui se téléchargent.
        </p>

        <?php if ($games !== []): ?>
            <p class="games-header__compte">
                <?= (int) $compte['web'] ?> en ligne
                · <?= (int) $compte['download'] ?> à télécharger
                <?php if ($compte['bientot'] > 0): ?>
                    · <?= (int) $compte['bientot'] ?> à venir
                <?php endif; ?>
            </p>
        <?php endif; ?>
    </header>

    <?php if ($games === []): ?>
        <?php mgs_empty_state("Aucun jeu pour le moment. Reviens vite."); ?>
    <?php else: ?>
        <div class="games-grid">
            <?php foreach ($games as $game): ?>
                <?php mgs_game_card($game, '..'); ?>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>

</main>

</body>
</html>
