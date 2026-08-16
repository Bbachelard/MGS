<?php
declare(strict_types=1);

/**
 * php/diag.php — diagnostic d'installation.
 *
 *   https://my-gamers-stats.com/php/diag.php?cle=CHANGE-MOI
 *
 * À SUPPRIMER une fois le problème réglé. Ce fichier ne révèle aucun
 * secret (ni mot de passe, ni clé d'API : seulement leur présence), mais
 * il décrit l'installation et n'a rien à faire en ligne durablement.
 *
 * Volontairement autonome : il ne charge NI bootstrap.php, NI
 * platforms.php, précisément pour pouvoir diagnostiquer le cas où ces
 * fichiers manquent.
 */

/* Garde-fou minimal : change cette valeur avant de déposer le fichier. */
const DIAG_CLE = 'CHANGE-MOI';

if (($_GET['cle'] ?? '') !== DIAG_CLE) {
    http_response_code(404);
    exit('Not found');
}

ini_set('display_errors', '1');
error_reporting(E_ALL);
header('Content-Type: text/plain; charset=utf-8');

$racine = dirname(__DIR__);
$ko = 0;

function titre(string $t): void { echo "\n=== $t ===\n"; }
function ligne(bool $ok, string $libelle, string $detail = ''): void {
    global $ko;
    if (!$ok) { $ko++; }
    printf("[%s] %-46s %s\n", $ok ? ' OK ' : 'ÉCHEC', $libelle, $detail);
}

echo "DIAGNOSTIC MY GAMERS STATS — " . date('Y-m-d H:i:s') . "\n";
echo "racine : $racine\n";

/* ------------------------------------------------------------------ */
titre('PHP');

ligne(PHP_VERSION_ID >= 80300, 'PHP >= 8.3', 'version installée : ' . PHP_VERSION);

foreach (['curl', 'mysqli', 'mbstring', 'json', 'openssl'] as $ext) {
    ligne(extension_loaded($ext), "extension $ext");
}

/* ------------------------------------------------------------------ */
titre('Fichiers attendus');

/* Les fichiers créés par la réorganisation. Un déploiement par FTP qui
   ne copie que les fichiers MODIFIÉS rate les dossiers NOUVEAUX : c'est
   la cause n°1 d'une erreur 500 après cette mise à jour. */
$fichiers = [
    'php/platforms.php',
    'php/core/bootstrap.php',
    'php/core/http.php',
    'php/core/auth.php',
    'php/core/cache.php',
    'php/core/account-resolver.php',
    'php/views/head.php',
    'php/views/navbar.php',
    'php/views/friend-card.php',
    'php/providers/steam.php',
    'php/providers/epic.php',
    'php/providers/riot.php',
    'php/providers/riot/config.php',
    'php/providers/riot/http.php',
    'php/providers/riot/ranks.php',
    'php/providers/riot/assets.php',
    'php/providers/riot/stats.php',
    'php/providers/riot/matches.php',
    'php/providers/riot/verify.php',
    'php/links-model.php',
    'php/friends-model.php',
    'php/suggest-model.php',
    'php/mailer.php',
    'vendor/autoload.php',
    'js/core/mgs-core.js',
    'content/css/modules/base.css',
    'content/css/modules/navbar-layout.css',
    'content/css/modules/home-search.css',
    'content/css/modules/home-hero.css',
    'content/css/modules/forms.css',
    'content/css/modules/form-messages.css',
    'content/css/modules/friends.css',
];

$manquants = [];

foreach ($fichiers as $f) {
    $existe = is_file($racine . '/' . $f);
    if (!$existe) { $manquants[] = $f; }
    ligne($existe, $f);
}

/* ------------------------------------------------------------------ */
titre('Emblèmes de rang (doivent être en MINUSCULES)');

foreach (['iron','bronze','silver','gold','platinum','emerald','diamond','master','grandmaster','challenger','unranked'] as $tier) {
    $attendu = "content/image/ranks/lol-{$tier}.png";
    $ok = is_file($racine . '/' . $attendu);
    $ancien = is_file($racine . "/content/image/ranks/Lol-{$tier}.png");
    ligne($ok, $attendu, $ok ? '' : ($ancien ? '← encore en « Lol- » majuscule, à renommer' : 'absent'));
}

/* ------------------------------------------------------------------ */
titre('Configuration');

$cfgFile = $racine . '/config.php';
ligne(is_file($cfgFile), 'config.php présent', $cfgFile);

$config = null;
$conn = null;

if (is_file($cfgFile)) {
    try {
        $config = require $cfgFile;
        ligne(is_array($config), 'config.php renvoie un tableau', is_array($config) ? '' : 'type reçu : ' . gettype($config));
        ligne(isset($conn) && $conn instanceof mysqli, 'config.php définit $conn (mysqli)');

        if (is_array($config)) {
            ligne(!empty($config['SITE_URL']), "clé SITE_URL", (string)($config['SITE_URL'] ?? ''));

            foreach (['steam' => 'api_key', 'riot' => 'api_key', 'epic' => 'client_id'] as $slug => $cle) {
                $v = $config['PLATFORMS'][$slug][$cle] ?? '';
                ligne($v !== '', "PLATFORMS.$slug.$cle renseignée",
                      $v === '' ? 'VIDE' : 'présente (' . strlen((string)$v) . ' caractères)');
            }
        }
    } catch (Throwable $e) {
        ligne(false, 'chargement de config.php', get_class($e) . ' : ' . $e->getMessage());
    }
}

ligne(is_file($racine . '/smtp-config.php'), 'smtp-config.php présent',
      'requis par php/mailer.php (mot de passe oublié)');

/* ------------------------------------------------------------------ */
titre('Base de données');

if ($conn instanceof mysqli) {
    try {
        $conn->query('SELECT 1');
        ligne(true, 'connexion MySQL', 'serveur ' . $conn->server_info);

        foreach (['users', 'platform_links', 'friendships', 'password_resets'] as $table) {
            $r = $conn->query("SHOW TABLES LIKE '$table'");
            ligne($r && $r->num_rows > 0, "table $table");
        }
    } catch (Throwable $e) {
        ligne(false, 'connexion MySQL', $e->getMessage());
    }
} else {
    ligne(false, 'connexion MySQL', '$conn absent — voir config.php');
}

/* ------------------------------------------------------------------ */
titre('Cache (doit être inscriptible par PHP)');

$cache = $racine . '/cache';

if (!is_dir($cache)) {
    @mkdir($cache, 0775, true);
}

ligne(is_dir($cache), 'dossier cache/ existe', $cache);
ligne(is_writable($cache), 'cache/ inscriptible',
      is_dir($cache) ? 'droits ' . substr(sprintf('%o', fileperms($cache)), -4) : '');

/* ------------------------------------------------------------------ */
titre('Chargement des providers');

if ($manquants === []) {
    try {
        require_once $racine . '/php/platforms.php';
        ligne(defined('MGS_ROOT'), 'MGS_ROOT défini', defined('MGS_ROOT') ? MGS_ROOT : '');

        foreach (array_keys(mgs_platforms()) as $slug) {
            $charge = mgs_load_provider($slug);
            $caps = [];

            foreach (['resolve_account_id','fetch_stats','fetch_games','fetch_matches','profile_icon'] as $a) {
                if (mgs_provider_supports($slug, $a)) { $caps[] = $a; }
            }

            ligne($charge && $caps !== [], "provider $slug", implode(', ', $caps));
        }

        if (function_exists('riot_rank_icon')) {
            $icone = riot_rank_icon('GOLD');
            ligne(
                str_starts_with($icone, '/content/'),
                'emblème de rang servi en local',
                $icone
            );
        }
    } catch (Throwable $e) {
        ligne(false, 'chargement des providers', get_class($e) . ' : ' . $e->getMessage()
                     . ' — ' . $e->getFile() . ':' . $e->getLine());
    }
} else {
    ligne(false, 'chargement des providers', 'sauté : des fichiers manquent (voir plus haut)');
}

/* ------------------------------------------------------------------ */
titre('Journal des erreurs PHP');

$log = ini_get('error_log');
echo "  chemin : " . ($log !== '' ? $log : '(non défini — voir le journal du serveur web)') . "\n";
echo "  log_errors : " . ini_get('log_errors') . "\n";

/* ------------------------------------------------------------------ */
titre('RÉSULTAT');

if ($ko === 0) {
    echo "Tout est en place. Si une erreur 500 persiste, regarde le journal\n";
    echo "des erreurs PHP ci-dessus : bootstrap.php y écrit une ligne\n";
    echo "« mgs FATAL [référence] … » pour chaque erreur fatale.\n";
} else {
    echo "$ko problème(s) détecté(s) — voir les lignes ÉCHEC ci-dessus.\n";

    if ($manquants !== []) {
        echo "\nFICHIERS MANQUANTS SUR LE SERVEUR (" . count($manquants) . ") :\n";
        foreach ($manquants as $f) {
            echo "  - $f\n";
        }
        echo "\nCes fichiers sont NOUVEAUX. Un déploiement qui ne copie que les\n";
        echo "fichiers modifiés ne crée pas les dossiers nouveaux (php/core/,\n";
        echo "php/views/, php/providers/riot/). Envoie ces dossiers entiers.\n";
    }
}

echo "\nPense à supprimer ce fichier une fois terminé.\n";
