<?php
declare(strict_types=1);

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
    $dir = MGS_ROOT . '/cache/riot-matches';

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
