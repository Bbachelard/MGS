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

/* bootstrap.php lit TOUJOURS dirname(__DIR__, 2) . '/config.php'. Le
   rappeler ici évite le piège classique du déploiement conteneurisé :
   sur l'hôte ce chemin peut pointer vers un fichier périmé, alors que
   le vrai config.php n'existe qu'à l'intérieur du conteneur. */
$mgsConf   = dirname(__DIR__) . '/config.php';
$dansDocker = is_file('/.dockerenv') || is_file('/run/.containerenv');

echo "\n=== Environnement ===\n";
printf("config.php lu   : %s\n", $mgsConf);
printf("Exécution       : %s\n", $dansDocker ? 'dans un conteneur' : "sur l'hôte");

if (!is_file($mgsConf)) {
    exit("\nCe fichier n'existe pas.\n" . diag_aide_docker($dansDocker));
}

// Sans cette garde, bootstrap.php répondrait une page d'erreur HTML,
// illisible dans un terminal.
require_once __DIR__ . '/core/bootstrap.php';
require_once __DIR__ . '/providers/riot.php';

if (!mgs_config('PLATFORMS')) {
    exit("\nCe fichier existe mais ne fournit aucune plateforme : ce n'est pas\n"
       . "le config.php du site (il ne renvoie pas de tableau, ou il est périmé).\n"
       . diag_aide_docker($dansDocker));
}

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

/** Le cas de loin le plus fréquent : bon fichier, mauvais environnement. */
function diag_aide_docker(bool $dansDocker): string
{
    if ($dansDocker) {
        return "\nOn est bien dans le conteneur : c'est donc le montage de config.php\n"
             . "qu'il faut revoir dans docker-compose.yml.\n\n";
    }

    return "\nLe site tourne visiblement dans Docker (config.php est monté dans le\n"
         . "conteneur, pas posé à côté du code sur l'hôte). Relancer DEDANS :\n\n"
         . "  docker compose ps                      # repérer le service web\n"
         . "  docker compose exec web php php/diag-valorant.php Pseudo#TAG\n\n"
         . "En remplaçant « web » par le nom réel du service.\n\n";
}

if (!str_starts_with($cle, 'HDEV-')) {
    echo "\n  /!\\ La clé ne commence pas par « HDEV- ». Clé HenrikDev attendue,\n"
       . "      pas la clé Riot RGAPI-.\n";
}

/* --- Quel compte tester ? ----------------------------------------- */

$riotId = null;
$region = 'euw1';
$arg    = $argv[1] ?? null;

if ($arg !== null && str_contains($arg, '#')) {
    $riotId = $arg;

    // Facultatif : on demande quand même à l'API Riot, pour vérifier au
    // passage que la clé LoL est valide et connaître la plateforme.
    $res = riot_resolve_account_id($cfg, $arg);

    echo "\n=== Contrôle côté API Riot ===\n";

    if ($res['ok']) {
        [$region] = explode(':', $res['accountId'], 2);
        echo "OK  plateforme = {$region}\n";
    } else {
        echo "Échec : " . $res['error'] . "\n"
           . "(sans conséquence pour Valorant : on n'utilise pas le PUUID de Riot)\n";
    }

} elseif (isset($conn) && $conn instanceof mysqli) {
    echo "\n=== Comptes Riot liés en base ===\n";

    $q = $conn->query(
        "SELECT platform_user_id, display_name FROM platform_links
          WHERE platform = 'riot' ORDER BY id DESC LIMIT 5"
    );

    $lignes = $q ? $q->fetch_all(MYSQLI_ASSOC) : [];

    foreach ($lignes as $i => $l) {
        printf("  [%d] %-24s %s\n", $i, $l['display_name'] ?? '?', $l['platform_user_id']);
    }

    // display_name porte le Riot ID ; le PUUID stocké, lui, est chiffré
    // par clé et ne sert à rien face au fournisseur Valorant.
    foreach ($lignes as $l) {
        if (str_contains((string)($l['display_name'] ?? ''), '#')) {
            $riotId = (string)$l['display_name'];

            if (str_contains((string)$l['platform_user_id'], ':')) {
                [$region] = explode(':', (string)$l['platform_user_id'], 2);
            }
            break;
        }
    }

    if ($riotId !== null) {
        echo "\nOn teste « {$riotId} ».\n";
    }
}

if ($riotId === null) {
    exit("\nAucun compte à tester. Relancer en donnant un Riot ID :\n"
       . "  php php/diag-valorant.php Pseudo#TAG\n\n");
}

$regionDefaut = RIOT_VAL_REGIONS[$region] ?? RIOT_VAL_REGION_DEFAUT;

echo "\n=== Compte testé ===\n";
printf("Riot ID          : %s\n", $riotId);
printf("Plateforme LoL   : %s\n", $region);
printf("Région par défaut: %s   (table RIOT_VAL_REGIONS, sert de repli)\n", $regionDefaut);

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

    return [
        'status' => $status,
        'body'   => (string)$corps,
        'curl'   => $erreur,
        'json'   => json_decode((string)$corps, true) ?: [],
    ];
}

/** Code HTTP + corps brut : c'est le corps qui porte le message utile. */
function diag_afficher(array $r): void
{
    printf("HTTP   : %d %s\n", $r['status'], diag_verdict($r['status']));

    if ($r['curl'] !== '') {
        echo "curl   : {$r['curl']}\n";
    }

    echo "Corps  : " . (strlen($r['body']) > 900
        ? substr($r['body'], 0, 900) . ' …[tronqué]'
        : $r['body']) . "\n";
}

/* --- Étape 1 : résoudre le Riot ID -------------------------------- */

[$nom, $tag] = array_map('trim', explode('#', $riotId, 2));

$urlCompte = sprintf(RIOT_VAL_URL_ACCOUNT, rawurlencode($nom), rawurlencode($tag));

echo "\n=== Compte Valorant (Riot ID -> PUUID + région) ===\n";
echo "URL    : {$urlCompte}\n";

$r = diag_get($urlCompte, $cle);
diag_afficher($r);

$puuid     = (string)($r['json']['data']['puuid']  ?? '');
$regionVal = strtolower((string)($r['json']['data']['region'] ?? ''));

if ($puuid === '') {
    exit("\nSans PUUID Valorant, inutile d'aller plus loin.\n"
       . "  403 -> clé refusée\n"
       . "  404 -> ce Riot ID n'a jamais joué à Valorant, ou le tag est faux\n\n");
}

$regionVal = $regionVal !== '' ? $regionVal : $regionDefaut;

printf("\nPUUID Valorant : %s\n", $puuid);
printf("Région réelle  : %s\n", $regionVal);

/* --- Étape 2 : les deux routes de données ------------------------- */

$routes = [
    'MMR v3 (rang, RR, pic)' => sprintf(RIOT_VAL_URL_MMR, $regionVal, rawurlencode($puuid)),
    'Parties stockées'       => sprintf(RIOT_VAL_URL_MATCHES, $regionVal, rawurlencode($puuid), 5),
];

foreach ($routes as $nomRoute => $url) {
    echo "\n=== {$nomRoute} ===\n";
    echo "URL    : {$url}\n";
    diag_afficher(diag_get($url, $cle));
}

/* --- Et ce que le provider en fait -------------------------------- */

echo "\n=== Verdict du provider ===\n";

$val = riot_valorant_fetch($cfg, $riotId, $regionDefaut);

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
       . "ou ouvrir la carte du profil avec &refresh=1\n";
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
