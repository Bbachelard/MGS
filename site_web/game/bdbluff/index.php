<?php
declare(strict_types=1);

/**
 * game/bdbluff/index.php — la page qui héberge BDBluff.
 *
 * Le jeu lui-même n'est PAS servi par Apache : c'est un petit serveur Node
 * (conteneur `bdbluff` du docker-compose), dont le code vit dans
 * `jeux/bdbluff/` à la racine du dépôt. Apache lui passe /bd/ en ProxyPass.
 * Cette page n'en est que le cadre — navbar MGS, titre, règles — et
 * l'affiche en <iframe>. Même moule que game/arene/index.php.
 *
 * Pourquoi PHP ne peut pas tenir ce rôle : un salon de jeu a besoin d'un
 * processus qui garde l'état de la partie EN MÉMOIRE entre deux messages
 * (qui a rejoint, quelle case appartient à qui, qui a déjà voté). Un script
 * PHP démarre et meurt à chaque requête. Le conteneur Node, lui, reste
 * vivant.
 *
 * Comme game/arene/index.php, cette page est PUBLIQUE et ne touche ni à la
 * base de données ni à config.php : une panne MySQL ne l'empêche pas de
 * sortir. Contrairement à l'Arène, pas de skin/avatar à récupérer — BDBluff
 * n'affiche qu'un pseudo, pas de photo de profil en jeu.
 */

require_once __DIR__ . '/../../php/views/navbar.php';

/* ------------------------------------------------------------------
   L'adresse du jeu.

   '/bd' = le chemin servi par Apache (ProxyPass vers le conteneur
   `bdbluff`, cf. jeux/bdbluff/apache/mgs-bdbluff.conf). Même domaine, même
   certificat, rien à configurer côté navigateur.

   Laisser la chaîne vide affiche un encart d'attente au lieu d'une
   iframe cassée : pratique tant que le conteneur n'est pas en place.
------------------------------------------------------------------ */
const MGS_BDBLUFF_URL = '/bd';

/* Le salon par défaut si aucun n'est précisé dans l'URL du site. */
const MGS_BDBLUFF_SALON_DEFAUT = 'principal';

/* ------------------------------------------------------------------
   Session — en lecture seule, sans bootstrap.php.
------------------------------------------------------------------ */
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$username = '';

if (($_SESSION['logged'] ?? false) === true && !empty($_SESSION['username'])) {
    $username = (string) $_SESSION['username'];
}

// Plus rien n'a besoin de la session : on la relâche pour ne pas bloquer
// les autres requêtes de l'onglet.
session_write_close();

/* ------------------------------------------------------------------
   L'URL passée à l'iframe.

   On transmet le pseudo MGS pour que le champ du jeu soit pré-rempli, et
   le salon. Les deux passent par rawurlencode : un pseudo contenant « & »
   ne doit pas pouvoir inventer un paramètre.

   Le salon vient de l'URL, donc du visiteur : on le borne aux mêmes
   caractères que le serveur du jeu (lettres, chiffres, tiret), sinon
   n'importe qui peut faire créer une infinité de salons.
------------------------------------------------------------------ */
$salon = strtolower((string) ($_GET['salon'] ?? MGS_BDBLUFF_SALON_DEFAUT));
$salon = substr((string) preg_replace('/[^a-z0-9-]/', '', $salon), 0, 24);

if ($salon === '') {
    $salon = MGS_BDBLUFF_SALON_DEFAUT;
}

$jeuUrl = '';

if (MGS_BDBLUFF_URL !== '') {
    $jeuUrl = MGS_BDBLUFF_URL
        . '/?salon=' . rawurlencode($salon)
        . ($username !== '' ? '&nom=' . rawurlencode($username) : '');
}
?>
<!DOCTYPE html>
<html lang="fr">
<?php mgs_head('BDBluff', [
    '/content/css/stylesheet.css',
    '/content/css/styleLogin.css',
    '/content/css/ajouts-stats.css',
    '/content/css/modules/bdbluff-embed.css',
], '../..'); ?>
<body>

<?php
/* La navbar change selon qu'on est connecté ou non — exactement comme
   sur /game/. `base` remonte de deux crans : on est dans game/bdbluff/. */
if ($username !== '') {
    mgs_navbar([
        'base'      => '../..',
        'username'  => $username,
        'platforms' => 'static',
        'actions'   => [['Mon profil', '/logged/index.php']],
        'logout'    => true,
    ]);
} else {
    mgs_navbar([
        'base'      => '../..',
        'platforms' => 'static',
        'login'     => true,
    ]);
}
?>

<main class="bdbluff-page">

    <header class="bdbluff-entete">
        <p class="bdbluff-fil"><a href="/game/">Games</a> · BDBluff</p>
        <h1 class="bdbluff-titre">BDBluff</h1>
        <p class="bdbluff-resume">
            Une BD à plusieurs mains, 3 à 6 joueurs : chacun dessine sa case
            pour raconter une histoire — sauf un, l'imposteur, qui ne connaît
            pas le thème et doit improviser sans se faire remarquer. À la
            révélation, on discute et on vote pour le démasquer.
        </p>
    </header>

    <?php if ($jeuUrl === ''): ?>

        <div class="bdbluff-indispo">
            <p><strong>Le jeu n'est pas encore en ligne.</strong></p>
            <p>
                Le serveur de BDBluff est le conteneur <code>bdbluff</code> du
                <code>docker-compose.yml</code>, et Apache lui passe
                <code>/bd/</code>. Une fois les deux en place, renseigner
                <code>MGS_BDBLUFF_URL</code> en tête de ce fichier.
            </p>
        </div>

    <?php else: ?>

        <div class="bdbluff-cadre">
            <iframe
                class="bdbluff-iframe"
                src="<?= htmlspecialchars($jeuUrl, ENT_QUOTES, 'UTF-8') ?>"
                title="BDBluff"
                allow="fullscreen"
                allowfullscreen
                referrerpolicy="no-referrer"></iframe>
        </div>

        <p class="bdbluff-note">
            Envoie cette adresse à tes amis pour qu'ils rejoignent le même
            salon — il faut au moins 3 joueurs pour lancer une partie.
            <a class="bdbluff-lien" href="<?= htmlspecialchars($jeuUrl, ENT_QUOTES, 'UTF-8') ?>"
               target="_blank" rel="noopener">Ouvrir en plein écran</a>
        </p>

    <?php endif; ?>

    <section class="bdbluff-infos">
        <div class="bdbluff-info">
            <span class="info-label">Joueurs</span>
            <span class="info-value">3 à 6, en ligne</span>
        </div>
        <div class="bdbluff-info">
            <span class="info-label">Format</span>
            <span class="info-value">1 à 5 manches, réglable par l'hôte</span>
        </div>
        <div class="bdbluff-info">
            <span class="info-label">Plateforme</span>
            <span class="info-value">Navigateur</span>
        </div>
        <div class="bdbluff-info">
            <span class="info-label">Salon</span>
            <span class="info-value"><?= htmlspecialchars($salon, ENT_QUOTES, 'UTF-8') ?></span>
        </div>
    </section>

</main>

</body>
</html>
