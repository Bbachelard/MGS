<?php
declare(strict_types=1);

require_once __DIR__ . '/../platforms.php';

/** Durée de vie du cache de prix, en jours. */
const STEAM_PRIX_CACHE_JOURS = 30;

/** Nombre d'appels au Store par chargement. Le cache se remplit progressivement. */
const STEAM_PRIX_PAR_APPEL = 25;

/**
 * Jeux détaillés dans metrics.topGames, pour la ventilation du hub.
 * Au-delà, la barre devient un peigne illisible : le reste part dans
 * un segment « Autres jeux » reconstitué côté client.
 */
const STEAM_TOP_GAMES = 4;

/** Base des SteamID64 : 76561197960265728 = [U:1:0]. */
const STEAM_ID64_BASE = '76561197960265728';

/**
 * Additionne un offset 32 bits à la base SteamID64.
 * bcadd si dispo (hébergement 32 bits), sinon arithmétique entière.
 */
function steam_id64_from_account(int $accountNumber): string
{
    if (function_exists('bcadd')) {
        return bcadd(STEAM_ID64_BASE, (string)$accountNumber);
    }

    return (string)((int)STEAM_ID64_BASE + $accountNumber);
}

/**
 * Tente d'extraire un SteamID64 EXPLOITABLE de la saisie, sans appeler
 * l'API. Couvre tout ce qu'un joueur peut coller :
 *
 *   76561198012345678
 *   https://steamcommunity.com/profiles/76561198012345678/
 *   steam://url/SteamIDPage/76561198012345678
 *   STEAM_0:0:26039975            (SteamID2, format serveur / CS)
 *   [U:1:52079950]  ou  U:1:52079950   (SteamID3)
 *
 * Renvoie null si la saisie n'est pas un identifiant (donc un pseudo).
 */
function steam_extract_id64(string $query): ?string
{
    $query = trim($query);

    // SteamID64 nu. Tous les comptes individuels commencent par 7656119.
    if (preg_match('/^7656119\d{10}$/', $query)) {
        return $query;
    }

    // URL de profil (avec ou sans schéma, http ou https, www ou non)
    if (preg_match('#(?:steamcommunity\.com|steam://[^\s]*)/(?:profiles|SteamIDPage)/(7656119\d{10})#i', $query, $m)) {
        return $m[1];
    }

    // SteamID2 : STEAM_X:Y:Z  ->  base + Z*2 + Y
    if (preg_match('/^STEAM_[0-5]:([01]):(\d+)$/i', $query, $m)) {
        return steam_id64_from_account(((int)$m[2] * 2) + (int)$m[1]);
    }

    // SteamID3 : [U:1:N] ou U:1:N
    if (preg_match('/^\[?U:1:(\d+)\]?$/i', $query, $m)) {
        return steam_id64_from_account((int)$m[1]);
    }

    return null;
}

/**
 * Liste des URL personnalisées à tester, de la plus probable à la moins.
 *
 * Une vanity URL Steam ne contient que [a-z0-9_-]. Un pseudo affiché,
 * lui, contient tout et n'importe quoi. On tente donc la saisie brute
 * puis une version « sluggée » : « Jean Dupont » -> « jeandupont »
 * attrape une bonne partie des cas où le joueur a gardé le même nom.
 *
 * @return list<string>  0, 1 ou 2 candidats
 */
function steam_vanity_candidates(string $query): array
{
    // Une URL /id/<vanity> donne directement le bon candidat
    if (preg_match('#steamcommunity\.com/id/([^/?\s]+)#i', $query, $m)) {
        $query = urldecode($m[1]);
    }

    $candidats = [];

    $brut = strtolower(trim($query));

    if (preg_match('/^[a-z0-9_-]{2,32}$/', $brut)) {
        $candidats[] = $brut;
    }

    // Translittération : « Rémi » -> « remi », « ✪ Kev » -> « kev »
    $slug = $brut;

    if (function_exists('iconv')) {
        $translit = @iconv('UTF-8', 'ASCII//TRANSLIT', $slug);
        if ($translit !== false) {
            $slug = $translit;
        }
    }

    $slug = strtolower((string)preg_replace('/[^a-z0-9_-]/i', '', $slug));

    if (strlen($slug) >= 2 && strlen($slug) <= 32 && !in_array($slug, $candidats, true)) {
        $candidats[] = $slug;
    }

    return $candidats;
}

/* ------------------------------------------------------------------ */
/*  Recherche : pseudo / URL / SteamID  ->  accountId                  */
/* ------------------------------------------------------------------ */
/**
 * ATTENTION — limite de l'API Steam, pas du site :
 * ResolveVanityURL ne résout QUE l'URL personnalisée du profil
 * (steamcommunity.com/id/xxx). Le pseudo affiché n'est indexé par
 * aucun endpoint officiel. Un compte qui n'a jamais configuré d'URL
 * perso est donc introuvable par son nom, quoi qu'on tente.
 *
 * D'où la stratégie : on épuise tout ce qui est déterministe
 * (SteamID64/2/3, URL) avant de tenter la vanity, et on explique
 * clairement l'échec au lieu d'un « aucun profil trouvé » sec.
 */
function steam_resolve_account_id(array $cfg, string $query): array
{
    $apiKey = $cfg['api_key'] ?? '';
    $query  = trim($query);

    if ($apiKey === '') {
        return ['ok' => false, 'status' => 500, 'error' => 'Erreur de configuration API.'];
    }

    if ($query === '') {
        return ['ok' => false, 'status' => 400, 'error' => 'Merci de saisir un pseudo.'];
    }

    // 1. Identifiant direct : aucun appel réseau nécessaire
    $id64 = steam_extract_id64($query);

    if ($id64 !== null) {
        return ['ok' => true, 'accountId' => $id64];
    }

    // 2. URL personnalisée
    $candidats = steam_vanity_candidates($query);

    if ($candidats === []) {
        return [
            'ok'     => false,
            'status' => 404,
            'error'  => steam_message_introuvable($query),
        ];
    }

    $urls = [];

    foreach ($candidats as $i => $vanity) {
        $urls[$i] = 'https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/'
                  . '?key=' . urlencode($apiKey)
                  . '&url_type=1'
                  . '&vanityurl=' . rawurlencode($vanity);
    }

    $reponses = mgs_http_get_json_multi($urls);

    $panne = true;   // aucune réponse exploitable = Steam est down / clé HS

    foreach ($candidats as $i => $vanity) {
        $data = $reponses[$i] ?? null;

        if (!is_array($data) || !isset($data['response'])) {
            continue;
        }

        $panne   = false;
        $success = (int)($data['response']['success'] ?? 0);

        if ($success === 1 && !empty($data['response']['steamid'])) {
            return ['ok' => true, 'accountId' => (string)$data['response']['steamid']];
        }
    }

    if ($panne) {
        return [
            'ok'     => false,
            'status' => 502,
            'error'  => "Steam ne répond pas pour le moment. Réessaie dans une minute.",
        ];
    }

    return [
        'ok'     => false,
        'status' => 404,
        'error'  => steam_message_introuvable($query),
    ];
}

/**
 * Message d'échec explicite. Un joueur qui comprend POURQUOI ça échoue
 * sait quoi faire ; « aucun profil trouvé » donne juste l'impression
 * que le site est cassé.
 */
function steam_message_introuvable(string $query): string
{
    return "Aucun profil Steam pour « " . $query . " ». Steam ne permet de chercher "
         . "que par URL personnalisée (steamcommunity.com/id/…), pas par pseudo affiché. "
         . "Colle l'URL complète de ton profil ou ton SteamID64 (17 chiffres) : "
         . "ouvre ton profil Steam, l'identifiant est dans la barre d'adresse.";
}

/**
 * Juste la photo de profil, pour la navbar et le skin en jeu.
 *
 * Un seul appel à GetPlayerSummaries : pas besoin de la bibliothèque, du
 * niveau ou des badges (steam_fetch_stats() les récupère tous, ce qui est
 * bien trop lourd pour n'afficher qu'une icône sur chaque page).
 */
function steam_fetch_avatar(array $cfg, string $accountId): ?string
{
    $apiKey = $cfg['api_key'] ?? '';

    if ($apiKey === '') {
        return null;
    }

    $data = mgs_http_get_json(
        'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/'
        . '?key=' . urlencode($apiKey)
        . '&steamids=' . urlencode($accountId)
    );

    $avatar = $data['response']['players'][0]['avatarfull'] ?? null;

    return is_string($avatar) && $avatar !== '' ? $avatar : null;
}



/**
 * Total d'heures au 1er passage de l'année, pour pouvoir calculer le delta.
 * L'API Steam n'expose aucune donnée par année : sans ce repère, "temps de
 * jeu cette année" est impossible à produire honnêtement.
 */
function steam_snapshot_annuel(string $accountId, float $heuresActuelles): array
{
    $dir = MGS_ROOT . '/cache/snapshots';

    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }

    $annee   = (int)date('Y');
    $cle     = preg_replace('/[^0-9A-Za-z]/', '', $accountId);
    $fichier = "{$dir}/steam-{$cle}-{$annee}.json";

    if (is_file($fichier)) {
        $snap = json_decode((string)file_get_contents($fichier), true) ?: [];
    } else {
        $snap = ['hours' => $heuresActuelles, 'since' => date('Y-m-d')];
        @file_put_contents($fichier, json_encode($snap));
    }

    $depuis = (string)($snap['since'] ?? date('Y-m-d'));

    return [
        'hours'   => max(0, round($heuresActuelles - (float)($snap['hours'] ?? $heuresActuelles), 1)),
        'since'   => $depuis,
        'partial' => $depuis !== $annee . '-01-01',
    ];
}

/**
 * Valeur de la bibliothèque. Interroger le Store pour 400 jeux à chaque
 * chargement est impossible (rate limit ~200 requêtes / 5 min), donc :
 * cache persistant + extrapolation des jeux inconnus sur la moyenne des
 * jeux connus. L'arrondi large est fait côté JS.
 */
function steam_library_value(array $ownedGames): array
{
    $fichier = MGS_ROOT . '/cache/steam-prices.json';
    $dir     = dirname($fichier);

    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }

    $cache = is_file($fichier)
        ? (json_decode((string)file_get_contents($fichier), true) ?: [])
        : [];

    $limite = time() - STEAM_PRIX_CACHE_JOURS * 86400;

    // Les jeux les plus joués d'abord : c'est eux qu'on veut mesurer en vrai.
    usort($ownedGames, fn($a, $b) => ($b['playtime_forever'] ?? 0) <=> ($a['playtime_forever'] ?? 0));

    // 1er passage : on ne garde que ce qui est déjà en cache
    $connus      = [];
    $aInterroger = [];
    $manquants   = 0;

    foreach ($ownedGames as $game) {
        $appId  = (int)($game['appid'] ?? 0);
        $entree = $cache[$appId] ?? null;

        if ($entree !== null && (int)($entree['t'] ?? 0) > $limite) {
            $connus[] = (float)$entree['p'];
            continue;
        }

        if (count($aInterroger) < STEAM_PRIX_PAR_APPEL) {
            $aInterroger[$appId] = 'https://store.steampowered.com/api/appdetails'
                                 . '?appids=' . $appId . '&cc=fr&l=fr&filters=price_overview';
            continue;
        }

        $manquants++;
    }

    // 2e passage : tout le lot en parallèle, ~1 aller-retour au lieu de 25
    $modifie = false;

    foreach (mgs_http_get_json_multi($aInterroger) as $appId => $data) {
        $bloc = is_array($data) ? ($data[$appId] ?? null) : null;

        if (!is_array($bloc) || ($bloc['success'] ?? false) !== true) {
            $manquants++;
            continue;
        }

        $centimes = $bloc['data']['price_overview']['initial'] ?? null;
        $prix     = $centimes === null ? 0.0 : $centimes / 100;

        $cache[(int)$appId] = ['p' => $prix, 't' => time()];
        $connus[]           = $prix;
        $modifie            = true;
    }

    if ($modifie) {
        @file_put_contents($fichier, json_encode($cache), LOCK_EX);
    }

    $moyenne = $connus ? array_sum($connus) / count($connus) : 0.0;

    return [
        'value'    => round(array_sum($connus) + $manquants * $moyenne),
        'measured' => count($connus),
        'total'    => count($ownedGames),
    ];
}
/* ------------------------------------------------------------------ */
/*  Stats  ->  carte normalisée                                        */
/* ------------------------------------------------------------------ */
function steam_fetch_stats(array $cfg, string $accountId): array
{
    $apiKey = $cfg['api_key'] ?? '';

    if ($apiKey === '') {
        return ['ok' => false, 'status' => 500, 'error' => 'Erreur de configuration API.'];
    }

    $base = 'https://api.steampowered.com/';
    $key  = '?key=' . urlencode($apiKey);
    $sid  = urlencode($accountId);

    $reponses = mgs_http_get_json_multi([
        'summary' => $base . "ISteamUser/GetPlayerSummaries/v2/{$key}&steamids={$sid}",
        'owned'   => $base . "IPlayerService/GetOwnedGames/v1/{$key}&steamid={$sid}&include_appinfo=1&include_played_free_games=1",
        'recent'  => $base . "IPlayerService/GetRecentlyPlayedGames/v1/{$key}&steamid={$sid}",
        'level'   => $base . "IPlayerService/GetSteamLevel/v1/{$key}&steamid={$sid}",
        'badges'  => $base . "IPlayerService/GetBadges/v1/{$key}&steamid={$sid}",
    ]);

    $summary = $reponses['summary'];
    $owned   = $reponses['owned'];
    $recent  = $reponses['recent'];
    $level   = $reponses['level'];
    $badges  = $reponses['badges'];

    $player = $summary['response']['players'][0] ?? null;

    if (!$player) {
        return ['ok' => false, 'status' => 404, 'error' => 'Profil introuvable ou privé.'];
    }
    $ownedGames  = $owned['response']['games'] ?? [];
    $recentGames = $recent['response']['games'] ?? [];

    $etats = [
        0 => 'Hors ligne', 1 => 'En ligne', 2 => 'Occupé', 3 => 'Absent',
        4 => 'Endormi', 5 => 'Cherche à échanger', 6 => 'Cherche à jouer',
    ];
    $state = (int)($player['personastate'] ?? 0);

    $recentItems = [];
    foreach (array_slice($recentGames, 0, 5) as $game) {
        $recentItems[] = [
            'name'  => $game['name'] ?? 'Jeu inconnu',
            'value' => number_format(($game['playtime_2weeks'] ?? 0) / 60, 1, ',', ' ') . 'h',
        ];
    }


    $recentMinutes = 0;
    foreach ($recentGames as $game) {
        $recentMinutes += (int)($game['playtime_2weeks'] ?? 0);
    }
    usort($recentGames, fn($a, $b) => ($b['playtime_2weeks'] ?? 0) <=> ($a['playtime_2weeks'] ?? 0));

    $recentTop = [];
    foreach (array_slice($recentGames, 0, 3) as $game) {
        $recentTop[] = [
            'name'     => $game['name'] ?? 'Jeu inconnu',
            'hours'    => round(($game['playtime_2weeks'] ?? 0) / 60, 1),
            'platform' => 'steam',
        ];
    }

    $playedMinutes = 0;
    foreach ($ownedGames as $game) {
        $playedMinutes += (int)($game['playtime_forever'] ?? 0);
    }

    // Copie triée du plus joué au moins joué : elle sert au jeu principal
    // ET à la ventilation envoyée au hub, au lieu de deux parcours séparés.
    $jeuxTries = $ownedGames;
    usort($jeuxTries, fn($a, $b) => ($b['playtime_forever'] ?? 0) <=> ($a['playtime_forever'] ?? 0));

    $topGame = $jeuxTries[0] ?? null;

    $playedCount = 0;
    foreach ($ownedGames as $game) {
        if ((int)($game['playtime_forever'] ?? 0) > 0) $playedCount++;
    }

    /* --- Les jeux les plus joués, pour la barre du hub -----------------
       Le hub découpe le temps cumulé jeu par jeu. Une bibliothèque Steam
       en compte des centaines : on n'en envoie que les plus gros, le
       client agrège le reste en « Autres jeux » à partir de totalHours.
       Une entrée à 0 h ne produirait qu'un segment invisible. */
    $topGames = [];
    foreach (array_slice($jeuxTries, 0, STEAM_TOP_GAMES) as $game) {
        $minutes = (int)($game['playtime_forever'] ?? 0);

        if ($minutes <= 0) {
            break;   // la liste est triée : les suivants sont à 0 aussi
        }

        $topGames[] = [
            'name'     => $game['name'] ?? 'Jeu inconnu',
            'hours'    => round($minutes / 60, 1),
            'image'    => 'https://cdn.cloudflare.steamstatic.com/steam/apps/'
                          . (int)($game['appid'] ?? 0) . '/header.jpg',
            'platform' => 'steam',
        ];
    }

    $heuresTotales = round($playedMinutes / 60);
    $annee         = steam_snapshot_annuel($accountId, (float)$heuresTotales);
    $valeur        = steam_library_value($ownedGames);


    return [
        'ok'   => true,
        'card' => [
            'platform'      => 'steam',
            'platformLabel' => 'Steam',
            'accountId'     => $accountId,
            'displayName'   => $player['personaname'] ?? $accountId,
            'subtitle'      => $player['realname'] ?? '',
            'avatar'        => $player['avatarfull'] ?? '',
            'profileUrl'    => $player['profileurl'] ?? '',
            'status'        => [
                'label'  => $etats[$state] ?? 'Inconnu',
                'online' => $state !== 0,
            ],
            'activity'      => $player['gameextrainfo'] ?? null,
            'highlights'    => [
                ['label' => 'Profil',             'value' => ((int)($player['communityvisibilitystate'] ?? 1)) === 3 ? 'Public' : 'Privé'],
                ['label' => 'Niveau Steam',       'value' => (string)($level['response']['player_level'] ?? '-')],
                ['label' => 'XP',                 'value' => (string)($badges['response']['player_xp'] ?? '-')],
                ['label' => 'Pays', 'value' => ($player['loccountrycode'] ?? '') ?: '-'],
                ['label' => 'Membre depuis',      'value' => isset($player['timecreated']) ? date('d/m/Y', (int)$player['timecreated']) : 'Inconnue'],
                ['label' => 'Dernière connexion', 'value' => isset($player['lastlogoff']) ? date('d/m/Y H:i', (int)$player['lastlogoff']) : 'Inconnue'],
                ['label' => 'Jeux possédés',      'value' => (string)count($ownedGames)],
                ['label' => 'Badges',             'value' => (string)count($badges['response']['badges'] ?? [])],
            ],
            'sections'      => [
                [
                    'type'  => 'list',
                    'title' => 'Récemment joués',
                    'items' => $recentItems,
                    'empty' => 'Aucun jeu récent',
                ],
            ],
            'links'         => [
                ['label' => 'Voir le profil Steam', 'url' => $player['profileurl'] ?? ''],
            ],
            'metrics' => [
                'accounts'      => 1,
                'games'         => count($ownedGames),
                'playedGames'   => $playedCount,
                'recentHours'   => round($recentMinutes / 60, 1),
                'totalHours'    => $heuresTotales,
                'topGame'       => $topGame ? [
                    'name'     => $topGame['name'] ?? 'Jeu inconnu',
                    'hours'    => round(($topGame['playtime_forever'] ?? 0) / 60),
                    'image'    => 'https://cdn.cloudflare.steamstatic.com/steam/apps/'
                                . (int)$topGame['appid'] . '/header.jpg',
                    'platform' => 'Steam',
                ] : null,
                // Découpage de la barre du hub : top jeux + « Autres »
                // reconstitué côté client (totalHours moins la somme).
                'topGames'      => $topGames,

                'recentTop'     => $recentTop,

                'yearHours'     => $annee['hours'],
                'yearSince'     => $annee['since'],
                'yearPartial'   => $annee['partial'],

                'libraryValue'    => $valeur['value'],
                'libraryMeasured' => [
                    'measured' => $valeur['measured'],
                    'total'    => $valeur['total'],
                ],

                // L'API officielle Steam n'expose aucun rang (CS2, Dota…).
                'ranks'         => [],
                'mainRank'      => null,
            ],
        ],
    ];
}

/* ------------------------------------------------------------------ */
/*  Liaison de compte (OpenID)                                         */
/* ------------------------------------------------------------------ */
function steam_should_complete_link(): bool
{
    return filter_input(INPUT_GET, 'openid_mode') === 'id_res';
}

function steam_begin_link(array $cfg, string $returnUrl): string
{
    require_once __DIR__ . '/../../vendor/autoload.php';

    return (new \xPaw\Steam\SteamOpenID($returnUrl))->GetAuthUrl();
}

function steam_complete_link(array $cfg, string $returnUrl): array
{
    require_once __DIR__ . '/../../vendor/autoload.php';

    try {
        $accountId = (new \xPaw\Steam\SteamOpenID($returnUrl))->Validate();
        return ['ok' => true, 'accountId' => $accountId];
    } catch (Throwable $e) {
        return ['ok' => false, 'error' => 'invalide'];
    }
}

/* ================================================================== */
/*  Bibliothèque complète                                             */
/* ================================================================== */

function steam_fetch_games(array $cfg, string $accountId): array
{
    $apiKey = $cfg['api_key'] ?? '';

    if ($apiKey === '') {
        return ['ok' => false, 'status' => 500, 'error' => 'Erreur de configuration API.'];
    }

    $owned = mgs_http_get_json(
        'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/'
        . '?key=' . urlencode($apiKey)
        . '&steamid=' . urlencode($accountId)
        . '&include_appinfo=1&include_played_free_games=1'
    );

    if ($owned === null) {
        return ['ok' => false, 'status' => 502, 'error' => 'Impossible de récupérer ta bibliothèque.'];
    }

    $ownedGames = $owned['response']['games'] ?? [];

    $games      = [];
    $totalMin   = 0;
    $joues      = 0;

    foreach ($ownedGames as $game) {
        $appId    = (int)$game['appid'];
        $minutes  = (int)($game['playtime_forever'] ?? 0);
        $recent   = (int)($game['playtime_2weeks'] ?? 0);

        $totalMin += $minutes;
        if ($minutes > 0) {
            $joues++;
        }

        $games[] = [
            'appid'       => $appId,
            'name'        => $game['name'] ?? ('App ' . $appId),
            'image'       => 'https://cdn.akamai.steamstatic.com/steam/apps/' . $appId . '/capsule_184x69.jpg',
            'storeUrl'    => 'https://store.steampowered.com/app/' . $appId . '/',
            'hours'       => round($minutes / 60, 1),
            'recentHours' => round($recent / 60, 1),
            'lastPlayed'  => isset($game['rtime_last_played']) && (int)$game['rtime_last_played'] > 0
                             ? (int)$game['rtime_last_played']
                             : null,
        ];
    }
    

    return [
        'ok'     => true,
        'games'  => $games,
        'totals' => [
            'count'  => count($games),
            'played' => $joues,
            'hours'  => round($totalMin / 60, 1),
        ],
    ];
}