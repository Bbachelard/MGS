<?php

echo("test");


header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *'); 
 
$platform = $_GET['platform'] ?? '';
$pseudo   = trim($_GET['pseudo'] ?? '');
 
if ($pseudo === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Merci de saisir un pseudo.']);
    exit;
}
 

switch ($platform) {
    case 'Steam':
        echo json_encode(getSteamStats($pseudo));
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

function getSteamStats(string $pseudo): array
{
    $config = require __DIR__ . './config.php';
    $apiKey = $config['STEAM_API_KEY'];
 
    if (empty($apiKey)) {
        http_response_code(500);
        return ['error api'];
    }
 
    //pseudo -> SteamID
    $resolveUrl = 'https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/'
        . '?key=' . urlencode($apiKey)
        . '&vanityurl=' . urlencode($pseudo);
 
    $resolveResponse = @file_get_contents($resolveUrl);
    if ($resolveResponse === false) {
        http_response_code(502);
        return ['error' => "Impossible de contacter l'API Steam."];
    }
 
    $resolveData = json_decode($resolveResponse, true);
 
    if (($resolveData['response']['success'] ?? null) !== 1) {
        http_response_code(404);
        return ['error' => "Aucun profil Steam trouvé pour ce pseudo."];
    }
 
    $steamId = $resolveData['response']['steamid'];
 
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
 
    return [
        'platform'   => 'Steam',
        'pseudo'     => $player['personaname'] ?? $pseudo,
        'avatar'     => $player['avatarfull'] ?? '',
        'profileUrl' => $player['profileurl'] ?? '',
        'statut'     => ($player['personastate'] ?? 0) > 0 ? 'En ligne' : 'Hors ligne',
        'steamid'    => $steamId,
    ];
}
 
 