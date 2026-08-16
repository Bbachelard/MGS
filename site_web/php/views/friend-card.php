<?php
declare(strict_types=1);

/* ==================================================================
 *  php/views/friend-card.php — la carte d'un utilisateur.
 *
 *  Le même bloc existait en trois exemplaires légèrement différents
 *  (demande reçue dans inbox.php, ami dans inbox.php, résultat de
 *  recherche dans add_friend.php).
 * ================================================================== */

/** Initiale servant d'avatar de repli. */
function mgs_initiale(string $nom): string
{
    return htmlspecialchars(mb_strtoupper(mb_substr($nom, 0, 1)), ENT_QUOTES, 'UTF-8');
}

/**
 * @param string      $username  pseudo affiché
 * @param string      $badge     libellé sous le pseudo
 * @param string      $badgeCls  classe additionnelle du badge ('online'…)
 * @param string      $actions   HTML des boutons (construit par l'appelant)
 * @param string      $variante  suffixe BEM ('request' pour une demande)
 */
function mgs_friend_card(
    string $username,
    string $badge,
    string $actions,
    string $badgeCls = '',
    string $variante = ''
): void {
    $classe = 'friend-card' . ($variante !== '' ? ' friend-card--' . $variante : '');
    ?>
    <div class="<?= $classe ?>">
        <div class="friend-card__main">
            <div class="friend-avatar"><?= mgs_initiale($username) ?></div>
            <div class="friend-info">
                <h3><?= htmlspecialchars($username, ENT_QUOTES, 'UTF-8') ?></h3>
                <span class="status-badge <?= htmlspecialchars($badgeCls, ENT_QUOTES, 'UTF-8') ?>">
                    <?= htmlspecialchars($badge, ENT_QUOTES, 'UTF-8') ?>
                </span>
            </div>
        </div>
        <div class="friend-actions"><?= $actions ?></div>
    </div>
    <?php
}

/** Petit formulaire POST d'une action sur une demande. */
function mgs_friend_action_form(int $friendshipId, string $action, string $libelle, string $classe): string
{
    return '<form action="" method="post" class="friend-actions__form">'
         . '<input type="hidden" name="friendship_id" value="' . $friendshipId . '">'
         . '<input type="hidden" name="action" value="' . htmlspecialchars($action, ENT_QUOTES, 'UTF-8') . '">'
         . '<button type="submit" class="' . $classe . '">' . htmlspecialchars($libelle, ENT_QUOTES, 'UTF-8') . '</button>'
         . '</form>';
}

/** Bloc « rien à afficher ». */
function mgs_empty_state(string $texte): void
{
    echo '<div class="empty-state">' . htmlspecialchars($texte, ENT_QUOTES, 'UTF-8') . '</div>';
}
