<?php
declare(strict_types=1);

/* ==================================================================
 *  providers/riot/ranks.php — rangs : formatage, percentile, emblèmes.
 *
 *  Le percentile est ce qui permet de comparer un Diamant LoL à un
 *  Diamant CS2 : chaque provider doit renvoyer la même échelle 0-100.
 * ================================================================== */

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

    if (!in_array($tier, RIOT_TIERS_AVEC_ICONE, true)) {
        $tier = 'unranked';
    }

    $local = '/content/image/ranks/lol-' . $tier . '.png';

    // Le fichier local gagne toujours : il permet de garder une charte
    // maison. Sans lui, on sert l'emblème officiel plutôt qu'un 404.
    return is_file(MGS_ROOT . $local)
        ? $local
        : sprintf(RIOT_RANK_EMBLEM, $tier);
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
