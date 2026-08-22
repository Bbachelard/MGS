<?php
declare(strict_types=1);

require_once __DIR__ . '/head.php';
require_once dirname(__DIR__) . '/platforms.php';

/* ==================================================================
 *  php/views/navbar.php — la barre de navigation, en un seul endroit.
 *
 *  Le même bloc de ~35 lignes était recopié dans logged/index.php,
 *  logged/friend_profile.php, logged/inbox.php, logged/add_friend.php
 *  et signup/index.php. Chaque copie avait déjà divergé : icônes de
 *  plateforme cliquables sur l'une et mortes (href="") sur l'autre,
 *  avatar identifié ici mais pas là, liens d'amis absents ailleurs.
 *
 *  Un seul appel les remplace toutes :
 *
 *      mgs_navbar([
 *          'username'  => $username,   // pseudo affiché dans la puce
 *          'platforms' => 'link',      // 'link' | 'static' | 'none'
 *          'friends'   => true,        // boutons Amis / Ajouter un ami
 *          'actions'   => [['Mon profil', './index.php'], …],
 *          'logout'    => true,
 *          'active'    => 'game',      // onglet principal en surbrillance
 *      ]);
 *
 *  Les liens propres à l'espace connecté (déconnexion, amis) sont
 *  construits à partir de $base et non en « ./ » : la barre est
 *  désormais affichée depuis d'autres dossiers que logged/, et un
 *  « ./disconnect.php » y pointait dans le vide.
 *
 *  L'avatar (photo de profil Steam, en haut à gauche) est automatique dès
 *  qu'un $username est fourni : pas d'option à passer. La puce part sur
 *  l'icône MGS par défaut, puis php/me-avatar.php la remplace en tâche de
 *  fond — sur CETTE page comme sur toutes les autres, tant que la session
 *  reste ouverte. Rien à faire si l'utilisateur n'a lié aucun compte Steam.
 * ================================================================== */

/**
 * Onglets de la navigation principale, à gauche de la barre.
 * Communs à toutes les pages, connecté ou non.
 *
 * @return list<array{0:string,1:string,2:string}> [clé, libellé, href relatif à la racine]
 */
function mgs_navbar_tabs(): array
{
    return [
        ['game', 'Games', '/game/index.php'],
    ];
}

/**
 * Icônes de plateforme de la navbar.
 *
 * $mode :
 *   'link'   -> cliquables (liaison de compte) : profil personnel
 *   'static' -> décoratives : profil d'un ami, pages secondaires
 *   'none'   -> rien
 */
function mgs_navbar_platforms(string $mode, string $base): void
{
    if ($mode === 'none') {
        return;
    }

    $i = 1;

    foreach (mgs_platforms() as $slug => $platform) {
        $icon  = htmlspecialchars($platform['icon'], ENT_QUOTES, 'UTF-8');
        $label = htmlspecialchars($platform['label'], ENT_QUOTES, 'UTF-8');
        $box   = 'nav-box' . $i++;

        echo '<div class="' . $box . '">';

        if (!$platform['enabled']) {
            // Grisée : la plateforme est déclarée mais pas encore branchée.
            echo '<img src="' . $icon . '" width="50" alt="' . $label . '"'
               . ' style="opacity:.35" title="Bientôt disponible">';

        } elseif ($mode === 'static') {
            echo '<img src="' . $icon . '" width="50" alt="' . $label . '">';

        } elseif ($platform['linkable']) {
            echo '<a href="' . $base . '/php/link.php?platform=' . urlencode($slug) . '"'
               . ' title="Lier mon compte ' . $label . '">'
               . '<img src="' . $icon . '" width="50" alt="' . $label . '"></a>';

        } elseif (!empty($platform['verifiable'])) {
            // Liaison par preuve de propriété : c'est link-verify.js qui prend la main.
            echo '<button type="button" class="nav-platform js-verify"'
               . ' data-platform="' . htmlspecialchars($slug, ENT_QUOTES, 'UTF-8') . '"'
               . ' title="Lier mon compte ' . $label . '">'
               . '<img src="' . $icon . '" width="50" alt="' . $label . '"></button>';

        } else {
            echo '<img src="' . $icon . '" width="50" alt="' . $label . '"'
               . ' style="opacity:.35" title="Bientôt disponible">';
        }

        echo '</div>';
    }
}

/**
 * @param array{
 *   username?:string, platforms?:string, friends?:bool,
 *   actions?:list<array{0:string,1:string}>, logout?:bool, login?:bool,
 *   base?:string, active?:string
 * } $options
 */
function mgs_navbar(array $options = []): void
{
    $base     = rtrim($options['base'] ?? '..', '/');
    $username = (string) ($options['username'] ?? '');
    $actif    = (string) ($options['active'] ?? '');
    ?>
<header class="navbar">
    <div class="logo">
        <a href="<?= htmlspecialchars($base, ENT_QUOTES, 'UTF-8') ?>/index.html" aria-label="Accueil My Gamers Stats">
            <img src="<?= htmlspecialchars($base, ENT_QUOTES, 'UTF-8') ?>/content/image/mgs_letters.png"
                 width="100" alt="My Gamers Stats">
        </a>
    </div>

    <nav class="nav-main" aria-label="Navigation principale">
        <?php foreach (mgs_navbar_tabs() as [$cle, $libelle, $href]): ?>
            <a href="<?= htmlspecialchars($base . $href, ENT_QUOTES, 'UTF-8') ?>"
               class="nav-main__link<?= $cle === $actif ? ' is-active' : '' ?>"
               <?= $cle === $actif ? 'aria-current="page"' : '' ?>><?= htmlspecialchars($libelle, ENT_QUOTES, 'UTF-8') ?></a>
        <?php endforeach; ?>
    </nav>

    <?php if ($username !== ''): ?>
        <div class="user-chip">
            <img id="navAvatar" class="nav-avatar"
                 src="<?= htmlspecialchars($base, ENT_QUOTES, 'UTF-8') ?>/content/image/mgs_icon.png" alt="Avatar">
            <span class="nav-username"><?= htmlspecialchars($username, ENT_QUOTES, 'UTF-8') ?></span>
        </div>
        <script>
        (function () {
            var img = document.getElementById('navAvatar');
            if (!img) return;

            fetch(<?= json_encode($base . '/php/me-avatar.php', JSON_UNESCAPED_SLASHES) ?>, { credentials: 'same-origin' })
                .then(function (reponse) { return reponse.ok ? reponse.json() : null; })
                .then(function (data) {
                    if (data && data.avatar) {
                        img.src = data.avatar;
                        img.classList.add('is-linked');
                        img.title = 'Photo de profil Steam';
                    }
                })
                .catch(function () { /* icône par défaut, tant pis */ });
        })();
        </script>
    <?php endif; ?>

    <?php mgs_navbar_platforms($options['platforms'] ?? 'none', $base); ?>

    <?php if (!empty($options['friends']) || !empty($options['actions'])): ?>
        <div class="friends-actions">
            <?php foreach ($options['actions'] ?? [] as [$libelle, $href]): ?>
                <a href="<?= htmlspecialchars($href, ENT_QUOTES, 'UTF-8') ?>"
                   class="nav-link-btn"><?= htmlspecialchars($libelle, ENT_QUOTES, 'UTF-8') ?></a>
            <?php endforeach; ?>

            <?php if (!empty($options['friends'])): ?>
                <a href="<?= htmlspecialchars($base, ENT_QUOTES, 'UTF-8') ?>/logged/inbox.php"
                   class="nav-link-btn" title="Voir mes amis">Amis</a>
                <a href="<?= htmlspecialchars($base, ENT_QUOTES, 'UTF-8') ?>/logged/add_friend.php"
                   class="nav-link-btn" title="Ajouter un ami">Ajouter un ami</a>
            <?php endif; ?>
        </div>
    <?php endif; ?>

    <?php if (!empty($options['login'])): ?>
        <div class="create"><a href="<?= htmlspecialchars($base, ENT_QUOTES, 'UTF-8') ?>/signup/index.php">S'inscrire</a></div>
        <div class="login"><a href="<?= htmlspecialchars($base, ENT_QUOTES, 'UTF-8') ?>/connexion/index.php">Connexion</a></div>
    <?php endif; ?>

    <?php if (!empty($options['logout'])): ?>
        <div class="login"><a href="<?= htmlspecialchars($base, ENT_QUOTES, 'UTF-8') ?>/logged/disconnect.php">Déconnexion</a></div>
    <?php endif; ?>
</header>
<?php
}

/**
 * Bannière de message (succès / erreur). Le HTML optionnel n'est PAS
 * échappé : il n'est jamais construit à partir d'une saisie utilisateur.
 *
 * L'ancien logged/index.php affichait le texte deux fois — une fois dans
 * la bannière, une fois nu juste en dessous.
 *
 * @param array{type:string, text:string, html?:string}|null $banner
 */
function mgs_banner(?array $banner): void
{
    if ($banner === null) {
        return;
    }

    $type = $banner['type'] === 'success' ? 'success' : 'error';

    echo '<div class="banner banner--' . $type . '">'
       . htmlspecialchars($banner['text'], ENT_QUOTES, 'UTF-8')
       . ($banner['html'] ?? '')
       . '</div>';
}
