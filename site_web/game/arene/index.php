<?php
declare(strict_types=1);

/**
 * game/arene/index.php — la page qui héberge l'Arène MGS.
 *
 * Le jeu lui-même n'est PAS servi par Apache : c'est un petit serveur Node
 * (conteneur `arene` du docker-compose), dont le code vit dans `jeux/arene/`
 * à la racine du dépôt. Apache lui passe /jeu/ en ProxyPass. Cette page n'en
 * est que le cadre — navbar MGS, titre, règles — et l'affiche en <iframe>.
 *
 * Pourquoi PHP ne peut pas tenir ce rôle : le jeu a besoin d'un processus qui
 * garde l'état de la partie EN MÉMOIRE entre deux messages et qui pousse 20
 * fois par seconde en WebSocket. Un script PHP démarre et meurt à chaque
 * requête. Le conteneur Node, lui, reste vivant.
 *
 * Comme /game/index.php, cette page est PUBLIQUE et ne touche ni à la base
 * de données ni à config.php : une panne MySQL ne l'empêche pas de sortir.
 */

require_once __DIR__ . '/../../php/views/navbar.php';

/* ------------------------------------------------------------------
   L'adresse du jeu.

   '/jeu' = le chemin servi par Apache (ProxyPass vers le conteneur
   `arene`, cf. jeux/arene/apache/mgs-arene.conf). Même domaine, même
   certificat, rien à configurer côté navigateur.

   Laisser la chaîne vide affiche un encart d'attente au lieu d'une
   iframe cassée : pratique tant que le conteneur n'est pas en place.
------------------------------------------------------------------ */
const MGS_ARENE_URL = 'https://jeu.my-gamers-stats.com';

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
$userId   = null;

if (($_SESSION['logged'] ?? false) === true && !empty($_SESSION['username'])) {
    $username = (string) $_SESSION['username'];
    $userId   = (int) ($_SESSION['user_id'] ?? 0) ?: null;
}

// Plus rien n'a besoin de la session : on la relâche pour ne pas bloquer
// les autres requêtes de l'onglet.
session_write_close();

/* ------------------------------------------------------------------
   Photo de profil Steam, pour le skin par défaut en jeu.

   Best-effort UNIQUEMENT : cette page reste volontairement DB-free pour
   tout visiteur non connecté (voir le commentaire d'en-tête). Pour un
   joueur connecté, on tente la base ; toute panne (MySQL indisponible,
   clé API absente, aucun compte Steam lié) est rattrapée ici et retombe
   simplement sur « pas d'avatar » — jamais sur une page cassée.
------------------------------------------------------------------ */
$avatarUrl = '';

if ($userId !== null) {
    try {
        $mgsConfigFile = __DIR__ . '/../../config.php';

        if (is_file($mgsConfigFile)) {
            $config = require $mgsConfigFile;   // définit $conn

            require_once __DIR__ . '/../../php/links-model.php';
            require_once __DIR__ . '/../../php/core/cache.php';
            require_once __DIR__ . '/../../php/providers/steam.php';

            $steamId = mgs_get_primary_account($conn, $userId, 'steam');

            if ($steamId !== null) {
                $apiKey = $config['PLATFORMS']['steam']['api_key'] ?? '';

                if ($apiKey !== '') {
                    $cacheFile = mgs_cache_file('avatar', 'steam', [$steamId]);
                    $cache     = mgs_cache_read($cacheFile, 600);

                    if ($cache !== null) {
                        $avatarUrl = (string) ($cache['avatar'] ?? '');
                    } else {
                        $avatar = steam_fetch_avatar(['api_key' => $apiKey], $steamId);
                        @file_put_contents($cacheFile, json_encode(['avatar' => $avatar]), LOCK_EX);
                        $avatarUrl = (string) ($avatar ?? '');
                    }
                }
            }
        }
    } catch (Throwable $e) {
        error_log('arene avatar: ' . $e->getMessage());
        $avatarUrl = '';
    }
}

/* ------------------------------------------------------------------
   L'URL passée à l'iframe.

   On transmet le pseudo MGS pour que le champ du jeu soit pré-rempli, et
   le salon. Les deux passent par rawurlencode : un pseudo contenant « & »
   ne doit pas pouvoir inventer un paramètre.

   Le salon vient de l'URL, donc du visiteur : on le borne aux mêmes
   caractères que le Worker (lettres, chiffres, tiret), sinon n'importe
   qui peut faire créer une infinité de salles.

   La photo Steam (avatarUrl, calculée plus haut) part telle quelle : le
   serveur du jeu la revalide de son côté (domaine Steam autorisé) avant de
   la rediffuser aux autres joueurs, donc pas besoin de la restreindre ici.
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
        . ($username !== '' ? '&nom=' . rawurlencode($username) : '')
        . ($avatarUrl !== '' ? '&avatar=' . rawurlencode($avatarUrl) : '');
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
                Le serveur de l'arène est le conteneur <code>arene</code> du
                <code>docker-compose.yml</code>, et Apache lui passe
                <code>/jeu/</code>. Une fois les deux en place, renseigner
                <code>MGS_ARENE_URL</code> en tête de ce fichier.
            </p>
        </div>

    <?php else: ?>

        <div class="arene-cadre">
            <iframe
                class="arene-iframe"
                src="<?= htmlspecialchars($jeuUrl, ENT_QUOTES, 'UTF-8') ?>"
                title="Arène MGS"
                allow="fullscreen; pointer-lock"
                allowfullscreen
                referrerpolicy="no-referrer"></iframe>
        </div>

        <p class="arene-note">
            Clique dans le jeu avant de jouer : sans ça, le clavier reste sur la
            page. Une fois entré dans l'arène, la souris reste capturée dans le
            jeu — Échap est la seule touche qui la libère. Ouvre cette adresse
            dans un deuxième onglet, ou envoie-la à un ami, pour voir le
            multijoueur.
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
