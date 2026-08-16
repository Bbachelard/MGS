<?php
declare(strict_types=1);

/**
 * php/diag.php — diagnostic d'installation.
 *
 * URL à ouvrir telle quelle, la clé est déjà en place :
 *
 *   https://my-gamers-stats.com/php/diag.php?cle=mgs-diag-8f3a
 *
 * À SUPPRIMER une fois le problème réglé. Ce fichier ne révèle aucun
 * secret (ni mot de passe, ni clé d'API : seulement leur présence), mais
 * il décrit l'installation et n'a rien à faire en ligne durablement.
 *
 * Volontairement autonome : il ne charge NI bootstrap.php, NI
 * platforms.php, précisément pour pouvoir diagnostiquer le cas où ces
 * fichiers manquent.
 */

/* Garde-fou minimal : empêche un passant de tomber dessus. La valeur est
   déjà renseignée, il n'y a RIEN à modifier ici — il suffit d'ouvrir
   l'URL indiquée en haut du fichier. Libre à toi de la changer, mais
   alors change aussi le ?cle= dans l'URL. */
const DIAG_CLE = 'mgs-diag-8f3a';

if (($_GET['cle'] ?? '') !== DIAG_CLE) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    exit(
        "Cle attendue absente ou incorrecte.\n\n"
        . "Ouvre exactement cette adresse :\n"
        . "  " . ($_SERVER['REQUEST_SCHEME'] ?? 'https') . '://'
        . ($_SERVER['HTTP_HOST'] ?? 'my-gamers-stats.com')
        . strtok($_SERVER['REQUEST_URI'] ?? '/php/diag.php', '?')
        . '?cle=' . DIAG_CLE . "\n"
    );
}

ini_set('display_errors', '1');
error_reporting(E_ALL);
header('Content-Type: text/plain; charset=utf-8');

/* La session doit démarrer AVANT le moindre echo : après, PHP refuse
   d'envoyer le cookie et session_start() échoue. On la lit ici pour
   pouvoir rejouer session-status.php plus bas sur ton vrai compte. */
if (session_status() !== PHP_SESSION_ACTIVE) {
    @session_start();
}

$sessionConnecte = ($_SESSION['logged'] ?? false) === true
                   && (int) ($_SESSION['user_id'] ?? 0) > 0;
$sessionUserId   = (int) ($_SESSION['user_id'] ?? 0);

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
    'php/providers/riot/constantes.php',
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

/* ==================================================================
 *  REJEU DES APPELS QUI ÉCHOUENT
 *
 *  C'est la partie qui donne la réponse. On rejoue ici, pas à pas, ce
 *  que font session-status.php et api.php, en annonçant chaque étape
 *  AVANT de l'exécuter.
 *
 *  Une erreur fatale PHP n'est pas rattrapable par un try/catch : elle
 *  tue le script. Mais register_shutdown_function() s'exécute quand
 *  même — donc soit on voit l'erreur complète, soit la dernière étape
 *  annoncée désigne la ligne coupable.
 *
 *  Visite cette page depuis le navigateur où tu es CONNECTÉ : le cookie
 *  de session part avec la requête et le rejeu se fait sur ton compte.
 * ================================================================== */

$etape = 'aucune';

register_shutdown_function(static function () use (&$etape): void {
    $e = error_get_last();

    if ($e !== null && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        echo "\n";
        echo "########################################################\n";
        echo "#  ERREUR FATALE ATTRAPÉE — C'EST LA CAUSE DU 500      #\n";
        echo "########################################################\n";
        echo "  message : {$e['message']}\n";
        echo "  fichier : {$e['file']}\n";
        echo "  ligne   : {$e['line']}\n";
        echo "  étape   : $etape\n";
        echo "\n>>> Copie ce bloc entier. <<<\n";
    } else {
        echo "\n(fin normale — dernière étape atteinte : $etape)\n";
        echo "Pense à supprimer ce fichier une fois terminé.\n";
    }
});

titre('REJEU DE session-status.php');

try {
    $etape = 'lecture de la session';
    $connecte = $sessionConnecte;

    ligne(true, 'session lue', $connecte
        ? 'CONNECTÉ — user_id=' . $sessionUserId
        : 'NON connecté (ouvre cette page dans l\'onglet où tu es connecté)');

    if ($connecte && $conn instanceof mysqli) {
        $viewerId = $sessionUserId;

        $etape = 'require links-model.php';
        require_once __DIR__ . '/links-model.php';
        ligne(true, 'links-model.php chargé');

        $etape = 'require friends-model.php';
        require_once __DIR__ . '/friends-model.php';
        ligne(true, 'friends-model.php chargé');

        $etape = 'mgs_resolve_profile_target()';
        $targetId = mgs_resolve_profile_target($conn, $viewerId, null);
        ligne($targetId !== null, 'mgs_resolve_profile_target()', 'cible = ' . var_export($targetId, true));

        $etape = 'SELECT username, email FROM users';
        $stmt = $conn->prepare('SELECT username, email FROM users WHERE id = ? LIMIT 1');
        $stmt->bind_param('i', $viewerId);
        $stmt->execute();
        $u = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        ligne($u !== null, 'lecture de l\'utilisateur', $u === null ? 'introuvable' : 'ok');

        $etape = 'mgs_get_user_accounts()';
        $comptes = mgs_get_user_accounts($conn, $viewerId);
        ligne(true, 'mgs_get_user_accounts()',
              implode(', ', array_map(fn($s, $l) => "$s:" . count($l), array_keys($comptes), $comptes)));

        foreach (mgs_platforms() as $slug => $pf) {
            $etape = "boucle plateformes : $slug — mgs_load_provider()";
            $ok = mgs_load_provider($slug);

            $etape = "boucle plateformes : $slug — mgs_provider_supports(fetch_games)";
            $lib = $ok && mgs_provider_supports($slug, 'fetch_games');

            $etape = "boucle plateformes : $slug — mgs_max_accounts()";
            $max = mgs_max_accounts($slug);

            ligne(true, "plateforme $slug", "provider=" . ($ok ? 'ok' : 'ÉCHEC')
                        . ", bibliothèque=" . ($lib ? 'oui' : 'non') . ", max=$max");
        }

        $etape = 'fin du rejeu session-status';
        ligne(true, 'REJEU COMPLET SANS ERREUR',
              'session-status.php devrait donc répondre — vide le cache et réessaie');
    }
} catch (Throwable $e) {
    ligne(false, 'REJEU session-status', get_class($e) . ' : ' . $e->getMessage()
                 . ' — ' . $e->getFile() . ':' . $e->getLine());
    echo "\n  pile d'appels :\n  " . str_replace("\n", "\n  ", $e->getTraceAsString()) . "\n";
}

/* ------------------------------------------------------------------ */
titre('REJEU DE api.php (Riot)');

/* Ajoute &account=euw1:xxxx à l'URL pour rejouer un compte précis. */
$compte = trim((string) ($_GET['account'] ?? ''));

if ($compte === '') {
    echo "  (ajoute &account=euw1:TON_PUUID à l'URL pour rejouer cet appel)\n";
} elseif (!is_array($config)) {
    ligne(false, 'rejeu Riot', 'config.php non chargée');
} else {
    try {
        $etape = 'mgs_load_provider(riot)';
        mgs_load_provider('riot');

        $etape = 'riot_fetch_stats()';
        $r = riot_fetch_stats($config['PLATFORMS']['riot'] ?? [], $compte);

        if (!empty($r['ok'])) {
            ligne(true, 'riot_fetch_stats()', 'succès — le compte remonte bien');
        } else {
            ligne(false, 'riot_fetch_stats()',
                  'statut ' . ($r['status'] ?? '?') . ' — ' . ($r['error'] ?? ''));

            if (($r['status'] ?? 0) === 500) {
                echo "\n  >>> « Clé API Riot invalide ou expirée » renvoie un HTTP 500.\n";
                echo "  >>> Une clé de DÉVELOPPEMENT Riot expire toutes les 24 heures.\n";
                echo "  >>> Régénère-la sur https://developer.riotgames.com et\n";
                echo "  >>> mets PLATFORMS.riot.api_key à jour dans config.php.\n";
                echo "  >>> Ce comportement est d'origine, il n'a pas changé.\n";
            }
        }
    } catch (Throwable $e) {
        ligne(false, 'REJEU Riot', get_class($e) . ' : ' . $e->getMessage()
                     . ' — ' . $e->getFile() . ':' . $e->getLine());
    }
}

/* ------------------------------------------------------------------ */
titre('Journal des erreurs PHP');

$log = ini_get('error_log');
echo "  chemin : " . ($log !== '' ? $log : '(non défini — voir le journal du serveur web)') . "\n";
echo "  log_errors : " . ini_get('log_errors') . "\n";
echo "  Cherches-y la ligne « mgs FATAL [référence] » correspondant au 500.\n";

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
