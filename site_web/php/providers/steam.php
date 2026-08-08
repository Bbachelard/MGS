<?php
declare(strict_types=1);

require_once __DIR__ . '/../platforms.php';

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

    $summary = mgs_http_get_json($base . "ISteamUser/GetPlayerSummaries/v2/{$key}&steamids={$sid}");
    $player  = $summary['response']['players'][0] ?? null;

    if (!$player) {
        return ['ok' => false, 'status' => 404, 'error' => 'Profil introuvable ou privé.'];
    }

    $owned  = mgs_http_get_json($base . "IPlayerService/GetOwnedGames/v1/{$key}&steamid={$sid}&include_appinfo=1&include_played_free_games=1");
    $recent = mgs_http_get_json($base . "IPlayerService/GetRecentlyPlayedGames/v1/{$key}&steamid={$sid}");
    $level  = mgs_http_get_json($base . "IPlayerService/GetSteamLevel/v1/{$key}&steamid={$sid}");
    $badges = mgs_http_get_json($base . "IPlayerService/GetBadges/v1/{$key}&steamid={$sid}");

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