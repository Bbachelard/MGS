<?php
declare(strict_types=1);

/**
 * logged/inbox.php — demandes d'ami reçues et liste des amis.
 *
 * Le SQL est parti dans php/friends-model.php et les cartes dans
 * php/views/friend-card.php : cette page ne fait plus que router le
 * POST et disposer les blocs.
 */

require_once __DIR__ . '/../php/core/bootstrap.php';
require_once __DIR__ . '/../php/friends-model.php';
require_once __DIR__ . '/../php/views/navbar.php';
require_once __DIR__ . '/../php/views/friend-card.php';

mgs_session_start();

$myId       = mgs_require_login_page();
$myUsername = mgs_username();
$banner     = null;

/* ------------------------------------------------------------------
   Accepter / refuser une demande
------------------------------------------------------------------ */
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['friendship_id'], $_POST['action'])) {
    $banner = mgs_answer_request(
        $conn,
        $myId,
        (int) $_POST['friendship_id'],
        (string) $_POST['action']
    );
}

$requests = mgs_pending_requests($conn, $myId);
$friends  = mgs_friend_list($conn, $myId);
?>
<!DOCTYPE html>
<html lang="fr">
<?php mgs_head('Amis'); ?>
<body>

<?php mgs_navbar([
    'username' => $myUsername,
    'actions'  => [['Mon profil', './index.php'], ['Ajouter un ami', './add_friend.php']],
    'logout'   => true,
]); ?>

<main>
    <div class="titre"><h1>Mes amis</h1></div>

    <?php mgs_banner($banner); ?>

    <!-- ============ DEMANDES D'AMI ============ -->
    <div class="compte">
        <div class="stats-result">
            <h2>Demandes d'ami</h2>

            <?php if ($requests === []): ?>
                <?php mgs_empty_state("Tu n'as aucune demande d'ami en attente."); ?>
            <?php else: ?>
                <div class="friends-grid">
                    <?php foreach ($requests as $request): ?>
                        <?php mgs_friend_card(
                            (string) $request['username'],
                            'Veut devenir ton ami',
                            mgs_friend_action_form((int) $request['friendship_id'], 'accept', 'Accepter', 'button btn-sm')
                            . mgs_friend_action_form((int) $request['friendship_id'], 'refuse', 'Refuser', 'button button--ghost btn-sm'),
                            '',
                            'request'
                        ); ?>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>
    </div>

    <!-- ============ LISTE DES AMIS ============ -->
    <div class="compte">
        <div class="stats-result">
            <h2>Liste de mes amis</h2>

            <?php if ($friends === []): ?>
                <?php mgs_empty_state("Tu n'as pas encore d'amis."); ?>
            <?php else: ?>
                <div class="friends-grid">
                    <?php foreach ($friends as $friend): ?>
                        <?php mgs_friend_card(
                            (string) $friend['username'],
                            'Ami',
                            '<a href="./friend_profile.php?id=' . (int) $friend['id']
                            . '" class="button btn-sm">Voir le profil</a>',
                            'online'
                        ); ?>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>
    </div>
</main>
</body>
</html>
