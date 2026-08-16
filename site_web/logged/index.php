<?php
declare(strict_types=1);

/**
 * logged/index.php — profil personnel.
 *
 * La page ne fait qu'afficher la coquille : c'est profile-stats.js qui
 * appelle session-status.php puis remplit #platform-hub et #games-table.
 */

require_once __DIR__ . '/../php/core/bootstrap.php';
require_once __DIR__ . '/../php/views/navbar.php';

mgs_session_start();
mgs_require_login_page();

$username = mgs_username();

/* ------------------------------------------------------------------
   Bannière de retour de liaison de compte
------------------------------------------------------------------ */
$banner = null;
$linked = mgs_resolve_platform($_GET['linked'] ?? null);
$errorP = mgs_resolve_platform($_GET['platform'] ?? null);

if ($linked !== null) {
    $banner = [
        'type' => 'success',
        'text' => 'Compte ' . mgs_platform($linked)['label'] . ' lié avec succès.',
    ];

} elseif (isset($_GET['error'])) {
    $label = $errorP !== null ? mgs_platform($errorP)['label'] : 'la plateforme';

    $messages = [
        'deja_lie'              => "Ce compte {$label} est déjà lié à un autre compte MGS.",
        'auth'                  => "L'authentification {$label} a échoué. Réessaie dans un instant.",
        'state'                 => 'Session de liaison expirée. Relance la liaison depuis cette page.',
        'platform_indisponible' => "Cette plateforme n'est pas encore disponible.",
        'consent'               => 'Une autorisation supplémentaire est requise côté Epic.',
        'max'                   => "Tu as atteint le nombre maximum de comptes {$label}.",
        'session'               => 'Session expirée, reconnecte-toi.',
    ];

    $banner = [
        'type' => 'error',
        'text' => $messages[$_GET['error']] ?? 'Une erreur est survenue.',
    ];

    if ($_GET['error'] === 'consent' && !empty($_SESSION['link_consent_url'])) {
        $banner['text'] .= ' Ouvre cette page, valide, ferme l\'onglet puis relance la liaison : ';
        $banner['html']  = '<a href="' . htmlspecialchars($_SESSION['link_consent_url'], ENT_QUOTES, 'UTF-8')
                         . '" target="_blank" rel="noopener">Donner mon autorisation</a>';

        unset($_SESSION['link_consent_url']);
    }
}
?>
<!DOCTYPE html>
<html lang="fr">
<?php mgs_head('Mon profil'); ?>
<body>

<?php mgs_navbar([
    'username'  => $username,
    'avatar'    => true,
    'platforms' => 'link',
    'friends'   => true,
    'logout'    => true,
]); ?>

<main>
    <section class="hero">
        <p class="hero-hello">Bonjour</p>
        <h1 class="hero-name"><?= htmlspecialchars($username, ENT_QUOTES, 'UTF-8') ?></h1>
        <p class="hero-sub">Toutes tes stats, réunies au même endroit.</p>
    </section>

    <?php mgs_banner($banner); ?>

    <div id="platform-hub" class="platform-hub"></div>

    <div id="games-table" class="games-section"></div>

    <div id="imageModal" class="image-modal">
        <span class="image-modal-close">&times;</span>
        <img class="image-modal-content" id="imageModalContent" alt="Aperçu">
    </div>
</main>

<!-- L'ordre compte : mgs-core expose escapeHtml/formaterHeures,
     match-detail enrichit stats-display, hub-resume s'appuie sur les deux,
     profile-stats orchestre le tout et doit rester en dernier. -->
<script src="<?= mgs_asset('../js/core/mgs-core.js') ?>"></script>
<script src="<?= mgs_asset('../js/match-detail.js') ?>"></script>
<script src="<?= mgs_asset('../js/stats-display.js') ?>"></script>
<script src="<?= mgs_asset('../js/hub-resume.js') ?>"></script>
<script src="<?= mgs_asset('../js/link-verify.js') ?>"></script>
<script src="<?= mgs_asset('../js/games-table.js') ?>"></script>
<script src="<?= mgs_asset('../js/profile-stats.js') ?>"></script>
</body>
</html>
