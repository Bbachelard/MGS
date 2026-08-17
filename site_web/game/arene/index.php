<?php
declare(strict_types=1);

/**
 * game/arene/index.php — la page qui héberge l'Arène MGS.
 *
 * Le jeu lui-même n'est PAS ici : c'est un Worker Cloudflare, dont le code
 * vit dans `jeux/arene/` à la racine du dépôt. Cette page n'en est que le
 * cadre — navbar MGS, titre, règles — et l'affiche dans une <iframe>.
 *
 * Pourquoi le jeu n'est pas servi par cet hébergement : il a besoin d'un
 * serveur qui garde l'état de la partie EN MÉMOIRE entre deux messages et
 * qui pousse 20 fois par seconde en WebSocket. PHP en mutualisé démarre et
 * meurt à chaque requête : il ne sait pas faire. Le Durable Object de
 * Cloudflare est exactement conçu pour ça, et il est gratuit.
 *
 * Comme /game/index.php, cette page est PUBLIQUE et ne touche ni à la base
 * de données ni à config.php : une panne MySQL ne l'empêche pas de sortir.
 */

require_once __DIR__ . '/../../php/views/navbar.php';

/* ------------------------------------------------------------------
   L'adresse du jeu déployé.

   Après `npx wrangler deploy` dans jeux/arene/, wrangler affiche
   l'adresse obtenue. C'est la SEULE ligne à changer ici.

   Laisser la chaîne vide affiche « bientôt disponible » au lieu d'une
   iframe cassée : on peut donc livrer la page avant le déploiement.
------------------------------------------------------------------ */
const MGS_ARENE_URL = '';   // ex. 'https://mgs-arene.mon-compte.workers.dev'

/* Le salon : tous les joueurs qui ouvrent cette page se retrouvent
   ensemble. `?salon=copains` dans l'URL du site ouvre une arène séparée. */
const MGS_ARENE_SALON_DEFAUT = 'mgs';

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
   caractères que le Worker (lettres, chiffres, tiret), sinon n'importe
   qui peut faire créer une infinité de salles.
------------------------------------------------------------------ */
$salon = strtolower((string) ($_GET['salon'] ?? MGS_ARENE_SALON_DEFAUT));
$salon = substr((string) preg_replace('/[^a-z0-9-]/', '', $salon), 0, 24);

if ($salon === '') {
    $salon = MGS_ARENE_SALON_DEFAUT;
}

$jeuUrl = '';

if (MGS_ARENE_URL !== '') {
    $jeuUrl = MGS_ARENE_URL
        . '/?salon=' . rawurlencode($salon)
        . ($username !== '' ? '&nom=' . rawurlencode($username) : '');
}
?>
<!DOCTYPE html>
<html lang="fr">
<?php mgs_head('Arène MGS', [
    '/content/css/stylesheet.css',
    '/content/css/styleLogin.css',
    '/content/css/ajouts-stats.css',
    '/content/css/modules/arene-embed.css',
], '../..'); ?>
<body>

<?php
/* La navbar change selon qu'on est connecté ou non — exactement comme
   sur /game/. `base` remonte de deux crans : on est dans game/arene/. */
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

<main class="arene-page">

    <header class="arene-entete">
        <p class="arene-fil"><a href="/game/">Games</a> · Arène MGS</p>
        <h1 class="arene-titre">Arène MGS</h1>
        <p class="arene-resume">
            Une arène 2D où plusieurs joueurs se déplacent en même temps,
            se voient bouger et se bousculent. Rien à installer.
        </p>
    </header>

    <?php if ($jeuUrl === ''): ?>

        <div class="arene-indispo">
            <p><strong>Le jeu n'est pas encore en ligne.</strong></p>
            <p>
                Le serveur de l'arène se déploie depuis <code>jeux/arene/</code>
                avec <code>npx wrangler deploy</code>. Une fois l'adresse
                obtenue, la renseigner dans <code>MGS_ARENE_URL</code>, en tête
                de ce fichier.
            </p>
        </div>

    <?php else: ?>

        <div class="arene-cadre">
            <iframe
                class="arene-iframe"
                src="<?= htmlspecialchars($jeuUrl, ENT_QUOTES, 'UTF-8') ?>"
                title="Arène MGS"
                allow="fullscreen"
                allowfullscreen
                referrerpolicy="no-referrer"></iframe>
        </div>

        <p class="arene-note">
            Clique dans le jeu avant de jouer : sans ça, le clavier reste sur la
            page. Ouvre cette adresse dans un deuxième onglet, ou envoie-la à un
            ami, pour voir le multijoueur.
            <a class="arene-lien" href="<?= htmlspecialchars($jeuUrl, ENT_QUOTES, 'UTF-8') ?>"
               target="_blank" rel="noopener">Ouvrir en plein écran</a>
        </p>

    <?php endif; ?>

    <section class="arene-infos">
        <div class="arene-info">
            <span class="info-label">Commandes</span>
            <span class="info-value">ZQSD · WASD · flèches</span>
        </div>
        <div class="arene-info">
            <span class="info-label">Joueurs</span>
            <span class="info-value">Multijoueur en ligne</span>
        </div>
        <div class="arene-info">
            <span class="info-label">Plateforme</span>
            <span class="info-value">Navigateur</span>
        </div>
        <div class="arene-info">
            <span class="info-label">Salon</span>
            <span class="info-value"><?= htmlspecialchars($salon, ENT_QUOTES, 'UTF-8') ?></span>
        </div>
    </section>

</main>

</body>
</html>
