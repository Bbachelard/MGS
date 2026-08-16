<?php
declare(strict_types=1);

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
