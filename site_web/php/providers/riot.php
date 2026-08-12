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

/** Champions affichés dans « Champions favoris ». */
const RIOT_MASTERY_TOP = 3;

/**
 * Emblème de maîtrise, servi par CommunityDragon (ni clé API, ni version à
 * suivre). Riot réorganise ses assets de temps en temps : si l'image casse,
 * seule cette constante est à corriger — la carte retombe automatiquement
 * sur la pastille chiffrée.
 * Chemin de secours connu (niveaux 1-7 uniquement) :
 * .../plugins/rcp-be-lol-collections/global/default/images/mastery/mastery-icon-level-%d.png
 */
const RIOT_MASTERY_EMBLEM =
    'https://raw.communitydragon.org/latest/game/assets/ux/mastery/mastery_icon_lvl%d.png';

/* ---- Parties détaillées ------------------------------------------ */

/** Parties chargées d'emblée avec la carte. */
const RIOT_MATCHES_INITIAL = 3;

/** Parties ajoutées à chaque clic sur « Voir plus ». */
const RIOT_MATCHES_PAGE = 5;

/** Plafond de pagination. match-v5 ne remonte pas indéfiniment de toute façon. */
const RIOT_MATCHES_MAX = 100;

/** Une partie terminée ne change plus jamais : on la garde longtemps. */
const RIOT_MATCH_CACHE_JOURS = 60;

/** Modes dont on sait dessiner le détail (2 équipes de 5). L'Arena viendra plus tard. */
const RIOT_MODES_DETAILLES = [400, 410, 420, 430, 440, 450, 490, 700, 830, 840, 850];

/** teamId -> libellé affiché. */
const RIOT_EQUIPES = [100 => 'Équipe bleue', 200 => 'Équipe rouge'];

/** teamPosition -> libellé court. */
const RIOT_POSTES = [
    'TOP'     => 'Top',
    'JUNGLE'  => 'Jungle',
    'MIDDLE'  => 'Mid',
    'BOTTOM'  => 'Bot',
    'UTILITY' => 'Support',
];

/** Couleur d'accent par tier, pour les encadrés de rang. */
const RIOT_TIER_COULEUR = [
    'IRON'        => '#7d7d84',
    'BRONZE'      => '#a2673f',
    'SILVER'      => '#98a5a5',
    'GOLD'        => '#e0b04a',
    'PLATINUM'    => '#4ec2c2',
    'EMERALD'     => '#37b56a',
    'DIAMOND'     => '#6c7bff',
    'MASTER'      => '#b566d9',
    'GRANDMASTER' => '#e0575b',
    'CHALLENGER'  => '#4fd1ff',
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

/**
 * Comme riot_get(), mais lance toutes les URL en parallèle.
 * Indispensable dès qu'on charge 5 ou 10 parties : en séquentiel c'est
 * 10 allers-retours de 200 ms empilés.
 *
 * @param  array<string,string> $urls  clé => URL
 * @return array<string,array{status:int, data:?array}>
 */
function riot_get_multi(array $urls, string $apiKey): array
{
    if (!$urls) {
        return [];
    }

    // Repli séquentiel si curl n'est pas compilé
    if (!function_exists('curl_multi_init')) {
        $out = [];
        foreach ($urls as $cle => $url) {
            $out[$cle] = riot_get($url, $apiKey);
        }
        return $out;
    }

    $multi   = curl_multi_init();
    $handles = [];

    foreach ($urls as $cle => $url) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => [
                'X-Riot-Token: ' . $apiKey,
                'Accept: application/json',
            ],
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_ENCODING       => '',   // gzip
        ]);
        curl_multi_add_handle($multi, $ch);
        $handles[$cle] = $ch;
    }

    do {
        $status = curl_multi_exec($multi, $running);
        if ($running) {
            curl_multi_select($multi, 1.0);
        }
    } while ($running && $status === CURLM_OK);

    $resultats = [];

    foreach ($handles as $cle => $ch) {
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $data = json_decode((string)curl_multi_getcontent($ch), true);

        $resultats[$cle] = [
            'status' => $code,
            'data'   => is_array($data) ? $data : null,
        ];

        curl_multi_remove_handle($multi, $ch);
        curl_close($ch);
    }

    curl_multi_close($multi);

    return $resultats;
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
    $masteryKeys  = riot_champion_keys();
    $masteryVer   = riot_ddragon_version();

    // Référence de la jauge : le champion le plus joué vaut 100 %.
    $masteryMax = (int)($masteryData[0]['championPoints'] ?? 0);

    foreach (array_slice($masteryData, 0, RIOT_MASTERY_TOP) as $m) {
        $id     = (int)($m['championId'] ?? 0);
        $niveau = (int)($m['championLevel'] ?? 0);
        $points = (int)($m['championPoints'] ?? 0);

        // championName de match-v5 n'est pas fiable pour les noms de fichiers :
        // on passe par le catalogue Data Dragon comme ailleurs dans le provider.
        $cle = $masteryKeys[$id] ?? '';

        $masteryItems[] = [
            'name'  => $champions[$id] ?? ('Champion ' . $id),
            'value' => number_format($points, 0, ',', ' ') . ' pts',
            'image' => $cle !== ''
                ? "https://ddragon.leagueoflegends.com/cdn/{$masteryVer}/img/champion/{$cle}.png"
                : '',
            'badge' => [
                'image' => riot_mastery_emblem($niveau),
                'text'  => (string)$niveau,
                'title' => 'Maîtrise niveau ' . $niveau,
            ],
            'bar'   => $masteryMax > 0 ? (int)round($points / $masteryMax * 100) : 0,
        ];
    }

    /* --- Dernières parties (détaillées, en parallèle, avec cache) --- */
    $recentes = riot_matches_detaillees($regional, $puuid, $apiKey, 0, RIOT_MATCHES_INITIAL);

    $matchItems    = $recentes['matches'];
    $parChampion   = $recentes['byChampion'];
    $recentSeconds = $recentes['seconds'];
    $victoires     = $recentes['wins'];
    $plusDeParties = $recentes['hasMore'];

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
            'highlights'    => riot_highlights(
                $sum, $solo, $flex, $wins, $losses, $total,
                $matchItems, $victoires, $heuresEstimees, $partiesEstimees
            ),
            'sections'      => [
                [
                    'type'       => 'matches',
                    'title'      => 'Dernières parties',
                    'items'      => $matchItems,
                    'empty'      => 'Aucune partie récente',
                    'assets'     => riot_assets(),
                    'context'    => [
                        'platform'  => 'riot',
                        'accountId' => $region . ':' . $puuid,
                    ],
                    'pagination' => [
                        'start'   => 0,
                        'loaded'  => count($matchItems),
                        'page'    => RIOT_MATCHES_PAGE,
                        'max'     => RIOT_MATCHES_MAX,
                        'hasMore' => $plusDeParties,
                    ],
                ],
                [
                    'type'    => 'list',
                    'title'   => 'Champions favoris',
                    'items'   => $masteryItems,
                    'empty'   => 'Aucune maîtrise',
                    'variant' => 'champions',
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
                    'image'     => '/content/image/ranks/lol.jpg',
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

/** Emblème du niveau de maîtrise. Les niveaux > 10 réutilisent le crest 10. */
function riot_mastery_emblem(int $niveau): string
{
    return sprintf(RIOT_MASTERY_EMBLEM, max(1, min(10, $niveau)));
}

/**
 * Encadrés du haut de carte. Chaque entrée peut porter, en plus de
 * label/value : icon (clé SVG côté JS), image (emblème), accent (hex),
 * tone (win|loss|neutral), sub (ligne secondaire), bar (0-100),
 * dots (suite de V/D), hint (mention « estimation »).
 * Les providers qui n'envoient rien de tout ça s'affichent comme avant.
 */
function riot_highlights(
    array $sum, ?array $solo, ?array $flex,
    int $wins, int $losses, int $total,
    array $matchItems, int $victoires,
    int $heuresEstimees, int $partiesEstimees
): array {
    $winrate = $total > 0 ? (int)round($wins / $total * 100) : null;

    $pips = [];
    foreach ($matchItems as $m) {
        $pips[] = $m['remake'] ? 'R' : ($m['win'] ? 'V' : 'D');
    }

    $encadres = [
        [
            'label' => 'Niveau',
            'value' => (string)((int)($sum['summonerLevel'] ?? 0) ?: '-'),
            'icon'  => 'level',
        ],
        riot_highlight_rang('Solo/Duo', $solo),
        riot_highlight_rang('Flex', $flex),
        [
            'label' => 'LP Solo/Duo',
            'value' => $solo ? (string)(int)$solo['leaguePoints'] . ' LP' : '-',
            'icon'  => 'lp',
        ],
        [
            'label' => 'Victoires',
            'value' => $solo ? (string)$wins : '-',
            'icon'  => 'win',
            'tone'  => 'win',
        ],
        [
            'label' => 'Défaites',
            'value' => $solo ? (string)$losses : '-',
            'icon'  => 'loss',
            'tone'  => 'loss',
        ],
        [
            'label' => 'Winrate',
            'value' => $winrate !== null ? $winrate . ' %' : '-',
            'icon'  => 'winrate',
            'tone'  => $winrate === null ? 'neutral' : ($winrate >= 50 ? 'win' : 'loss'),
            'bar'   => $winrate,
            'sub'   => $total > 0 ? $wins . 'V · ' . $losses . 'D' : null,
        ],
        [
            'label' => 'Forme récente',
            'value' => $matchItems
                        ? $victoires . 'V / ' . (count($matchItems) - $victoires) . 'D'
                        : '-',
            'icon'  => 'form',
            'dots'  => $pips,
            'sub'   => $matchItems ? 'sur les ' . count($matchItems) . ' dernières' : null,
        ],
        [
            'label' => 'Temps estimé',
            'value' => $heuresEstimees > 0 ? number_format($heuresEstimees, 0, ',', ' ') . ' h' : '-',
            'icon'  => 'time',
            'hint'  => 'Estimation',
            'sub'   => $heuresEstimees > 0 ? 'depuis la création du compte' : null,
        ],
        [
            'label' => 'Parties classées',
            'value' => $total > 0 ? (string)$total : '-',
            'icon'  => 'games',
            'sub'   => 'saison en cours',
        ],
        [
            'label' => 'Parties jouées',
            'value' => $partiesEstimees > 0 ? number_format($partiesEstimees, 0, ',', ' ') : '-',
            'icon'  => 'total',
            'hint'  => 'Estimation',
            'sub'   => 'tous modes confondus',
        ],
    ];

    return array_values(array_filter($encadres));
}

/** Encadré de rang : emblème + LP/winrate en sous-titre. */
function riot_highlight_rang(string $label, ?array $entry): array
{
    if ($entry === null) {
        return [
            'label'  => $label,
            'value'  => 'Non classé',
            'icon'   => 'rank',
            'image'  => riot_rank_icon(''),
            'accent' => riot_tier_couleur(null),
            'tone'   => 'neutral',
        ];
    }

    $wins   = (int)($entry['wins'] ?? 0);
    $losses = (int)($entry['losses'] ?? 0);
    $total  = $wins + $losses;

    $sub = [(int)($entry['leaguePoints'] ?? 0) . ' LP'];

    if ($total > 0) {
        $sub[] = round($wins / $total * 100) . ' % WR';
        $sub[] = $total . ' parties';
    }

    return [
        'label'  => $label,
        'value'  => riot_format_rank($entry),
        'icon'   => 'rank',
        'image'  => riot_rank_icon((string)($entry['tier'] ?? '')),
        'accent' => riot_tier_couleur((string)($entry['tier'] ?? '')),
        'sub'    => implode(' · ', $sub),
    ];
}


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

const RIOT_TIERS_AVEC_ICONE = [
    'iron', 'bronze', 'silver', 'gold', 'platinum',
    'emerald', 'diamond', 'master', 'grandmaster', 'challenger',
];
function riot_rank_icon(string $tier): string
{
    $tier = strtolower(trim($tier));

    return in_array($tier, RIOT_TIERS_AVEC_ICONE, true)
        ? '/content/image/ranks/lol-' . $tier . '.png'
        : '/content/image/ranks/lol-unranked.png';
}

/** Couleur d'accent d'un tier. Gris neutre pour les non classés. */
function riot_tier_couleur(?string $tier): string
{
    return RIOT_TIER_COULEUR[strtoupper((string)$tier)] ?? '#6b6b78';
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

/**
 * Petit cache disque générique pour les catalogues Data Dragon.
 * Un fichier par catalogue dans le dossier temporaire, régénéré toutes les 24 h.
 */
function riot_ddragon_cache(string $cle, callable $builder, int $ttl = 86400): array
{
    static $memo = [];

    if (isset($memo[$cle])) {
        return $memo[$cle];
    }

    $fichier = sys_get_temp_dir() . '/mgs_ddragon_' . $cle . '.json';

    if (is_file($fichier) && (time() - filemtime($fichier)) < $ttl) {
        $data = json_decode((string)file_get_contents($fichier), true);
        if (is_array($data) && $data !== []) {
            return $memo[$cle] = $data;
        }
    }

    $data = $builder();

    if ($data !== []) {
        @file_put_contents($fichier, json_encode($data, JSON_UNESCAPED_UNICODE));
    }

    return $memo[$cle] = $data;
}

/**
 * championId -> clé d'asset Data Dragon ("MonkeyKing", "Leblanc"...).
 * On ne se fie PAS au championName de match-v5 : quelques champions ont un
 * nom d'API qui ne correspond pas au nom de fichier de l'icône.
 */
function riot_champion_keys(): array
{
    return riot_ddragon_cache('champion_keys', function (): array {
        $version = riot_ddragon_version();
        $data    = mgs_http_get_json("https://ddragon.leagueoflegends.com/cdn/{$version}/data/fr_FR/champion.json");

        $keys = [];
        foreach ($data['data'] ?? [] as $champion) {
            $keys[(int)$champion['key']] = (string)$champion['id'];
        }

        return $keys;
    });
}

/** itemId -> nom français. Sert aux infobulles des items. */
function riot_item_names(): array
{
    return riot_ddragon_cache('items', function (): array {
        $version = riot_ddragon_version();
        $data    = mgs_http_get_json("https://ddragon.leagueoflegends.com/cdn/{$version}/data/fr_FR/item.json");

        $noms = [];
        foreach ($data['data'] ?? [] as $id => $item) {
            $noms[(int)$id] = (string)($item['name'] ?? '');
        }

        return $noms;
    });
}

/** summonerSpellId -> ['key' => 'SummonerFlash', 'name' => 'Saut éclair']. */
function riot_summoner_spells(): array
{
    return riot_ddragon_cache('spells', function (): array {
        $version = riot_ddragon_version();
        $data    = mgs_http_get_json("https://ddragon.leagueoflegends.com/cdn/{$version}/data/fr_FR/summoner.json");

        $spells = [];
        foreach ($data['data'] ?? [] as $spell) {
            $spells[(int)$spell['key']] = [
                'key'  => (string)($spell['id'] ?? ''),
                'name' => (string)($spell['name'] ?? ''),
            ];
        }

        return $spells;
    });
}

/**
 * perkId (rune-clé ou style) -> ['icon' => 'perk-images/...png', 'name' => '...'].
 * Attention : les icônes de runes sont servies SANS numéro de version.
 */
function riot_perk_icons(): array
{
    return riot_ddragon_cache('perks', function (): array {
        $data = mgs_http_get_json('https://ddragon.leagueoflegends.com/cdn/15.1.1/data/fr_FR/runesReforged.json');

        $perks = [];

        foreach ($data ?? [] as $style) {
            $perks[(int)($style['id'] ?? 0)] = [
                'icon' => (string)($style['icon'] ?? ''),
                'name' => (string)($style['name'] ?? ''),
            ];

            foreach ($style['slots'] ?? [] as $slot) {
                foreach ($slot['runes'] ?? [] as $rune) {
                    $perks[(int)($rune['id'] ?? 0)] = [
                        'icon' => (string)($rune['icon'] ?? ''),
                        'name' => (string)($rune['name'] ?? ''),
                    ];
                }
            }
        }

        return $perks;
    });
}

/** Bases d'URL du CDN, envoyées une fois au front qui construit les liens lui-même. */
function riot_assets(): array
{
    $version = riot_ddragon_version();
    $cdn     = 'https://ddragon.leagueoflegends.com/cdn';

    return [
        'version'  => $version,
        'champion' => "{$cdn}/{$version}/img/champion/",
        'item'     => "{$cdn}/{$version}/img/item/",
        'spell'    => "{$cdn}/{$version}/img/spell/",
        'perk'     => "{$cdn}/img/",
    ];
}

/* ==================================================================
 *  Parties détaillées
 *
 *  Deux étages :
 *   - riot_normalize_match()  : la partie, sans notion de "moi".
 *                               C'est CE format qui va en cache : une
 *                               partie est immuable, et si deux joueurs
 *                               du site ont joué ensemble, ils se
 *                               partagent le même fichier.
 *   - riot_match_output()     : ajoute les noms localisés et marque le
 *                               joueur courant. Jamais mis en cache,
 *                               parce que les libellés dépendent de la
 *                               version du patch.
 * ================================================================== */

function riot_match_cache_dir(): string
{
    $dir = __DIR__ . '/../../cache/riot-matches';

    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }

    return $dir;
}

function riot_match_cache_file(string $matchId): string
{
    return riot_match_cache_dir() . '/' . preg_replace('/[^0-9A-Za-z_]/', '', $matchId) . '.json';
}

function riot_match_cached(string $matchId): ?array
{
    $fichier = riot_match_cache_file($matchId);

    if (!is_file($fichier) || (time() - filemtime($fichier)) > RIOT_MATCH_CACHE_JOURS * 86400) {
        return null;
    }

    $data = json_decode((string)file_get_contents($fichier), true);

    return is_array($data) ? $data : null;
}

function riot_match_store(string $matchId, array $normalise): void
{
    @file_put_contents(
        riot_match_cache_file($matchId),
        json_encode($normalise, JSON_UNESCAPED_UNICODE),
        LOCK_EX
    );
}

/**
 * match-v5 brut -> objet compact, indépendant du joueur consulté.
 * On ne garde que ce qui s'affiche : le JSON brut fait ~250 Ko, celui-ci ~6 Ko.
 */
function riot_normalize_match(array $brut): ?array
{
    $info = $brut['info'] ?? null;

    if (!is_array($info) || empty($info['participants'])) {
        return null;
    }

    $duree = (int)($info['gameDuration'] ?? 0);

    if ($duree > 100000) {
        $duree = intdiv($duree, 1000);   // ancien format en millisecondes
    }

    $joueurs = [];
    $early   = false;

    foreach ($info['participants'] as $p) {
        $early = $early || (bool)($p['gameEndedInEarlySurrender'] ?? false);

        $items = [];
        for ($i = 0; $i <= 6; $i++) {
            $items[] = (int)($p['item' . $i] ?? 0);
        }

        $joueurs[] = [
            'puuid'    => (string)($p['puuid'] ?? ''),
            'team'     => (int)($p['teamId'] ?? 0),
            'name'     => (string)($p['riotIdGameName'] ?? ($p['summonerName'] ?? '?')),
            'tag'      => (string)($p['riotIdTagline'] ?? ''),
            'champId'  => (int)($p['championId'] ?? 0),
            'champRaw' => (string)($p['championName'] ?? ''),
            'level'    => (int)($p['champLevel'] ?? 0),
            'position' => (string)($p['teamPosition'] ?? ''),
            'k'        => (int)($p['kills'] ?? 0),
            'd'        => (int)($p['deaths'] ?? 0),
            'a'        => (int)($p['assists'] ?? 0),
            'cs'       => (int)($p['totalMinionsKilled'] ?? 0) + (int)($p['neutralMinionsKilled'] ?? 0),
            'gold'     => (int)($p['goldEarned'] ?? 0),
            'damage'   => (int)($p['totalDamageDealtToChampions'] ?? 0),
            'taken'    => (int)($p['totalDamageTaken'] ?? 0),
            'vision'   => (int)($p['visionScore'] ?? 0),
            'win'      => (bool)($p['win'] ?? false),
            'items'    => $items,
            'spells'   => [(int)($p['summoner1Id'] ?? 0), (int)($p['summoner2Id'] ?? 0)],
            'perks'    => [
                'keystone' => (int)($p['perks']['styles'][0]['selections'][0]['perk'] ?? 0),
                'style'    => (int)($p['perks']['styles'][1]['style'] ?? 0),
            ],
        ];
    }

    $equipes = [];

    foreach ($info['teams'] ?? [] as $t) {
        $obj = $t['objectives'] ?? [];

        $equipes[] = [
            'id'         => (int)($t['teamId'] ?? 0),
            'win'        => (bool)($t['win'] ?? false),
            'objectives' => [
                'baron'     => (int)($obj['baron']['kills'] ?? 0),
                'dragon'    => (int)($obj['dragon']['kills'] ?? 0),
                'herald'    => (int)($obj['riftHerald']['kills'] ?? 0),
                'tower'     => (int)($obj['tower']['kills'] ?? 0),
                'inhibitor' => (int)($obj['inhibitor']['kills'] ?? 0),
            ],
        ];
    }

    return [
        'id'       => (string)($brut['metadata']['matchId'] ?? ''),
        'queueId'  => (int)($info['queueId'] ?? 0),
        'duration' => $duree,
        'endedAt'  => (int)round(((int)($info['gameEndTimestamp'] ?? ($info['gameStartTimestamp'] ?? 0))) / 1000),
        'remake'   => $early || ($duree > 0 && $duree < 300),
        'players'  => $joueurs,
        'teams'    => $equipes,
    ];
}

/** Un participant normalisé -> participant prêt à afficher. */
function riot_participant_output(array $j, bool $moi): array
{
    $champKeys = riot_champion_keys();
    $champNoms = riot_champion_names();
    $itemNoms  = riot_item_names();
    $spells    = riot_summoner_spells();
    $perks     = riot_perk_icons();

    $morts = max(1, $j['d']);

    $items = [];
    foreach ($j['items'] as $id) {
        $items[] = [
            'id'   => $id,
            'name' => $id > 0 ? ($itemNoms[$id] ?? '') : '',
        ];
    }

    $sorts = [];
    foreach ($j['spells'] as $id) {
        $sorts[] = [
            'key'  => $spells[$id]['key'] ?? '',
            'name' => $spells[$id]['name'] ?? '',
        ];
    }

    return [
        'me'        => $moi,
        'name'      => $j['name'],
        'tag'       => $j['tag'],
        'champion'  => $champKeys[$j['champId']] ?? ($j['champRaw'] ?: 'None'),
        'champLabel'=> $champNoms[$j['champId']] ?? ($j['champRaw'] ?: '?'),
        'level'     => $j['level'],
        'position'  => RIOT_POSTES[$j['position']] ?? '',
        'k'         => $j['k'],
        'd'         => $j['d'],
        'a'         => $j['a'],
        'kda'       => number_format(($j['k'] + $j['a']) / $morts, 2, ',', ''),
        'perfect'   => $j['d'] === 0,
        'cs'        => $j['cs'],
        'gold'      => $j['gold'],
        'damage'    => $j['damage'],
        'taken'     => $j['taken'],
        'vision'    => $j['vision'],
        'win'       => $j['win'],
        'items'     => $items,
        'spells'    => $sorts,
        'perks'     => [
            'keystone' => $perks[$j['perks']['keystone']]['icon'] ?? '',
            'style'    => $perks[$j['perks']['style']]['icon'] ?? '',
            'name'     => $perks[$j['perks']['keystone']]['name'] ?? '',
        ],
    ];
}

/** Partie normalisée -> objet consommé par match-detail.js. */
function riot_match_output(array $norm, string $puuid): ?array
{
    $moi = null;

    foreach ($norm['players'] as $j) {
        if ($j['puuid'] === $puuid) {
            $moi = $j;
            break;
        }
    }

    if ($moi === null) {
        return null;
    }

    $detaille = in_array($norm['queueId'], RIOT_MODES_DETAILLES, true)
                && count($norm['players']) <= 10;

    $minutes = max(1, $norm['duration'] / 60);

    /* Équipes : on ne les construit que pour les modes qu'on sait dessiner. */
    $equipes = [];

    if ($detaille) {
        foreach ($norm['teams'] as $t) {
            $membres = [];
            $k = $d = $a = $or = 0;

            foreach ($norm['players'] as $j) {
                if ($j['team'] !== $t['id']) {
                    continue;
                }

                $k  += $j['k'];
                $d  += $j['d'];
                $a  += $j['a'];
                $or += $j['gold'];

                $sortie = riot_participant_output($j, $j['puuid'] === $puuid);
                $sortie['csMin'] = number_format($j['cs'] / $minutes, 1, ',', '');
                $membres[] = $sortie;
            }

            $equipes[] = [
                'id'         => $t['id'],
                'label'      => RIOT_EQUIPES[$t['id']] ?? ('Équipe ' . $t['id']),
                'win'        => $t['win'],
                'kills'      => $k,
                'deaths'     => $d,
                'assists'    => $a,
                'gold'       => $or,
                'objectives' => $t['objectives'],
                'players'    => $membres,
            ];
        }
    }

    $degatsMax = 0;
    foreach ($norm['players'] as $j) {
        $degatsMax = max($degatsMax, $j['damage'], $j['taken']);
    }

    $moiSortie          = riot_participant_output($moi, true);
    $moiSortie['csMin'] = number_format($moi['cs'] / $minutes, 1, ',', '');

    $queue  = RIOT_QUEUES[$norm['queueId']] ?? 'Partie';
    $issue  = $norm['remake'] ? 'Remake' : ($moi['win'] ? 'Victoire' : 'Défaite');

    return [
        'id'        => $norm['id'],
        'queue'     => $queue,
        'queueId'   => $norm['queueId'],
        'win'       => $moi['win'],
        'remake'    => $norm['remake'],
        'outcome'   => $issue,
        'duration'  => $norm['duration'],
        'endedAt'   => $norm['endedAt'],
        'detailed'  => $detaille && $equipes !== [],
        'maxDamage' => $degatsMax,
        'me'        => $moiSortie,
        'teams'     => $equipes,

        // Repli texte : si match-detail.js n'est pas chargé, le rendu
        // générique de stats-display.js affiche encore quelque chose.
        'name'      => $moiSortie['champLabel'] . ' — ' . $queue,
        'value'     => ($norm['remake'] ? '➖ ' : ($moi['win'] ? '✅ ' : '❌ '))
                       . $moi['k'] . '/' . $moi['d'] . '/' . $moi['a'],
    ];
}

/**
 * Charge une page de parties : IDs, puis détails (cache d'abord, réseau en
 * parallèle pour le reste).
 *
 * @return array{matches:list<array>, seconds:int, wins:int, byChampion:array<string,int>, hasMore:bool}
 */
function riot_matches_detaillees(string $regional, string $puuid, string $apiKey, int $start, int $count): array
{
    $start = max(0, min($start, RIOT_MATCHES_MAX));
    $count = max(1, min($count, 20));

    $vide = ['matches' => [], 'seconds' => 0, 'wins' => 0, 'byChampion' => [], 'hasMore' => false];

    $ids = riot_get(
        "{$regional}/lol/match/v5/matches/by-puuid/" . rawurlencode($puuid)
        . "/ids?start={$start}&count={$count}",
        $apiKey
    );

    if ($ids['status'] !== 200 || !is_array($ids['data'])) {
        return $vide;
    }

    $liste = $ids['data'];

    if ($liste === []) {
        return $vide;
    }

    $normalises = [];
    $aCharger   = [];

    foreach ($liste as $matchId) {
        $matchId = (string)$matchId;
        $cache   = riot_match_cached($matchId);

        if ($cache !== null) {
            $normalises[$matchId] = $cache;
        } else {
            $aCharger[$matchId] = "{$regional}/lol/match/v5/matches/" . rawurlencode($matchId);
        }
    }

    foreach (riot_get_multi($aCharger, $apiKey) as $matchId => $res) {
        if (($res['status'] ?? 0) !== 200 || !is_array($res['data'] ?? null)) {
            continue;
        }

        $norm = riot_normalize_match($res['data']);

        if ($norm === null) {
            continue;
        }

        riot_match_store((string)$matchId, $norm);
        $normalises[(string)$matchId] = $norm;
    }

    /* On respecte l'ordre de Riot : du plus récent au plus ancien. */
    $sorties     = [];
    $secondes    = 0;
    $victoires   = 0;
    $parChampion = [];

    foreach ($liste as $matchId) {
        $norm = $normalises[(string)$matchId] ?? null;

        if ($norm === null) {
            continue;
        }

        $sortie = riot_match_output($norm, $puuid);

        if ($sortie === null) {
            continue;
        }

        $sorties[]   = $sortie;
        $secondes   += $norm['duration'];
        $victoires  += $sortie['win'] ? 1 : 0;

        $champ = $sortie['me']['champLabel'];
        $parChampion[$champ] = ($parChampion[$champ] ?? 0) + $norm['duration'];
    }

    arsort($parChampion);

    return [
        'matches'    => $sorties,
        'seconds'    => $secondes,
        'wins'       => $victoires,
        'byChampion' => $parChampion,
        'hasMore'    => count($liste) === $count && ($start + $count) < RIOT_MATCHES_MAX,
    ];
}

/**
 * Capability « fetch_matches » : pagination des parties pour php/matches.php.
 * Même signature que les autres fetch_* : (config, accountId, ...).
 */
function riot_fetch_matches(array $cfg, string $accountId, int $start = 0, int $count = RIOT_MATCHES_PAGE): array
{
    $apiKey = $cfg['api_key'] ?? '';

    if ($apiKey === '') {
        return ['ok' => false, 'status' => 500, 'error' => 'Erreur de configuration API.'];
    }

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

    $regional = 'https://' . RIOT_ROUTES[$region] . '.api.riotgames.com';

    $page = riot_matches_detaillees($regional, $puuid, $apiKey, $start, $count);

    return [
        'ok'      => true,
        'matches' => $page['matches'],
        'assets'  => riot_assets(),
        'start'   => $start,
        'count'   => $count,
        'hasMore' => $page['hasMore'],
    ];
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