<?php
declare(strict_types=1);

require_once __DIR__ . '/../platforms.php';

/* ==================================================================
 *  Provider Riot Games — League of Legends
 *
 *  accountId interne : "plateforme:puuid"   ex. "euw1:abc123..."
 *  On stocke la plateforme dedans parce que le PUUID est global
 *  mais summoner-v4 / league-v4 sont régionaux.
 * ================================================================== */

/** Plateforme de jeu -> cluster régional (account-v1, match-v5). */
const RIOT_ROUTES = [
    'euw1' => 'europe', 'eun1' => 'europe', 'tr1' => 'europe', 'ru' => 'europe', 'me1' => 'europe',
    'na1'  => 'americas', 'br1' => 'americas', 'la1' => 'americas', 'la2' => 'americas',
    'kr'   => 'asia', 'jp1' => 'asia',
    'oc1'  => 'sea', 'sg2' => 'sea', 'tw2' => 'sea', 'vn2' => 'sea',
];

const RIOT_QUEUES = [
    400  => 'Normale draft',
    420  => 'Classée Solo/Duo',
    430  => 'Normale aveugle',
    440  => 'Classée Flex',
    450  => 'ARAM',
    490  => 'Partie rapide',
    700  => 'Clash',
    1700 => 'Arena',
];

/* ------------------------------------------------------------------ */
/*  HTTP : la clé passe dans un header, pas dans l'URL                 */
/* ------------------------------------------------------------------ */
function riot_get(string $url, string $apiKey): array
{
    $context = stream_context_create([
        'http' => [
            'timeout'       => 8,
            'ignore_errors' => true,
            'header'        => "X-Riot-Token: {$apiKey}\r\nAccept: application/json\r\n",
        ],
    ]);

    $body   = @file_get_contents($url, false, $context);
    $status = 0;

    // $http_response_header est défini par file_get_contents dans ce scope
    if (isset($http_response_header[0]) && preg_match('#\s(\d{3})\s#', $http_response_header[0], $m)) {
        $status = (int)$m[1];
    }

    if ($body === false) {
        return ['status' => $status ?: 502, 'data' => null];
    }

    $data = json_decode($body, true);

    return ['status' => $status, 'data' => is_array($data) ? $data : null];
}

/** Traduit un code HTTP Riot en message affichable. */
function riot_error(int $status): array
{
    return match (true) {
        $status === 401 || $status === 403 => ['ok' => false, 'status' => 500, 'error' => 'Clé API Riot invalide ou expirée.'],
        $status === 404                    => ['ok' => false, 'status' => 404, 'error' => 'Compte Riot introuvable.'],
        $status === 429                    => ['ok' => false, 'status' => 429, 'error' => 'Trop de requêtes, réessaie dans une minute.'],
        default                            => ['ok' => false, 'status' => 502, 'error' => 'Service Riot indisponible.'],
    };
}

/* ------------------------------------------------------------------ */
/*  Recherche : "Pseudo#TAG" (optionnel "@euw1")  ->  accountId        */
/* ------------------------------------------------------------------ */
function riot_resolve_account_id(array $cfg, string $query): array
{
    $apiKey = $cfg['api_key'] ?? '';
    $region = $cfg['default_region'] ?? 'euw1';
    $query  = trim($query);

    if ($apiKey === '') {
        return ['ok' => false, 'status' => 500, 'error' => 'Erreur de configuration API.'];
    }

    // "Pseudo#TAG@euw1" : la plateforme est optionnelle
    if (preg_match('/@([a-z0-9]{2,4})$/i', $query, $m)) {
        $candidate = strtolower($m[1]);
        if (isset(RIOT_ROUTES[$candidate])) {
            $region = $candidate;
        }
        $query = preg_replace('/@[a-z0-9]{2,4}$/i', '', $query);
    }

    if (!str_contains($query, '#')) {
        return [
            'ok'     => false,
            'status' => 400,
            'error'  => 'Format attendu : Pseudo#TAG (ex. Faker#KR1). Le tag est visible dans ton profil Riot.',
        ];
    }

    [$gameName, $tagLine] = array_map('trim', explode('#', $query, 2));

    if ($gameName === '' || $tagLine === '') {
        return ['ok' => false, 'status' => 400, 'error' => 'Riot ID incomplet.'];
    }

    $route = RIOT_ROUTES[$region] ?? 'europe';

    $res = riot_get(
        "https://{$route}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/"
        . rawurlencode($gameName) . '/' . rawurlencode($tagLine),
        $apiKey
    );

    if ($res['status'] !== 200 || empty($res['data']['puuid'])) {
        return $res['status'] === 404
            ? ['ok' => false, 'status' => 404, 'error' => "Aucun compte Riot pour « {$gameName}#{$tagLine} »."]
            : riot_error($res['status']);
    }

    return ['ok' => true, 'accountId' => $region . ':' . $res['data']['puuid']];
}

/* ------------------------------------------------------------------ */
/*  Stats  ->  carte normalisée                                        */
/* ------------------------------------------------------------------ */
function riot_fetch_stats(array $cfg, string $accountId): array
{
    $apiKey = $cfg['api_key'] ?? '';

    if ($apiKey === '') {
        return ['ok' => false, 'status' => 500, 'error' => 'Erreur de configuration API.'];
    }

    // "euw1:puuid" ; on tolère un PUUID nu (ancienne donnée en base)
    if (str_contains($accountId, ':')) {
        [$region, $puuid] = explode(':', $accountId, 2);
    } else {
        $region = $cfg['default_region'] ?? 'euw1';
        $puuid  = $accountId;
    }

    $region = strtolower($region);

    if (!isset(RIOT_ROUTES[$region]) || $puuid === '') {
        return ['ok' => false, 'status' => 400, 'error' => 'Identifiant Riot invalide.'];
    }

    $route    = RIOT_ROUTES[$region];
    $platform = "https://{$region}.api.riotgames.com";
    $regional = "https://{$route}.api.riotgames.com";

    /* --- Identité (Riot ID) --- */
    $account = riot_get("{$regional}/riot/account/v1/accounts/by-puuid/" . rawurlencode($puuid), $apiKey);

    if ($account['status'] !== 200) {
        return riot_error($account['status']);
    }

    $riotId = ($account['data']['gameName'] ?? '?') . '#' . ($account['data']['tagLine'] ?? '?');

    /* --- Profil LoL (niveau, icône) --- */
    $summoner = riot_get("{$platform}/lol/summoner/v4/summoners/by-puuid/" . rawurlencode($puuid), $apiKey);
    $sum      = $summoner['status'] === 200 ? $summoner['data'] : [];

    /* --- Classements --- */
    $league  = riot_get("{$platform}/lol/league/v4/entries/by-puuid/" . rawurlencode($puuid), $apiKey);
    $entries = $league['status'] === 200 ? ($league['data'] ?? []) : [];

    $ranks = ['RANKED_SOLO_5x5' => null, 'RANKED_FLEX_SR' => null];
    foreach ($entries as $entry) {
        $queue = $entry['queueType'] ?? '';
        if (array_key_exists($queue, $ranks)) {
            $ranks[$queue] = $entry;
        }
    }

    /* --- Maîtrises champions --- */
    $mastery  = riot_get("{$platform}/lol/champion-mastery/v4/champion-masteries/by-puuid/" . rawurlencode($puuid) . '/top?count=3', $apiKey);
    $champions = riot_champion_names();

    $masteryItems = [];
    foreach (($mastery['status'] === 200 ? $mastery['data'] : []) ?? [] as $m) {
        $id = (int)($m['championId'] ?? 0);
        $masteryItems[] = [
            'name'  => $champions[$id] ?? ('Champion ' . $id),
            'value' => 'Niv. ' . (int)($m['championLevel'] ?? 0)
                       . ' · ' . number_format((int)($m['championPoints'] ?? 0), 0, ',', ' ') . ' pts',
        ];
    }

    /* --- Dernières parties --- */
    $ids = riot_get("{$regional}/lol/match/v5/matches/by-puuid/" . rawurlencode($puuid) . '/ids?start=0&count=5', $apiKey);

    $matchItems    = [];
    $parChampion = [];
    $recentSeconds = 0;
    $victoires     = 0;

    foreach (($ids['status'] === 200 ? $ids['data'] : []) ?? [] as $matchId) {
        $match = riot_get("{$regional}/lol/match/v5/matches/" . rawurlencode((string)$matchId), $apiKey);

        if ($match['status'] !== 200) {
            continue;
        }

        $info = $match['data']['info'] ?? [];
        $me   = null;

        foreach ($info['participants'] ?? [] as $p) {
            if (($p['puuid'] ?? '') === $puuid) {
                $me = $p;
                break;
            }
        }

        if ($me === null) {
            continue;
        }

        $win            = (bool)($me['win'] ?? false);
        $victoires     += $win ? 1 : 0;
        $duree = (int)($info['gameDuration'] ?? 0);
        if ($duree > 100000) {
            $duree = intdiv($duree, 1000);   // ancien format en millisecondes
        }

        $recentSeconds += $duree;
        $champ = $me['championName'] ?? '?';
        $parChampion[$champ] = ($parChampion[$champ] ?? 0) + $duree;
        $matchItems[] = [
            'name'  => ($me['championName'] ?? '?') . ' — ' . (RIOT_QUEUES[$info['queueId'] ?? 0] ?? 'Partie'),
            'value' => ($win ? '✅ ' : '❌ ')
                       . (int)($me['kills'] ?? 0) . '/' . (int)($me['deaths'] ?? 0) . '/' . (int)($me['assists'] ?? 0),
        ];
    }
    arsort($parChampion);

    $recentTop = [];
    foreach (array_slice($parChampion, 0, 3, true) as $nom => $secondes) {
        $recentTop[] = [
            'name'     => 'LoL — ' . $nom,
            'hours'    => round($secondes / 3600, 1),
            'platform' => 'riot',
        ];
    }

    /* --- Assemblage de la carte --- */
    $solo = $ranks['RANKED_SOLO_5x5'];
    $flex = $ranks['RANKED_FLEX_SR'];

    $version = riot_ddragon_version();
    $iconId  = (int)($sum['profileIconId'] ?? 0);

    $wins   = (int)($solo['wins'] ?? 0);
    $losses = (int)($solo['losses'] ?? 0);
    $total  = $wins + $losses;


    /* --- Estimation du temps de jeu ------------------------------------
       Riot n'expose aucun total. On multiplie la durée moyenne des
       dernières parties par le nombre de parties classées connues.
       Les normales / ARAM / Arena ne sont pas comptées.               */

    $dureeMoyenne = count($matchItems) > 0
        ? $recentSeconds / count($matchItems)
        : 1800;                                     // 30 min par défaut

    $partiesClassees = $wins + $losses
                     + (int)($flex['wins'] ?? 0)
                     + (int)($flex['losses'] ?? 0);

    $heuresEstimees = (int) round($partiesClassees * $dureeMoyenne / 3600);

    return [
        'ok'   => true,
        'card' => [
            'platform'      => 'riot',
            'platformLabel' => 'Riot Games',
            'accountId'     => $region . ':' . $puuid,
            'displayName'   => $riotId,
            'subtitle'      => strtoupper($region),
            'avatar'        => "https://ddragon.leagueoflegends.com/cdn/{$version}/img/profileicon/{$iconId}.png",
            'profileUrl'    => '',
            'status'        => [
                'label'  => 'Niveau ' . (int)($sum['summonerLevel'] ?? 0),
                'online' => false,
            ],
            'activity'      => null,
            'highlights'    => [
                ['label' => 'Niveau',        'value' => (string)((int)($sum['summonerLevel'] ?? 0) ?: '-')],
                ['label' => 'Solo/Duo',      'value' => riot_format_rank($solo)],
                ['label' => 'Flex',          'value' => riot_format_rank($flex)],
                ['label' => 'LP Solo/Duo',   'value' => $solo ? (string)(int)$solo['leaguePoints'] : '-'],
                ['label' => 'Victoires',     'value' => $solo ? (string)$wins : '-'],
                ['label' => 'Défaites',      'value' => $solo ? (string)$losses : '-'],
                ['label' => 'Winrate',       'value' => $total > 0 ? round($wins / $total * 100) . ' %' : '-'],
                ['label' => 'Forme récente', 'value' => $matchItems ? $victoires . 'V / ' . (count($matchItems) - $victoires) . 'D' : '-'],
                ['label' => 'Temps estimé', 'value' => $heuresEstimees > 0 ? '≈ ' . $heuresEstimees . ' h' : '-'],
            ],
            'sections'      => [
                [
                    'type'  => 'list',
                    'title' => 'Dernières parties',
                    'items' => $matchItems,
                    'empty' => 'Aucune partie récente',
                ],
                [
                    'type'  => 'list',
                    'title' => 'Champions favoris',
                    'items' => $masteryItems,
                    'empty' => 'Aucune maîtrise',
                ],
            ],
            'links'         => [
                [
                    'label' => 'Voir sur OP.GG',
                    'url'   => 'https://www.op.gg/summoners/' . rawurlencode($region) . '/' . rawurlencode(str_replace('#', '-', $riotId)),
                ],
            ],
            'metrics' => [
                'accounts'    => 1,
                'games'       => $total,
                'playedGames' => 0,
                'recentHours' => round($recentSeconds / 3600, 1),
                'totalHours'     => $heuresEstimees,
                'hoursEstimated' => true,
                'topGame'     => null,
                'recentTop' => $recentTop,
                'mainRank'    => $solo ? [
                    'label'    => riot_format_rank($solo),
                    'tier'     => strtoupper((string)($solo['tier'] ?? '')),
                    'queue'    => 'LoL — Solo/Duo',
                    'sub'      => (int)$solo['leaguePoints'] . ' LP · '
                                . ($total > 0 ? round($wins / $total * 100) : 0) . ' % winrate',
                    'platform' => 'Riot',
                ] : null,
            ],
        ],
    ];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function riot_format_rank(?array $entry): string
{
    if ($entry === null) {
        return 'Non classé';
    }

    $tiers = [
        'IRON' => 'Fer', 'BRONZE' => 'Bronze', 'SILVER' => 'Argent', 'GOLD' => 'Or',
        'PLATINUM' => 'Platine', 'EMERALD' => 'Émeraude', 'DIAMOND' => 'Diamant',
        'MASTER' => 'Maître', 'GRANDMASTER' => 'Grand Maître', 'CHALLENGER' => 'Challenger',
    ];

    $tier = $tiers[$entry['tier'] ?? ''] ?? ucfirst(strtolower((string)($entry['tier'] ?? '')));

    return trim($tier . ' ' . (string)($entry['rank'] ?? ''));
}

/** Dernière version Data Dragon, mise en cache 24 h (aucune clé requise). */
function riot_ddragon_version(): string
{
    static $version = null;

    if ($version !== null) {
        return $version;
    }

    $cache = sys_get_temp_dir() . '/mgs_ddragon_version.txt';

    if (is_file($cache) && (time() - filemtime($cache)) < 86400) {
        return $version = trim((string)file_get_contents($cache));
    }

    $list = mgs_http_get_json('https://ddragon.leagueoflegends.com/api/versions.json');
    $version = $list[0] ?? '15.1.1';

    @file_put_contents($cache, $version);

    return $version;
}

/** Map championId => nom, mise en cache 24 h. */
function riot_champion_names(): array
{
    static $names = null;

    if ($names !== null) {
        return $names;
    }

    $cache = sys_get_temp_dir() . '/mgs_ddragon_champions.json';

    if (is_file($cache) && (time() - filemtime($cache)) < 86400) {
        $cached = json_decode((string)file_get_contents($cache), true);
        if (is_array($cached)) {
            return $names = $cached;
        }
    }

    $version = riot_ddragon_version();
    $data    = mgs_http_get_json("https://ddragon.leagueoflegends.com/cdn/{$version}/data/fr_FR/champion.json");

    $names = [];
    foreach ($data['data'] ?? [] as $champion) {
        $names[(int)$champion['key']] = $champion['name'];
    }

    @file_put_contents($cache, json_encode($names));

    return $names;
}

/* ==================================================================
 *  Liaison de compte par vérification d'icône
 *
 *  RSO n'est accessible qu'avec une clé production approuvée, et
 *  third-party-code a été supprimé en 2022. On prouve donc la
 *  propriété du compte en demandant au joueur de changer son icône
 *  de profil pour une icône tirée au hasard : seul le propriétaire
 *  du compte peut le faire.
 * ================================================================== */

/** Icônes de base, débloquées par défaut sur tous les comptes. */
const RIOT_VERIFY_ICONS = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
];

/**
 * Catalogue des icônes utilisables pour la vérification.
 * @return list<array{id:int, url:string}>
 */
function riot_verification_icons(array $cfg): array
{
    $version = riot_ddragon_version();

    return array_map(
        static fn (int $id): array => [
            'id'  => $id,
            'url' => "https://ddragon.leagueoflegends.com/cdn/{$version}/img/profileicon/{$id}.png",
        ],
        RIOT_VERIFY_ICONS
    );
}

/**
 * Icône de profil actuellement portée par le compte.
 * Renvoie null si l'API n'a pas répondu (à ne pas confondre avec l'icône 0).
 */
function riot_profile_icon(array $cfg, string $accountId): ?int
{
    $apiKey = $cfg['api_key'] ?? '';

    if ($apiKey === '') {
        return null;
    }

    if (str_contains($accountId, ':')) {
        [$region, $puuid] = explode(':', $accountId, 2);
    } else {
        $region = $cfg['default_region'] ?? 'euw1';
        $puuid  = $accountId;
    }

    $region = strtolower($region);

    if (!isset(RIOT_ROUTES[$region]) || $puuid === '') {
        return null;
    }

    $res = riot_get(
        "https://{$region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/" . rawurlencode($puuid),
        $apiKey
    );

    if ($res['status'] !== 200 || !isset($res['data']['profileIconId'])) {
        return null;
    }

    return (int)$res['data']['profileIconId'];
}

/** Nom affichable d'un compte, pour l'écran de confirmation. */
function riot_display_name(array $cfg, string $accountId): string
{
    $apiKey = $cfg['api_key'] ?? '';

    if (str_contains($accountId, ':')) {
        [$region, $puuid] = explode(':', $accountId, 2);
    } else {
        $region = $cfg['default_region'] ?? 'euw1';
        $puuid  = $accountId;
    }

    $route = RIOT_ROUTES[strtolower($region)] ?? 'europe';
    $res   = riot_get("https://{$route}.api.riotgames.com/riot/account/v1/accounts/by-puuid/" . rawurlencode($puuid), $apiKey);

    if ($res['status'] !== 200) {
        return strtoupper($region);
    }

    return ($res['data']['gameName'] ?? '?') . '#' . ($res['data']['tagLine'] ?? '?')
           . ' (' . strtoupper($region) . ')';
}