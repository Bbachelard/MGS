<?php
/* ==================================================================
 *  DIAGNOSTIC TEMPORAIRE — À SUPPRIMER une fois le problème réglé.
 *
 *  Usage :  /php/debug-riot.php?id=BlackBen%23bozo
 *           (le # doit être encodé en %23, sinon le navigateur
 *            coupe l'URL avant et $_GET['id'] arrive vide)
 * ================================================================== */

declare(strict_types=1);

session_start();

require_once __DIR__ . '/platforms.php';

$config = require __DIR__ . '/../config.php';

header('Content-Type: text/plain; charset=utf-8');

if (!isset($_SESSION['user_id'])) {
    exit("Connecte-toi d'abord sur le site, puis recharge cette page.\n");
}

if (!mgs_load_provider('riot')) {
    exit("providers/riot.php introuvable.\n");
}

$cfg = $config['PLATFORMS']['riot'] ?? [];

echo "=== 1. CONFIG ===\n";
echo 'Clé API présente : ' . (($cfg['api_key'] ?? '') !== '' ? 'oui' : 'NON') . "\n";
echo 'Clé (début)      : ' . substr((string)($cfg['api_key'] ?? ''), 0, 12) . "...\n";
echo 'Région par défaut: ' . ($cfg['default_region'] ?? 'non définie') . "\n\n";

echo "=== 2. VÉRIFICATION EN SESSION ===\n";
if (isset($_SESSION['verify'])) {
    $v = $_SESSION['verify'];
    echo 'Plateforme  : ' . ($v['platform'] ?? '?') . "\n";
    echo 'AccountId   : ' . ($v['accountId'] ?? '?') . "\n";
    echo 'Icône cible : ' . ($v['iconId'] ?? '?') . "   <<<< LA VALEUR ATTENDUE\n";
    echo 'Icône avant : ' . var_export($v['previous'] ?? null, true) . "\n";
    echo 'Tentatives  : ' . ($v['tries'] ?? 0) . "\n";
    echo 'Expire dans : ' . max(0, (int)($v['expires'] ?? 0) - time()) . " s\n";
} else {
    echo "Aucune vérification en cours en session.\n";
    echo "(normal si tu as fermé la modale entre-temps)\n";
}
echo "\n";

$riotId = (string)($_GET['id'] ?? '');

if ($riotId === '') {
    exit("=== 3. ===\nAjoute ?id=TonPseudo%23TonTag à l'URL pour interroger l'API.\n");
}

echo "=== 3. RÉSOLUTION DU RIOT ID ===\n";
echo "Saisi : {$riotId}\n";

$resolved = riot_resolve_account_id($cfg, $riotId);
print_r($resolved);
echo "\n";

if (!$resolved['ok']) {
    exit("Résolution échouée, on s'arrête là.\n");
}

[$region, $puuid] = explode(':', $resolved['accountId'], 2);

echo "=== 4. RÉPONSE BRUTE summoner-v4 ===\n";
echo "URL : https://{$region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/{PUUID}\n\n";

$raw = riot_get(
    "https://{$region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/" . rawurlencode($puuid),
    (string)($cfg['api_key'] ?? '')
);

echo 'Code HTTP : ' . $raw['status'] . "\n";
print_r($raw['data']);
echo "\n";

if (isset($raw['data']['profileIconId'])) {
    echo ">>> ICÔNE ACTUELLE SELON L'API : " . (int)$raw['data']['profileIconId'] . "\n";
}

if (isset($raw['data']['revisionDate'])) {
    // Riot renvoie parfois des secondes, parfois des millisecondes
    $rev = (int)$raw['data']['revisionDate'];
    $rev = $rev > 20000000000 ? intdiv($rev, 1000) : $rev;

    $age = time() - $rev;

    echo ">>> DERNIÈRE MODIF DU COMPTE : " . date('d/m/Y H:i:s', $rev)
         . "  (il y a " . intdiv($age, 60) . " min)\n";
    echo "    Si cette date est ANTÉRIEURE à ton changement d'icône,\n";
    echo "    c'est Riot qui n'a pas encore propagé. Si elle est POSTÉRIEURE,\n";
    echo "    le compte a bien bougé mais l'icône posée n'est pas la bonne.\n";
}

echo "\n=== 5. VERDICT ===\n";

$attendu = $_SESSION['verify']['iconId'] ?? null;
$actuel  = $raw['data']['profileIconId'] ?? null;

if ($attendu === null) {
    echo "Pas de vérification en session : relance la modale puis recharge cette page.\n";
} elseif ($actuel === null) {
    echo "L'API n'a pas répondu correctement (voir code HTTP ci-dessus).\n";
} elseif ((int)$actuel === (int)$attendu) {
    echo "LES DEUX CORRESPONDENT. Le bug est côté code, pas côté Riot.\n";
} else {
    echo "ATTENDU {$attendu}, REÇU {$actuel}. Voir le tableau d'interprétation.\n";
}