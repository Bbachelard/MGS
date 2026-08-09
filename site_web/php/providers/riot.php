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

const RIOT_DIVISIONS = ['IV' => 0, 'III' => 1, 'II' => 2, 'I' => 3];

/** Tiers apex : pas de divisions, on étale sur les LP. */
const RIOT_TIERS_APEX = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];

/**
 * Percentile approximatif de chaque tier sur la ladder soloq EUW.
 * [plancher, plafond] = % de joueurs que tu dépasses.
 * C'est CE chiffre qui permet de comparer un Diamant LoL à un
 * Diamant CS2 : chaque provider doit renvoyer la même échelle 0-100.
 */
const RIOT_TIER_PERCENTILE = [
    'IRON'        => [0.0,   4.0],
    'BRONZE'      => [4.0,  20.0],
    'SILVER'      => [20.0, 40.0],
    'GOLD'        => [40.0, 60.0],
    'PLATINUM'    => [60.0, 78.0],
    'EMERALD'     => [78.0, 90.0],
    'DIAMOND'     => [90.0, 97.5],
    'MASTER'      => [97.5, 99.6],
    'GRANDMASTER' => [99.6, 99.9],
    'CHALLENGER'  => [99.9, 100.0],
];

/** Points de maîtrise moyens rapportés par partie (sert à estimer le temps de jeu). */
const RIOT_POINTS_PAR_PARTIE = 350;
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

    /* --- Maîtrises champions ---
       Liste complète (sans /top) : les points cumulés depuis la création
       du compte servent à estimer le temps de jeu total.                */
    $mastery  = riot_get("{$platform}/lol/champion-mastery/v4/champion-masteries/by-puuid/" . rawurlencode($puuid), $apiKey);
    $champions = riot_champion_names();

    $masteryData = $mastery['status'] === 200 ? ($mastery['data'] ?? []) : [];

    $pointsTotaux = 0;
    foreach ($masteryData as $m) {
        $pointsTotaux += (int)($m['championPoints'] ?? 0);
    }

    $masteryItems = [];
    foreach (array_slice($masteryData, 0, 3) as $m) {
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



    /* --- Estimation du temps de jeu depuis la création du compte -------
       Une partie rapporte en moyenne ~350 points de maîtrise (variable
       selon le grade et la victoire). Les points ne sont jamais remis
       à zéro : c'est le seul compteur "à vie" exposé par Riot.        */

    $dureeMoyenne = count($matchItems) > 0
        ? $recentSeconds / count($matchItems)
        : 1800;

    $partiesEstimees = (int) round($pointsTotaux / 350);
    $heuresEstimees  = (int) round($partiesEstimees * $dureeMoyenne / 3600);

    $annee = riot_year_hours($regional, $puuid, $apiKey, $dureeMoyenne);

    $rangs = array_values(array_filter([
        riot_rank_entry($solo, 'League of Legends', 'Solo/Duo'),
        riot_rank_entry($flex, 'League of Legends', 'Flex 5v5'),
    ]));

    usort($rangs, fn($a, $b) => ($b['score'] ?? -1) <=> ($a['score'] ?? -1));

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
                ['label' => 'Parties classées (saison)', 'value' => $total > 0 ? (string)$total : '-'],
                ['label' => 'Parties estimées (total)',  'value' => $partiesEstimees > 0 ? '≈ ' . number_format($partiesEstimees, 0, ',', ' ') : '-'],
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
                'accounts'       => 1,
                'games'          => $total,
                'playedGames'    => 0,
                'recentHours'    => round($recentSeconds / 3600, 1),
                'totalHours'     => $heuresEstimees,
                'hoursEstimated' => true,

                // Sans ça, Steam gagnait le duel du "jeu principal" par forfait.
                'topGame'        => $heuresEstimees > 0 ? [
                    'name'      => 'League of Legends',
                    'hours'     => $heuresEstimees,
                    'image'     => '/content/image/games/lol.jpg',
                    'platform'  => 'Riot',
                    'estimated' => true,
                ] : null,

                'recentTop'      => $recentTop,

                'yearHours'      => $annee['heures'],
                'yearEstimated'  => true,
                'yearTruncated'  => $annee['tronque'],

                'libraryValue'   => 0,   // LoL est gratuit

                'ranks'          => $rangs,

                // Conservé pour stats-display.js tant qu'il lit encore mainRank.
                'mainRank'       => $rangs[0] ?? null,
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

/**
 * Convertit une entrée league-v4 en percentile 0-100.
 * null = non classé (la carte le reléguera en dernier).
 */
function riot_rank_percentile(?array $entry): ?float
{
    if ($entry === null) {
        return null;
    }

    $tier = strtoupper((string)($entry['tier'] ?? ''));

    if (!isset(RIOT_TIER_PERCENTILE[$tier])) {
        return null;
    }

    [$bas, $haut] = RIOT_TIER_PERCENTILE[$tier];
    $lp = (int)($entry['leaguePoints'] ?? 0);

    if (in_array($tier, RIOT_TIERS_APEX, true)) {
        $ratio = min(1.0, $lp / 1500);
    } else {
        $div   = RIOT_DIVISIONS[strtoupper((string)($entry['rank'] ?? 'IV'))] ?? 0;
        $ratio = ($div + min(1.0, $lp / 100)) / 4;
    }

    return round($bas + ($haut - $bas) * $ratio, 2);
}

/**
 * Emblème du tier. Les assets sont servis en local : les chemins CDN
 * de Riot changent à chaque refonte du client, on ne s'y accroche pas.
 * Fichiers attendus : content/img/ranks/lol-diamond.png, lol-gold.png, etc.
 */
function riot_rank_icon(string $tier): string
{
    $tier = strtolower(trim($tier));

    return $tier === '' ? '' : '/content/image/ranks/lol-' . $tier . '.png';
}

/** Entrée de rang normalisée, consommée telle quelle par hub-resume.js. */
function riot_rank_entry(?array $entry, string $jeu, string $queue): ?array
{
    if ($entry === null) {
        return null;
    }

    $tier   = strtoupper((string)($entry['tier'] ?? ''));
    $lp     = (int)($entry['leaguePoints'] ?? 0);
    $wins   = (int)($entry['wins'] ?? 0);
    $losses = (int)($entry['losses'] ?? 0);
    $total  = $wins + $losses;

    $details = [$lp . ' LP'];
    if ($total > 0) {
        $details[] = round($wins / $total * 100) . ' % WR';
        $details[] = $total . ' parties';
    }

    return [
        'game'     => $jeu,
        'queue'    => $queue,
        'label'    => riot_format_rank($entry),
        'tier'     => $tier,
        'division' => (string)($entry['rank'] ?? ''),
        'lp'       => $lp,
        'winrate'  => $total > 0 ? round($wins / $total * 100) : null,
        'games'    => $total,
        'icon'     => riot_rank_icon($tier),
        'score'    => riot_rank_percentile($entry),
        'sub'      => implode(' · ', $details),
        'platform' => 'riot',
    ];
}

/**
 * Parties jouées depuis le 1er janvier.
 * match-v5 ne renvoie que des IDs (pas de durée) : on multiplie par la
 * durée moyenne des dernières parties. C'est une estimation assumée.
 */
function riot_year_hours(string $regional, string $puuid, string $apiKey, float $dureeMoyenne): array
{
    $debut   = mktime(0, 0, 0, 1, 1, (int)date('Y'));
    $parties = 0;
    $start   = 0;

    // 10 pages = 1000 parties max. Au-delà on tronque plutôt que de
    // marteler l'API à chaque affichage de page.
    for ($page = 0; $page < 10; $page++) {
        $res = riot_get(
            "{$regional}/lol/match/v5/matches/by-puuid/" . rawurlencode($puuid)
            . "/ids?startTime={$debut}&start={$start}&count=100",
            $apiKey
        );

        if ($res['status'] !== 200 || !is_array($res['data'])) {
            break;
        }

        $lot      = count($res['data']);
        $parties += $lot;
        $start   += $lot;

        if ($lot < 100) {
            break;
        }
    }

    return [
        'parties' => $parties,
        'heures'  => round($parties * $dureeMoyenne / 3600, 1),
        'tronque' => $parties >= 1000,
    ];
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