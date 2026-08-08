<?php

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$platform = $_GET['platform'] ?? '';
$pseudo   = trim($_GET['pseudo'] ?? '');
$steamId  = trim($_GET['steamid'] ?? '');

if ($pseudo === '' && $steamId === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Merci de saisir un pseudo.']);
    exit;
}

switch ($platform) {
    case 'Steam':
        echo json_encode(getSteamStats($pseudo, $steamId));
        break;

    case 'Riot':
        http_response_code(501);
        echo json_encode(['error' => 'Riot Games']);
        break;

    case 'Epic Games':
        http_response_code(501);
        echo json_encode(['error' => 'Epic Games']);
        break;

    default:
        http_response_code(400);
        echo json_encode(['error' => 'Plateforme inconnue.']);
        break;
}

function getSteamStats(string $pseudo = '', string $steamId = ''): array
{
    $config = require __DIR__ . '/../config.php';
    $apiKey = $config['STEAM_API_KEY'];

    if (empty($apiKey)) {
        http_response_code(500);
        return ['error' => 'Erreur de configuration API.'];
    }

    // Si on n'a pas déjà un steamId (compte lié), on résout le pseudo
    if ($steamId === '') {

        if (preg_match('/^\d{17}$/', $pseudo)) {
            $steamId = $pseudo;

        } elseif (preg_match('#steamcommunity\.com/profiles/(\d{17})#i', $pseudo, $m)) {
            $steamId = $m[1];

        } elseif (preg_match('#steamcommunity\.com/id/([^/]+)#i', $pseudo, $m)) {
            $pseudo = $m[1]; 

        }
        if ($steamId === '') {
            $resolveUrl = 'https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/'
                . '?key=' . urlencode($apiKey)
                . '&vanityurl=' . urlencode($pseudo);

            $resolveResponse = @file_get_contents($resolveUrl);
            $resolveData = json_decode($resolveResponse, true);

            if (($resolveData['response']['success'] ?? null) !== 1) {
                http_response_code(404);
                return ['error' => "Aucun profil Steam trouvé pour ce pseudo. Essaie plutôt avec le SteamID64 ou l'URL complète du profil."];
            }

            $steamId = $resolveData['response']['steamid'];
        }
    }
    // SteamID -> profil public
    $summaryUrl = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/'
        . '?key=' . urlencode($apiKey)
        . '&steamids=' . urlencode($steamId);

    $summaryResponse = @file_get_contents($summaryUrl);
    if ($summaryResponse === false) {
        http_response_code(502);
        return ['error' => "Impossible de récupérer le profil du joueur."];
    }

    $summaryData = json_decode($summaryResponse, true);
    $player = $summaryData['response']['players'][0] ?? null;

    if (!$player) {
        http_response_code(404);
        return ['error' => 'Profil introuvable ou privé.'];
    }

    $ownedGamesUrl = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/'
        . '?key=' . urlencode($apiKey)
        . '&steamid=' . urlencode($steamId)
        . '&include_appinfo=1'
        . '&include_played_free_games=1';
    $ownedGamesData = json_decode(@file_get_contents($ownedGamesUrl), true);
    $ownedGames = $ownedGamesData['response']['games'] ?? [];

    $recentUrl = 'https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/'
        . '?key=' . urlencode($apiKey)
        . '&steamid=' . urlencode($steamId);
    $recentData = json_decode(@file_get_contents($recentUrl), true);
    $recentGames = $recentData['response']['games'] ?? [];

    $levelUrl = 'https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/'
        . '?key=' . urlencode($apiKey)
        . '&steamid=' . urlencode($steamId);
    $levelData = json_decode(@file_get_contents($levelUrl), true);
    $steamLevel = $levelData['response']['player_level'] ?? null;

    $badgesUrl = 'https://api.steampowered.com/IPlayerService/GetBadges/v1/'
        . '?key=' . urlencode($apiKey)
        . '&steamid=' . urlencode($steamId);
    $badgesData = json_decode(@file_get_contents($badgesUrl), true);
    $badges = $badgesData['response']['badges'] ?? [];
    $xp = $badgesData['response']['player_xp'] ?? null;

    $etats = [
        0 => 'Hors ligne', 1 => 'En ligne', 2 => 'Occupé',
        3 => 'Absent', 4 => 'Endormi', 5 => 'Cherche à échanger', 6 => 'Cherche à jouer'
    ];

    return [
        'platform'                 => 'Steam',
        'pseudo'                   => $player['personaname'] ?? $pseudo,
        'avatar'                   => $player['avatarfull'] ?? '',
        'avatarmedium'             => $player['avatarmedium'] ?? '',
        'profileUrl'               => $player['profileurl'] ?? '',
        'statut'                   => $etats[$player['personastate'] ?? 0] ?? 'Inconnu',
        'communityvisibilitystate' => ($player['communityvisibilitystate'] ?? 1) === 3 ? 'Public' : 'Privé',
        'lastlogoff'               => $player['lastlogoff'] ?? null,
        'timecreated'              => $player['timecreated'] ?? null,
        'realname'                 => $player['realname'] ?? '',
        'loccountrycode'           => $player['loccountrycode'] ?? '',
        'locstatecode'             => $player['locstatecode'] ?? '',
        'gameextrainfo'            => $player['gameextrainfo'] ?? null,
        'gameid'                   => $player['gameid'] ?? null,
        'primaryclanid'            => $player['primaryclanid'] ?? '',
        'steamid'                  => $steamId,
        'steamLevel'               => $steamLevel,
        'xp'                       => $xp,
        'badges'                   => $badges,
        'ownedGamesCount'          => count($ownedGames),
        'ownedGames'               => $ownedGames,
        'recentGames'              => $recentGames,
    ];
}