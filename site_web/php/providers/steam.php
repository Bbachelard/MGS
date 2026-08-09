<?php
declare(strict_types=1);

require_once __DIR__ . '/../platforms.php';

/** Durée de vie du cache de prix, en jours. */
const STEAM_PRIX_CACHE_JOURS = 30;

/** Nombre d'appels au Store par chargement. Le cache se remplit progressivement. */
const STEAM_PRIX_PAR_APPEL = 25;

/* ------------------------------------------------------------------ */
/*  Recherche : pseudo / URL / SteamID64  ->  accountId                */
/* ------------------------------------------------------------------ */
function steam_resolve_account_id(array $cfg, string $query): array
{
    $apiKey = $cfg['api_key'] ?? '';
    $query  = trim($query);

    if ($apiKey === '') {
        return ['ok' => false, 'status' => 500, 'error' => 'Erreur de configuration API.'];
    }

    if (preg_match('/^\d{17}$/', $query)) {
        return ['ok' => true, 'accountId' => $query];
    }

    if (preg_match('#steamcommunity\.com/profiles/(\d{17})#i', $query, $m)) {
        return ['ok' => true, 'accountId' => $m[1]];
    }

    if (preg_match('#steamcommunity\.com/id/([^/?\s]+)#i', $query, $m)) {
        $query = $m[1];
    }

    $data = mgs_http_get_json(
        'https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/'
        . '?key=' . urlencode($apiKey)
        . '&vanityurl=' . urlencode($query)
    );

    if (($data['response']['success'] ?? null) !== 1) {
        return [
            'ok'     => false,
            'status' => 404,
            'error'  => "Aucun profil Steam trouvé pour ce pseudo. Essaie avec le SteamID64 ou l'URL complète du profil.",
        ];
    }

    return ['ok' => true, 'accountId' => (string)$data['response']['steamid']];
}


/**
 * Total d'heures au 1er passage de l'année, pour pouvoir calculer le delta.
 * L'API Steam n'expose aucune donnée par année : sans ce repère, "temps de
 * jeu cette année" est impossible à produire honnêtement.
 */
function steam_snapshot_annuel(string $accountId, float $heuresActuelles): array
{
    $dir = __DIR__ . '/../../cache/snapshots';

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

/** Prix de base (hors promo) d'un app, en euros. 0 pour les free-to-play. */
function steam_prix_app(int $appId): ?float
{
    $data = mgs_http_get_json(
        'https://store.steampowered.com/api/appdetails'
        . '?appids=' . $appId . '&cc=fr&l=fr&filters=price_overview'
    );

    $bloc = $data[$appId] ?? null;

    if (!is_array($bloc) || ($bloc['success'] ?? false) !== true) {
        return null;
    }

    $centimes = $bloc['data']['price_overview']['initial'] ?? null;

    return $centimes === null ? 0.0 : $centimes / 100;
}

/**
 * Valeur de la bibliothèque. Interroger le Store pour 400 jeux à chaque
 * chargement est impossible (rate limit ~200 requêtes / 5 min), donc :
 * cache persistant + extrapolation des jeux inconnus sur la moyenne des
 * jeux connus. L'arrondi large est fait côté JS.
 */
function steam_library_value(array $ownedGames): array
{
    $fichier = __DIR__ . '/../../cache/steam-prices.json';
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

    $connus    = [];
    $manquants = 0;
    $appels    = 0;
    $modifie   = false;

    foreach ($ownedGames as $game) {
        $appId  = (int)($game['appid'] ?? 0);
        $entree = $cache[$appId] ?? null;

        if ($entree !== null && (int)($entree['t'] ?? 0) > $limite) {
            $connus[] = (float)$entree['p'];
            continue;
        }

        if ($appels < STEAM_PRIX_PAR_APPEL) {
            $appels++;
            $prix = steam_prix_app($appId);

            if ($prix !== null) {
                $cache[$appId] = ['p' => $prix, 't' => time()];
                $modifie  = true;
                $connus[] = $prix;
                continue;
            }
        }

        $manquants++;
    }

    if ($modifie) {
        @file_put_contents($fichier, json_encode($cache));
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

    $topGame = null;
    foreach ($ownedGames as $game) {
        if ($topGame === null || ($game['playtime_forever'] ?? 0) > ($topGame['playtime_forever'] ?? 0)) {
            $topGame = $game;
        }
    }

    $playedCount = 0;
    foreach ($ownedGames as $game) {
        if ((int)($game['playtime_forever'] ?? 0) > 0) $playedCount++;
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
                ['label' => 'Pays',               'value' => $player['loccountrycode'] ?: '-'],
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