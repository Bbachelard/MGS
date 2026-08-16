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
   En production une notice PHP qui s'affiche fuite le chemin absolu du
   serveur et casse toute réponse JSON. On journalise, on n'affiche pas.
   Passer MGS_DEBUG=1 dans l'environnement pour le comportement inverse
   en développement.
------------------------------------------------------------------ */
$mgsDebug = (getenv('MGS_DEBUG') === '1');

ini_set('display_errors', $mgsDebug ? '1' : '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

/* ------------------------------------------------------------------
   Configuration + connexion base de données
------------------------------------------------------------------ */
$mgsConfigFile = dirname(__DIR__, 2) . '/config.php';

if (!is_file($mgsConfigFile)) {
    error_log('mgs bootstrap: config.php introuvable (' . $mgsConfigFile . ')');
    http_response_code(500);
    exit('Configuration du site absente.');
}

// config.php renvoie le tableau de config ET définit $conn (mysqli).
$config = require $mgsConfigFile;

if (!is_array($config)) {
    $config = [];
}

$GLOBALS['mgs_config'] = $config;

unset($mgsConfigFile, $mgsDebug);

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
