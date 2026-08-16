<?php
declare(strict_types=1);

/* ==================================================================
 *  php/core/bootstrap.php — amorçage commun à TOUS les points d'entrée.
 *
 *  Un seul require au lieu des 4 à 6 lignes recopiées en tête de
 *  chaque script :
 *
 *      require_once __DIR__ . '/core/bootstrap.php';
 *
 *  Après ce require sont disponibles :
 *    $config  tableau de configuration (config.php)
 *    $conn    connexion mysqli (définie par config.php)
 *    les helpers de core/http.php et core/auth.php
 *    le registre des plateformes (platforms.php)
 *
 *  IMPORTANT : à inclure au niveau global du fichier appelant (jamais
 *  dans une fonction), sans quoi $conn et $config ne seraient pas des
 *  variables globales et les modèles ne les verraient pas.
 * ================================================================== */

if (defined('MGS_BOOTSTRAPPED')) {
    return;
}

define('MGS_BOOTSTRAPPED', true);

/* ------------------------------------------------------------------
   Affichage des erreurs
   ------------------------------------------------------------------
   En production, une notice PHP affichée fuite le chemin absolu du
   serveur ET casse toute réponse JSON (du HTML avant le « { »). On
   journalise donc sans afficher.

   Mais couper display_errors sans rien mettre à la place transforme
   toute erreur fatale en réponse VIDE avec un code 500 : côté client on
   ne lit plus qu'un « Unexpected end of JSON input », qui ne dit rien.
   D'où le gestionnaire ci-dessous : quoi qu'il arrive, un corps JSON
   exploitable part, et le détail complet va dans le journal PHP.

   MGS_DEBUG=1 dans l'environnement renvoie le détail au client aussi.
------------------------------------------------------------------ */
define('MGS_DEBUG', getenv('MGS_DEBUG') === '1');

ini_set('display_errors', MGS_DEBUG ? '1' : '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

/**
 * Émet une réponse d'erreur lisible et journalise le détail.
 *
 * Le client reçoit du JSON si la réponse était déclarée en JSON
 * (mgs_json_header) ou si la requête est une requête d'API ; sinon une
 * page HTML minimale. Dans les deux cas, un identifiant court permet de
 * retrouver la ligne correspondante dans le journal du serveur.
 */
function mgs_erreur_fatale(string $detail): void
{
    $ref = substr(bin2hex(random_bytes(4)), 0, 8);

    error_log('mgs FATAL [' . $ref . '] ' . $detail);

    if (headers_sent()) {
        return;   // une réponse est déjà partie, on n'aggrave pas
    }

    // Vide tout tampon partiel : sans ça le JSON s'ajoute à du HTML tronqué.
    while (ob_get_level() > 0) {
        ob_end_clean();
    }

    http_response_code(500);

    $message = MGS_DEBUG
        ? $detail
        : 'Erreur interne du serveur. Référence : ' . $ref;

    $estJson = defined('MGS_REPONSE_JSON')
               || str_contains($_SERVER['REQUEST_URI'] ?? '', '/php/');

    if ($estJson) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE);
        return;
    }

    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html lang="fr"><meta charset="UTF-8">'
       . '<title>Erreur</title>'
       . '<body style="font-family:sans-serif;background:#1f1f1f;color:#fff;padding:40px">'
       . '<h1>Erreur interne</h1><p>'
       . htmlspecialchars($message, ENT_QUOTES, 'UTF-8')
       . '</p></body></html>';
}

set_exception_handler(static function (Throwable $e): void {
    mgs_erreur_fatale(
        get_class($e) . ' : ' . $e->getMessage()
        . ' — ' . $e->getFile() . ':' . $e->getLine()
    );
});

register_shutdown_function(static function (): void {
    $err = error_get_last();

    // Seules les erreurs qui arrêtent le script nous intéressent ici :
    // les warnings sont déjà journalisés et n'empêchent pas la réponse.
    if ($err === null || !in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        return;
    }

    mgs_erreur_fatale($err['message'] . ' — ' . $err['file'] . ':' . $err['line']);
});

/* ------------------------------------------------------------------
   Configuration + connexion base de données
------------------------------------------------------------------ */
$mgsConfigFile = dirname(__DIR__, 2) . '/config.php';

if (!is_file($mgsConfigFile)) {
    mgs_erreur_fatale('config.php introuvable : ' . $mgsConfigFile);
    exit;
}

// config.php renvoie le tableau de config ET définit $conn (mysqli).
$config = require $mgsConfigFile;

if (!is_array($config)) {
    error_log('mgs bootstrap: config.php ne renvoie pas de tableau de configuration.');
    $config = [];
}

$GLOBALS['mgs_config'] = $config;

unset($mgsConfigFile);

/* ------------------------------------------------------------------
   Briques communes
------------------------------------------------------------------ */
require_once __DIR__ . '/http.php';
require_once __DIR__ . '/auth.php';
require_once dirname(__DIR__) . '/platforms.php';

/**
 * Lit une clé de configuration sans dépendre de la variable $config,
 * ce qui permet de l'utiliser depuis l'intérieur d'une fonction.
 *
 *   mgs_config('SITE_URL')
 *   mgs_config(['PLATFORMS', 'steam'], [])
 *
 * @param  string|list<string> $cle
 */
function mgs_config(string|array $cle, mixed $defaut = null): mixed
{
    $valeur = $GLOBALS['mgs_config'] ?? [];

    foreach ((array) $cle as $segment) {
        if (!is_array($valeur) || !array_key_exists($segment, $valeur)) {
            return $defaut;
        }
        $valeur = $valeur[$segment];
    }

    return $valeur;
}

/** Réglages d'une plateforme (clés d'API...), tableau vide si absente. */
function mgs_platform_config(string $slug): array
{
    $cfg = mgs_config(['PLATFORMS', $slug], []);

    return is_array($cfg) ? $cfg : [];
}

/** URL publique du site, sans slash final. */
function mgs_site_url(): string
{
    return rtrim((string) mgs_config('SITE_URL', 'https://my-gamers-stats.com'), '/');
}
