<?php
declare(strict_types=1);

/* ==================================================================
 *  providers/riot/stats.php — recherche de compte et carte de stats.
 *
 *  accountId interne : "plateforme:puuid"   ex. "euw1:abc123..."
 *  On stocke la plateforme dedans parce que le PUUID est global mais
 *  summoner-v4 / league-v4 sont régionaux.
 * ================================================================== */

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

    /* --- Valorant ---
       Même compte, même PUUID : rien à lier de plus. Le provider est
       borné dans riot/valorant.php et ne lève jamais — au pire il
       renvoie ['state' => 'unavailable'] et la carte reste celle d'avant. */
    $valorant = riot_valorant_fetch(
        $cfg,
        $puuid,
        RIOT_VAL_REGIONS[$region] ?? RIOT_VAL_REGION_DEFAUT
    );

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
        riot_valorant_rank_entry($valorant),
    ]));

    usort($rangs, fn($a, $b) => ($b['score'] ?? -1) <=> ($a['score'] ?? -1));

    /* --- Les deux jeux du compte -------------------------------------
       Riot n'expose aucune bibliothèque : games.php répond 501 et
       games-table.js reconstruit les lignes à partir d'ici. Tant qu'il
       n'y avait que LoL, un seul topGame suffisait ; avec Valorant il
       faut une liste, sinon le second jeu disparaît du tableau. */
    $jeuxLoL = $heuresEstimees > 0 ? [
        'name'      => 'League of Legends',
        'hours'     => (float)$heuresEstimees,
        'image'     => '/content/image/ranks/lol.jpg',
        'platform'  => 'Riot',
        'estimated' => true,
    ] : null;

    $jeuxVal = riot_valorant_game($valorant);

    $jeux = array_values(array_filter([$jeuxLoL, $jeuxVal]));

    // Le jeu principal se décide sur les heures, plus par forfait.
    usort($jeux, fn($a, $b) => $b['hours'] <=> $a['hours']);

    $heuresValorant = riot_valorant_heures($valorant);

    /* Le lien Valorant n'apparaît que si le compte y joue vraiment :
       un lien mort vers un profil vide serait pire que pas de lien. */
    $liens = [[
        'label' => 'Voir sur OP.GG',
        'url'   => 'https://www.op.gg/summoners/' . rawurlencode($region)
                   . '/' . rawurlencode(str_replace('#', '-', $riotId)),
    ]];

    if ($valorant['state'] === 'ok') {
        $liens[] = [
            'label' => 'Valorant sur Tracker.gg',
            'url'   => 'https://tracker.gg/valorant/profile/riot/'
                       . rawurlencode($riotId) . '/overview',   // # -> %23
        ];
    }

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
            'highlights'    => array_merge(
                riot_highlights(
                    $sum, $solo, $flex, $wins, $losses, $total,
                    $matchItems, $victoires, $heuresEstimees, $partiesEstimees
                ),
                riot_valorant_highlights($valorant)
            ),
            'sections'      => array_merge([
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
                riot_valorant_sections($valorant),
                riot_valorant_section_degradee($valorant)
            ),
            'links'         => $liens,
            'metrics' => [
                'accounts'       => 1,

                // LoL + Valorant quand les deux répondent. Compter Valorant
                // sans savoir s'il a été joué gonflerait "Jeux possédés".
                'games'          => 1 + ($jeuxVal !== null ? 1 : 0),
                'playedGames'    => (($total > 0 || $heuresEstimees > 0) ? 1 : 0)
                                    + ($jeuxVal !== null ? 1 : 0),
                'matches'        => $total,
                'recentHours'    => round($recentSeconds / 3600, 1),
                'totalHours'     => round($heuresEstimees + $heuresValorant, 1),
                'hoursEstimated' => true,

                // Sans ça, Steam gagnait le duel du "jeu principal" par forfait.
                'topGame'        => $jeux[0] ?? null,

                // Une ligne de tableau par jeu : games.php ne sait pas les
                // produire (Riot n'a pas d'API de bibliothèque).
                'virtualGames'   => $jeux,

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
    $niveau = $niveau >= 10 ? 10 : ($niveau >= 4 ? $niveau : 0);

    return sprintf(RIOT_MASTERY_EMBLEM, $niveau);
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
