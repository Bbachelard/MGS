<?php
declare(strict_types=1);

/* ==================================================================
 *  providers/riot/valorant.php — Valorant.
 *
 *  Même principe que le bloc « FOURNISSEUR FORTNITE » d'epic.php :
 *  Riot n'ouvre pas ses endpoints Valorant aux clés de développement
 *  (« Personal Key Applications are currently not supported »), donc
 *  les stats passent par une API tierce, confinée entre les bornes
 *  « FOURNISSEUR VALORANT » ci-dessous.
 *
 *  Pour changer de fournisseur, il suffit de réécrire
 *  riot_valorant_fetch() en respectant son format de sortie :
 *
 *    ['state' => 'ok', 'current' => …, 'peak' => …, 'season' => …,
 *     'matches' => [...], 'agents' => [...], 'totals' => [...]]
 *    ['state' => 'nokey'|'badkey'|'notfound'|'private'
 *              |'ratelimit'|'unavailable']
 *
 *  Le reste du fichier (percentiles, emblèmes, encadrés, sections)
 *  ne dépend d'aucun tiers : il travaille sur ce format.
 *
 *  Le compte est le même que pour League of Legends — un PUUID Riot —
 *  donc rien à lier de plus : un compte Riot déjà vérifié affiche
 *  automatiquement ses stats Valorant.
 * ================================================================== */

/* ==================================================================
 *  ##  DÉBUT FOURNISSEUR VALORANT  ##
 * ================================================================== */

/**
 * HenrikDev — la référence communautaire pour Valorant, et la seule
 * source publique qui expose le rang, le RR et l'historique de parties
 * sans clé Production Riot. Clé gratuite, voir README.
 */
const RIOT_VAL_API_BASE = 'https://api.henrikdev.xyz/valorant';

/**
 * Gabarits d'URL. Si le fournisseur renumérote ses routes, ce sont les
 * DEUX SEULES lignes à corriger — même philosophie que RIOT_MASTERY_EMBLEM.
 *   %1$s = région (eu, na, ap, kr, br, latam)   %2$s = PUUID
 */
const RIOT_VAL_URL_MMR     = RIOT_VAL_API_BASE . '/v3/by-puuid/mmr/%1$s/pc/%2$s';
const RIOT_VAL_URL_MATCHES = RIOT_VAL_API_BASE . '/v1/by-puuid/stored-matches/%1$s/%2$s?size=%3$d';

/**
 * GET authentifié, en parallèle. On ne peut pas réutiliser riot_get_multi() :
 * il pose un header X-Riot-Token, le fournisseur attend Authorization.
 *
 * @param  array<string,string> $urls  clé => URL
 * @return array<string,array{status:int, data:?array}>
 */
function riot_val_get_multi(array $urls, string $cle): array
{
    if (!$urls) {
        return [];
    }

    $headers = ['Authorization: ' . $cle, 'Accept: application/json'];

    // Repli séquentiel si curl n'est pas compilé, comme partout ailleurs.
    if (!function_exists('curl_multi_init')) {
        $out = [];

        foreach ($urls as $nom => $url) {
            $contexte = stream_context_create([
                'http' => [
                    'timeout'       => 8,
                    'ignore_errors' => true,
                    'header'        => implode("\r\n", $headers) . "\r\n",
                ],
            ]);

            $corps  = @file_get_contents($url, false, $contexte);
            $status = 0;

            if (isset($http_response_header[0])
                && preg_match('#\s(\d{3})\s#', $http_response_header[0], $m)) {
                $status = (int)$m[1];
            }

            $data = json_decode((string)$corps, true);

            $out[$nom] = [
                'status' => $corps === false ? ($status ?: 502) : $status,
                'data'   => is_array($data) ? $data : null,
            ];
        }

        return $out;
    }

    $multi   = curl_multi_init();
    $handles = [];

    foreach ($urls as $nom => $url) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_ENCODING       => '',   // gzip
        ]);
        curl_multi_add_handle($multi, $ch);
        $handles[$nom] = $ch;
    }

    do {
        $status = curl_multi_exec($multi, $running);
        if ($running) {
            curl_multi_select($multi, 1.0);
        }
    } while ($running && $status === CURLM_OK);

    $resultats = [];

    foreach ($handles as $nom => $ch) {
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $data = json_decode((string)curl_multi_getcontent($ch), true);

        $resultats[$nom] = [
            'status' => $code,
            'data'   => is_array($data) ? $data : null,
        ];

        curl_multi_remove_handle($multi, $ch);
        curl_close($ch);
    }

    curl_multi_close($multi);

    return $resultats;
}

/**
 * Journal de diagnostic. N'écrit QUE sur échec : la carte affiche un
 * message générique au visiteur (on ne lui doit pas l'état de notre
 * configuration), il faut bien que le code réel atterrisse quelque part.
 * Jamais la clé, évidemment.
 */
function riot_val_log(string $message): void
{
    error_log('VALORANT ' . $message);

    $dir = MGS_ROOT . '/cache';

    if (is_dir($dir) && is_writable($dir)) {
        @file_put_contents(
            $dir . '/valorant-debug.log',
            date('Y-m-d H:i:s') . ' ' . $message . "\n",
            FILE_APPEND | LOCK_EX
        );
    }
}

/** Traduit un code HTTP du fournisseur en état interne. */
function riot_val_state(int $status): string
{
    return match (true) {
        $status === 401 || $status === 403 => 'badkey',
        $status === 404                    => 'notfound',
        $status === 429                    => 'ratelimit',
        default                            => 'unavailable',
    };
}

/**
 * Rang + historique d'un compte Valorant.
 *
 * @param string $puuid     PUUID Riot (le même que pour League of Legends)
 * @param string $region    région Valorant : eu, na, ap, kr, br, latam
 */
function riot_valorant_fetch(array $cfg, string $puuid, string $region): array
{
    $cle = (string)($cfg['valorant_api_key'] ?? '');

    if ($cle === '' || $puuid === '') {
        return ['state' => 'nokey'];
    }

    $reponses = riot_val_get_multi([
        'mmr'     => sprintf(RIOT_VAL_URL_MMR, $region, rawurlencode($puuid)),
        'matches' => sprintf(RIOT_VAL_URL_MATCHES, $region, rawurlencode($puuid), RIOT_VAL_MATCHES_MAX),
    ], $cle);

    $mmr = $reponses['mmr'];

    // Le MMR fait foi : sans lui on ne sait rien dire du compte.
    if ($mmr['status'] !== 200 || !is_array($mmr['data']['data'] ?? null)) {
        $etat = riot_val_state($mmr['status']);

        riot_val_log(sprintf(
            'MMR http=%d state=%s region=%s puuid=%s… erreurs=%s',
            $mmr['status'],
            $mmr['status'] === 200 ? $etat . ' (200 mais forme inattendue)' : $etat,
            $region,
            substr($puuid, 0, 8),
            json_encode($mmr['data']['errors'] ?? $mmr['data'] ?? null)
        ));

        return ['state' => $etat];
    }

    $d = $mmr['data']['data'];

    /* --- Rang courant ------------------------------------------------ */
    $current = [
        'tierId'      => (int)   ($d['current']['tier']['id']              ?? 0),
        'tierName'    => (string)($d['current']['tier']['name']            ?? ''),
        'rr'          => (int)   ($d['current']['rr']                      ?? 0),
        'lastChange'  => (int)   ($d['current']['last_change']             ?? 0),
        'elo'         => (int)   ($d['current']['elo']                     ?? 0),
        'leaderboard' => isset($d['current']['leaderboard_placement']['rank'])
                         ? (int)$d['current']['leaderboard_placement']['rank']
                         : (is_int($d['current']['leaderboard_placement'] ?? null)
                            ? (int)$d['current']['leaderboard_placement']
                            : null),
    ];

    /* --- Pic de rang ------------------------------------------------- */
    $peak = [
        'tierId'   => (int)   ($d['peak']['tier']['id']      ?? 0),
        'tierName' => (string)($d['peak']['tier']['name']    ?? ''),
        'season'   => (string)($d['peak']['season']['short'] ?? ''),
    ];

    /* --- Saisons : la dernière entrée est l'acte en cours ------------ */
    $seasonal      = is_array($d['seasonal'] ?? null) ? $d['seasonal'] : [];
    $partiesTotal  = 0;
    $victoiresTot  = 0;

    foreach ($seasonal as $s) {
        $partiesTotal += (int)($s['games'] ?? 0);
        $victoiresTot += (int)($s['wins']  ?? 0);
    }

    $derniere = $seasonal ? $seasonal[array_key_last($seasonal)] : null;

    $season = $derniere ? [
        'short' => (string)($derniere['season']['short'] ?? ''),
        'games' => (int)   ($derniere['games']           ?? 0),
        'wins'  => (int)   ($derniere['wins']            ?? 0),
    ] : null;

    /* --- Historique de parties (facultatif : le rang seul suffit) ---- */
    $matches = [];
    $brutes  = $reponses['matches'];

    if ($brutes['status'] === 200 && is_array($brutes['data']['data'] ?? null)) {
        $matches = riot_val_normaliser_matches($brutes['data']['data']);
    }

    return [
        'state'      => 'ok',
        'riotId'     => trim((string)($d['account']['name'] ?? '')) !== ''
                        ? $d['account']['name'] . '#' . ($d['account']['tag'] ?? '')
                        : null,
        'region'     => $region,
        'current'    => $current,
        'peak'       => $peak,
        'season'     => $season,
        'matches'    => $matches,
        'agents'     => riot_val_agents($matches),
        'totals'     => [
            'games' => $partiesTotal,
            'wins'  => $victoiresTot,
        ],
    ];
}

/**
 * Une entrée de stored-matches -> ligne normalisée.
 * Toutes les clés absentes valent 0 : le fournisseur change ses champs
 * de temps en temps, une carte à zéro vaut mieux qu'une erreur PHP.
 */
function riot_val_normaliser_matches(array $brutes): array
{
    $matches = [];

    foreach ($brutes as $m) {
        // Une entrée sans meta NI stats n'est pas une partie tronquée,
        // c'est du bruit : la laisser passer ajoutait une défaite 0-0
        // aux compteurs de forme.
        if (!is_array($m) || (!is_array($m['meta'] ?? null) && !is_array($m['stats'] ?? null))) {
            continue;
        }

        $meta   = is_array($m['meta']  ?? null) ? $m['meta']  : [];
        $stats  = is_array($m['stats'] ?? null) ? $m['stats'] : [];
        $teams  = is_array($m['teams'] ?? null) ? $m['teams'] : [];

        $equipe = strtolower((string)($stats['team'] ?? ''));
        $rouge  = (int)($teams['red']  ?? 0);
        $bleu   = (int)($teams['blue'] ?? 0);

        $mien   = $equipe === 'red' ? $rouge : $bleu;
        $sien   = $equipe === 'red' ? $bleu  : $rouge;

        $morts  = (int)($stats['deaths'] ?? 0);
        $kills  = (int)($stats['kills']  ?? 0);

        $date = (string)($meta['started_at'] ?? '');
        $ts   = $date !== '' ? strtotime($date) : false;

        $matches[] = [
            'map'     => (string)($meta['map']['name']       ?? ''),
            'mode'    => (string)($meta['mode']              ?? ''),
            'agent'   => (string)($stats['character']['name'] ?? ''),
            'kills'   => $kills,
            'deaths'  => $morts,
            'assists' => (int)($stats['assists'] ?? 0),
            'score'   => (int)($stats['score']   ?? 0),
            'kd'      => $morts > 0 ? round($kills / $morts, 2) : (float)$kills,
            'rounds'  => $mien . '-' . $sien,
            'win'     => $mien > $sien,
            'date'    => $ts === false ? null : $ts,
        ];
    }

    return $matches;
}

/* ==================================================================
 *  ##  FIN FOURNISSEUR VALORANT  ##
 *  Tout ce qui suit ne dépend plus d'aucun tiers.
 * ================================================================== */

/** Agents les plus joués sur l'historique disponible. */
function riot_val_agents(array $matches): array
{
    $parAgent = [];

    foreach ($matches as $m) {
        $nom = $m['agent'];

        if ($nom === '') {
            continue;
        }

        if (!isset($parAgent[$nom])) {
            $parAgent[$nom] = ['name' => $nom, 'matches' => 0, 'kills' => 0, 'deaths' => 0, 'wins' => 0];
        }

        $parAgent[$nom]['matches']++;
        $parAgent[$nom]['kills']  += $m['kills'];
        $parAgent[$nom]['deaths'] += $m['deaths'];
        $parAgent[$nom]['wins']   += $m['win'] ? 1 : 0;
    }

    uasort($parAgent, fn($a, $b) => $b['matches'] <=> $a['matches']);

    $agents = [];

    foreach (array_slice($parAgent, 0, RIOT_VAL_AGENTS_TOP) as $a) {
        $a['kd']      = $a['deaths'] > 0 ? round($a['kills'] / $a['deaths'], 2) : (float)$a['kills'];
        $agents[]     = $a;
    }

    return $agents;
}

/** Libellé français d'un mode. Les modes inconnus passent tels quels. */
function riot_val_mode_label(string $mode): string
{
    $cle = strtolower(str_replace([' ', '_', '-'], '', $mode));

    return RIOT_VAL_MODES[$cle] ?? $mode;
}

/** Messages d'état, factorisés pour rester cohérents partout. */
function riot_valorant_message(string $state): string
{
    return match ($state) {
        'nokey'     => "Statistiques Valorant non configurées sur le site.",
        'notfound'  => "Aucune partie Valorant trouvée pour ce compte Riot.",
        'private'   => "Statistiques Valorant masquées pour ce compte.",
        'ratelimit' => "Trop de requêtes Valorant, réessaie dans une minute.",
        // 'badkey' tombe ici volontairement : une clé cassée est un
        // problème de configuration du site, pas une information à
        // servir au visiteur. L'état reste distinct pour les logs.
        default     => "Statistiques Valorant temporairement indisponibles.",
    };
}

/* ------------------------------------------------------------------ */
/*  Rangs                                                              */
/* ------------------------------------------------------------------ */

/**
 * tier.id -> tier interne + division.
 * L'échelle du jeu : 0-2 = non classé, puis 3 paliers par tier
 * (Fer 1/2/3 = 3/4/5 … Immortel 1/2/3 = 24/25/26), Radiant = 27.
 * On calcule au lieu de tabuler 28 lignes : Riot n'a jamais changé le pas.
 */
function riot_val_tier(int $tierId): ?array
{
    if ($tierId < 3) {
        return null;   // Non classé
    }

    $index = intdiv($tierId, 3) - 1;
    $cles  = array_keys(RIOT_VAL_TIERS);

    if (!isset($cles[$index])) {
        return null;
    }

    $cle = $cles[$index];

    return [
        'key'      => $cle,
        'label'    => RIOT_VAL_TIERS[$cle],
        // Radiant n'a pas de division ; Immortel non plus depuis l'épisode 5.
        'division' => in_array($cle, RIOT_VAL_TIERS_SANS_DIVISION, true)
                      ? 0
                      : ($tierId % 3) + 1,
    ];
}

/** Libellé français complet : « Or 3 », « Radiant », « Non classé ». */
function riot_val_format_rank(int $tierId): string
{
    $tier = riot_val_tier($tierId);

    if ($tier === null) {
        return 'Non classé';
    }

    return trim($tier['label'] . ' ' . ($tier['division'] ?: ''));
}

/**
 * Percentile 0-100, même échelle que riot_rank_percentile() pour LoL :
 * c'est ce qui permet au hub de trier un Immortel Valorant et un
 * Diamant LoL dans le bon ordre.
 */
function riot_val_percentile(int $tierId, int $rr = 0): ?float
{
    $tier = riot_val_tier($tierId);

    if ($tier === null || !isset(RIOT_VAL_TIER_PERCENTILE[$tier['key']])) {
        return null;
    }

    [$bas, $haut] = RIOT_VAL_TIER_PERCENTILE[$tier['key']];

    if ($tier['division'] === 0) {
        // Radiant / Immortel : pas de division, on étale sur le RR.
        $ratio = min(1.0, max(0, $rr) / 500);
    } else {
        $ratio = (($tier['division'] - 1) + min(1.0, max(0, $rr) / 100)) / 3;
    }

    return round($bas + ($haut - $bas) * $ratio, 2);
}

/**
 * Emblème du tier. Le fichier local gagne toujours (charte maison) ;
 * sans lui on sert l'emblème officiel plutôt qu'un 404.
 * Fichiers attendus : content/image/ranks/val-gold.png, val-radiant.png…
 */
function riot_val_rank_icon(int $tierId): string
{
    $tier = riot_val_tier($tierId);
    $slug = $tier === null ? 'unranked' : strtolower($tier['key']);

    $local = '/content/image/ranks/val-' . $slug . '.png';

    if (is_file(MGS_ROOT . $local)) {
        return $local;
    }

    // L'emblème distant est indexé sur le tier.id brut, pas sur le slug.
    return $tierId >= 3 ? sprintf(RIOT_VAL_RANK_EMBLEM, $tierId) : '';
}

/** Couleur d'accent d'un tier. Gris neutre pour les non classés. */
function riot_val_tier_couleur(int $tierId): string
{
    $tier = riot_val_tier($tierId);

    return $tier === null ? '#6b6b78' : (RIOT_VAL_TIER_COULEUR[$tier['key']] ?? '#6b6b78');
}

/**
 * Entrée de rang normalisée, consommée telle quelle par hub-resume.js —
 * strictement le même format que riot_rank_entry() pour LoL.
 */
function riot_valorant_rank_entry(array $val): ?array
{
    if (($val['state'] ?? '') !== 'ok') {
        return null;
    }

    $tierId = (int)$val['current']['tierId'];

    if ($tierId < 3) {
        return null;   // non classé : rien à comparer
    }

    $tier    = riot_val_tier($tierId);
    $rr      = (int)$val['current']['rr'];
    $saison  = $val['season'] ?? null;

    $parties = (int)($saison['games'] ?? 0);
    $wins    = (int)($saison['wins']  ?? 0);

    $details = [$rr . ' RR'];

    if ($parties > 0) {
        $details[] = round($wins / $parties * 100) . ' % WR';
        $details[] = $parties . ' parties';
    }

    return [
        'game'     => 'Valorant',
        'queue'    => 'Compétitif' . ($saison && $saison['short'] !== '' ? ' · ' . strtoupper($saison['short']) : ''),
        'label'    => riot_val_format_rank($tierId),
        'tier'     => $tier['key'],
        'division' => $tier['division'] ? (string)$tier['division'] : '',
        'lp'       => $rr,
        'winrate'  => $parties > 0 ? round($wins / $parties * 100) : null,
        'games'    => $parties,
        'icon'     => riot_val_rank_icon($tierId),
        'score'    => riot_val_percentile($tierId, $rr),
        'sub'      => implode(' · ', $details),
        'platform' => 'riot',
    ];
}

/* ------------------------------------------------------------------ */
/*  Rendu : encadrés, sections, métriques                              */
/* ------------------------------------------------------------------ */

/** Formatage court, à la française (même helper que côté Epic). */
function riot_val_nb(float $valeur, int $decimales = 0): string
{
    return number_format($valeur, $decimales, ',', ' ');
}

/**
 * Encadrés Valorant, ajoutés à la suite de ceux de LoL.
 * Rien n'est renvoyé quand Valorant ne répond pas : la carte Riot
 * reste exactement celle d'avant.
 */
function riot_valorant_highlights(array $val): array
{
    if (($val['state'] ?? '') !== 'ok') {
        return [];
    }

    $tierId = (int)$val['current']['tierId'];
    $rr     = (int)$val['current']['rr'];
    $saison = $val['season'] ?? null;
    $peakId = (int)$val['peak']['tierId'];

    $parties = (int)($saison['games'] ?? 0);
    $wins    = (int)($saison['wins']  ?? 0);
    $winrate = $parties > 0 ? (int)round($wins / $parties * 100) : null;

    $encadres = [
        [
            'label'  => 'Valorant',
            'value'  => riot_val_format_rank($tierId),
            'icon'   => 'rank',
            'image'  => riot_val_rank_icon($tierId),
            'accent' => riot_val_tier_couleur($tierId),
            'sub'    => $tierId >= 3 ? $rr . ' RR' : null,
        ],
        [
            'label' => 'Pic Valorant',
            'value' => $peakId >= 3 ? riot_val_format_rank($peakId) : '-',
            'icon'  => 'rank',
            'image' => riot_val_rank_icon($peakId),
            'sub'   => $val['peak']['season'] !== '' ? strtoupper($val['peak']['season']) : null,
        ],
    ];

    if ($parties > 0) {
        $encadres[] = [
            'label' => 'Winrate Valorant',
            'value' => $winrate . ' %',
            'icon'  => 'winrate',
            'tone'  => $winrate >= 50 ? 'win' : 'loss',
            'bar'   => $winrate,
            'sub'   => $wins . 'V · ' . ($parties - $wins) . 'D',
        ];
    }

    if ($val['matches']) {
        $kills  = array_sum(array_column($val['matches'], 'kills'));
        $deaths = array_sum(array_column($val['matches'], 'deaths'));

        $pips = [];
        foreach ($val['matches'] as $m) {
            $pips[] = $m['win'] ? 'V' : 'D';
        }

        $encadres[] = [
            'label' => 'K/D Valorant',
            'value' => riot_val_nb($deaths > 0 ? $kills / $deaths : (float)$kills, 2),
            'icon'  => 'form',
            'dots'  => array_slice($pips, 0, 10),
            'sub'   => 'sur les ' . count($val['matches']) . ' dernières',
        ];
    }

    return $encadres;
}

/**
 * Sections Valorant : agents favoris + dernières parties.
 * On reste sur le type 'list' — la section 'matches' est un rendu
 * spécifique à LoL (champions, sorts, runes, objets) qui n'a pas de
 * sens ici, et qui exigerait un second jeu d'assets.
 */
function riot_valorant_sections(array $val): array
{
    if (($val['state'] ?? '') !== 'ok') {
        return [];
    }

    $sections = [];

    /* --- Agents favoris --- */
    $agents  = $val['agents'];
    $maxJoue = $agents ? (int)$agents[0]['matches'] : 0;

    $items = [];

    foreach ($agents as $a) {
        $items[] = [
            'name'  => $a['name'],
            'value' => $a['matches'] . ($a['matches'] > 1 ? ' parties · ' : ' partie · ')
                       . riot_val_nb($a['kd'], 2) . ' K/D',
            'image' => sprintf(RIOT_VAL_AGENT_ICON, rawurlencode(strtolower($a['name']))),
            'bar'   => $maxJoue > 0 ? (int)round($a['matches'] / $maxJoue * 100) : 0,
        ];
    }

    $sections[] = [
        'type'    => 'list',
        'title'   => 'Agents favoris (Valorant)',
        'items'   => $items,
        'empty'   => 'Aucune partie Valorant récente',
        'variant' => 'agents',
    ];

    /* --- Dernières parties --- */
    $parties = [];

    foreach (array_slice($val['matches'], 0, RIOT_VAL_MATCHES_AFFICHEES) as $m) {
        $titre = ($m['win'] ? 'Victoire' : 'Défaite') . ' ' . $m['rounds'];

        if ($m['map'] !== '') {
            $titre .= ' · ' . $m['map'];
        }

        // Le mode n'est rappelé que s'il sort de l'ordinaire : sur une
        // liste à 90 % compétitive, l'écrire partout n'apprend rien.
        $mode = riot_val_mode_label($m['mode']);

        if ($mode !== '' && strtolower($m['mode']) !== 'competitive') {
            $titre .= ' · ' . $mode;
        }

        $parties[] = [
            'name'  => $titre,
            'value' => $m['kills'] . '/' . $m['deaths'] . '/' . $m['assists']
                       . ($m['agent'] !== '' ? ' · ' . $m['agent'] : ''),
            'image' => $m['agent'] !== ''
                       ? sprintf(RIOT_VAL_AGENT_ICON, rawurlencode(strtolower($m['agent'])))
                       : '',
        ];
    }

    $sections[] = [
        'type'  => 'list',
        'title' => 'Dernières parties Valorant',
        'items' => $parties,
        'empty' => 'Aucune partie Valorant récente',
    ];

    return $sections;
}

/**
 * Section unique affichée quand Valorant ne répond pas : le compte Riot
 * est bien là, c'est seulement Valorant qui manque. Même parti pris que
 * la carte dégradée d'Epic — une explication vaut mieux qu'un blanc.
 * 'nokey' ne produit rien du tout : c'est une absence de configuration
 * du site, pas une information pour le visiteur.
 */
function riot_valorant_section_degradee(array $val): array
{
    $state = (string)($val['state'] ?? 'unavailable');

    if ($state === 'ok' || $state === 'nokey') {
        return [];
    }

    return [[
        'type'  => 'list',
        'title' => 'Valorant',
        'items' => [['name' => riot_valorant_message($state), 'value' => '']],
        'empty' => '',
    ]];
}

/**
 * Heures Valorant estimées. Le fournisseur ne donne pas la durée des
 * parties : on multiplie le nombre de parties classées de toutes les
 * saisons par une durée moyenne. C'est une estimation assumée, signalée
 * comme telle par 'estimated' => true, exactement comme les heures LoL
 * déduites des points de maîtrise.
 */
function riot_valorant_heures(array $val): float
{
    if (($val['state'] ?? '') !== 'ok') {
        return 0.0;
    }

    $parties = (int)($val['totals']['games'] ?? 0);

    return round($parties * RIOT_VAL_MINUTES_PAR_PARTIE / 60, 1);
}

/**
 * Ligne « Valorant » du tableau des jeux et candidat au titre de jeu
 * principal. Retourne null tant qu'aucune partie n'est connue : une
 * ligne à 0 h polluerait la bibliothèque.
 */
function riot_valorant_game(array $val): ?array
{
    $heures = riot_valorant_heures($val);

    if ($heures <= 0) {
        return null;
    }

    return [
        'name'      => 'Valorant',
        'hours'     => $heures,
        'image'     => RIOT_VAL_JAQUETTE,
        'platform'  => 'Riot',
        'estimated' => true,
    ];
}
