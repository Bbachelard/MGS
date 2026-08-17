<?php
declare(strict_types=1);

/* ==================================================================
 *  php/diag-valorant.php — diagnostic de la connexion Valorant.
 *
 *  À LANCER EN LIGNE DE COMMANDE UNIQUEMENT :
 *
 *      php site_web/php/diag-valorant.php
 *      php site_web/php/diag-valorant.php Pseudo#TAG
 *
 *  Le script interroge le fournisseur avec la clé de config.php et
 *  affiche le CODE HTTP et le CORPS BRUT de chaque route. C'est la
 *  seule façon de distinguer une clé refusée d'une route qui a bougé :
 *  la carte du site, elle, dit « temporairement indisponibles » dans
 *  les deux cas — volontairement, pour ne pas exposer la configuration
 *  du site au visiteur.
 *
 *  Refuse de tourner via le navigateur : il afficherait la clé d'API.
 *  Fichier de diagnostic, supprimable une fois le problème réglé.
 * ================================================================== */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("Ce script ne s'exécute qu'en ligne de commande.\n");
}

// Sans cette garde, bootstrap.php répond une page d'erreur HTML — illisible
// dans un terminal, et sans dire quel fichier manque.
if (!is_file(dirname(__DIR__) . '/config.php')) {
    exit("config.php introuvable : " . dirname(__DIR__) . "/config.php\n"
       . "Le copier depuis config.example.php et le remplir.\n\n");
}

require_once __DIR__ . '/core/bootstrap.php';
require_once __DIR__ . '/providers/riot.php';

$cfg   = mgs_platform_config('riot');
$cle   = (string)($cfg['valorant_api_key'] ?? '');
$riot  = (string)($cfg['api_key'] ?? '');

echo "\n=== Configuration ===\n";
printf("Clé Riot (LoL)  : %s\n", $riot === '' ? 'ABSENTE' : substr($riot, 0, 9) . '… (' . strlen($riot) . ' car.)');
printf("Clé Valorant    : %s\n", $cle  === '' ? 'ABSENTE' : substr($cle, 0, 9) . '… (' . strlen($cle) . ' car.)');

if ($cle === '') {
    exit("\nLa clé Valorant n'est pas lue. Vérifier que config.php contient bien :\n"
       . "  'riot' => ['api_key' => '…', 'valorant_api_key' => 'HDEV-…'],\n"
       . "et que la clé est DANS le bloc 'riot', pas à côté.\n\n");
}

if (!str_starts_with($cle, 'HDEV-')) {
    echo "\n  /!\\ La clé ne commence pas par « HDEV- ». Clé HenrikDev attendue,\n"
       . "      pas la clé Riot RGAPI-.\n";
}

/* --- Quel compte tester ? ----------------------------------------- */

$puuid  = null;
$region = 'euw1';
$argRiotId = $argv[1] ?? null;

if ($argRiotId !== null && str_contains($argRiotId, '#')) {
    echo "\n=== Résolution de « {$argRiotId} » via l'API Riot ===\n";

    $res = riot_resolve_account_id($cfg, $argRiotId);

    if (!$res['ok']) {
        exit("Échec : " . $res['error'] . "\n"
           . "(clé Riot expirée ? les clés de développement durent 24 h)\n\n");
    }

    [$region, $puuid] = explode(':', $res['accountId'], 2);
    echo "OK  accountId = {$res['accountId']}\n";

} elseif ($argRiotId !== null) {
    // PUUID brut, éventuellement préfixé de sa plateforme : "euw1:abc…".
    // Court-circuite l'API Riot : on teste Valorant même si la clé LoL
    // a expiré, ce qui arrive toutes les 24 h avec une clé de dev.
    if (str_contains($argRiotId, ':')) {
        [$region, $puuid] = explode(':', $argRiotId, 2);
    } else {
        $puuid = $argRiotId;
    }

} elseif (isset($conn) && $conn instanceof mysqli) {
    echo "\n=== Comptes Riot liés en base ===\n";

    $q = $conn->query(
        "SELECT platform_user_id, display_name FROM platform_links
          WHERE platform = 'riot' ORDER BY id DESC LIMIT 5"
    );

    $lignes = $q ? $q->fetch_all(MYSQLI_ASSOC) : [];

    if (!$lignes) {
        exit("Aucun compte Riot lié. Relancer avec un Riot ID :\n"
           . "  php site_web/php/diag-valorant.php Pseudo#TAG\n\n");
    }

    foreach ($lignes as $i => $l) {
        printf("  [%d] %-22s %s\n", $i, $l['display_name'] ?? '?', $l['platform_user_id']);
    }

    $premier = $lignes[0]['platform_user_id'];

    if (str_contains($premier, ':')) {
        [$region, $puuid] = explode(':', $premier, 2);
    } else {
        $puuid = $premier;
    }

    echo "\nOn teste le premier.\n";
}

if ($puuid === null || $puuid === '') {
    exit("\nAucun compte à tester. Relancer en donnant un compte :\n"
       . "  php site_web/php/diag-valorant.php Pseudo#TAG      (via l'API Riot)\n"
       . "  php site_web/php/diag-valorant.php euw1:le-puuid   (sans l'API Riot)\n\n");
}

$regionVal = RIOT_VAL_REGIONS[$region] ?? RIOT_VAL_REGION_DEFAUT;

echo "\n=== Compte testé ===\n";
printf("PUUID           : %s\n", $puuid);
printf("Plateforme LoL  : %s\n", $region);
printf("Région Valorant : %s   (table RIOT_VAL_REGIONS)\n", $regionVal);

/* --- Appel brut, sans passer par le provider ---------------------- */

function diag_get(string $url, string $cle): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => ['Authorization: ' . $cle, 'Accept: application/json'],
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_ENCODING       => '',
    ]);

    $corps  = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $erreur = curl_error($ch);
    curl_close($ch);

    return ['status' => $status, 'body' => (string)$corps, 'curl' => $erreur];
}

$routes = [
    'MMR v3 (rang, RR, pic)' => sprintf(RIOT_VAL_URL_MMR, $regionVal, rawurlencode($puuid)),
    'Parties stockées'       => sprintf(RIOT_VAL_URL_MATCHES, $regionVal, rawurlencode($puuid), 5),
];

foreach ($routes as $nom => $url) {
    echo "\n=== {$nom} ===\n";
    echo "URL    : {$url}\n";

    $r = diag_get($url, $cle);

    printf("HTTP   : %d %s\n", $r['status'], diag_verdict($r['status']));

    if ($r['curl'] !== '') {
        echo "curl   : {$r['curl']}\n";
    }

    $corps = $r['body'];
    echo "Corps  : " . (strlen($corps) > 900 ? substr($corps, 0, 900) . ' …[tronqué]' : $corps) . "\n";
}

/* --- Et ce que le provider en fait -------------------------------- */

echo "\n=== Verdict du provider ===\n";

$val = riot_valorant_fetch($cfg, $puuid, $regionVal);

printf("state   : %s\n", $val['state']);
printf("message : %s\n", riot_valorant_message($val['state']));

if ($val['state'] === 'ok') {
    printf("rang    : %s (%d RR)\n",
        riot_val_format_rank((int)$val['current']['tierId']), (int)$val['current']['rr']);
    printf("pic     : %s\n", riot_val_format_rank((int)$val['peak']['tierId']));
    printf("parties : %d classées, %d victoires\n",
        (int)$val['totals']['games'], (int)$val['totals']['wins']);
    printf("récent  : %d parties, %d agents\n", count($val['matches']), count($val['agents']));
    echo "\nTout va bien côté API.\n"
       . "Si le site affiche encore l'ancien message, c'est le CACHE :\n"
       . "  rm -rf site_web/cache/api/*\n"
       . "ou ouvrir /php/api.php?platform=riot&accountId={$region}:{$puuid}&refresh=1\n";
}

echo "\n";

function diag_verdict(int $status): string
{
    return match (true) {
        $status === 200 => '— OK',
        $status === 0   => "— aucune réponse (pare-feu ? sorties HTTPS bloquées ?)",
        $status === 400 => '— requête refusée : région ou PUUID mal formé',
        $status === 401 => "— CLÉ REFUSÉE (absente ou mal envoyée)",
        $status === 403 => "— CLÉ REFUSÉE (invalide, révoquée, ou pas les droits)",
        $status === 404 => '— route ou compte introuvable',
        $status === 429 => '— quota dépassé, réessayer dans une minute',
        $status >= 500  => '— panne côté fournisseur',
        default         => '',
    };
}
