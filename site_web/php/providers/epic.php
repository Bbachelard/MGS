<?php
declare(strict_types=1);

/* ==================================================================
 *  Provider Epic Games — php/providers/epic.php
 *
 *  Liaison  : Epic Account Services (OAuth 2.0) -> Epic Account ID
 *  Stats    : Fortnite via une API tierce, indexée sur ce même ID
 *
 *  Pas de epic_fetch_games() : Epic n'expose aucune API de
 *  bibliothèque. mgs_provider_supports() renverra false et
 *  games.php répondra un 501 propre.
 *
 *  Tout ce qui dépend d'un tiers est confiné entre les bornes
 *  "FOURNISSEUR FORTNITE". Pour en changer, il suffit de réécrire
 *  epic_fortnite_fetch() en respectant son format de sortie.
 * ================================================================== */

require_once __DIR__ . '/../platforms.php';

const EPIC_AUTHORIZE_URL = 'https://www.epicgames.com/id/authorize';
const EPIC_TOKEN_URL     = 'https://api.epicgames.dev/epic/oauth/v2/token';
const EPIC_REVOKE_URL    = 'https://api.epicgames.dev/epic/oauth/v2/revoke';
const EPIC_USERINFO_URL  = 'https://api.epicgames.dev/epic/oauth/v2/userInfo';
const EPIC_ACCOUNTS_URL  = 'https://api.epicgames.dev/epic/id/v2/accounts';

/* ------------------------------------------------------------------ */
/*  Helpers HTTP                                                       */
/*  platforms.php ne fournit que du GET anonyme : on ajoute ici le     */
/*  GET avec en-têtes et le POST form, sans toucher au fichier partagé.*/
/* ------------------------------------------------------------------ */

/** @return array{status:int, data:?array} */
function epic_http_get(string $url, array $headers = []): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_ENCODING       => '',
    ]);

    $body   = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $data = json_decode((string)$body, true);

    return ['status' => $status, 'data' => is_array($data) ? $data : null];
}

/**
 * POST application/x-www-form-urlencoded.
 * $auth : ['basic', id, secret] | ['bearer', token] | null
 * @return array{status:int, data:?array}
 */
function epic_http_post_form(string $url, array $params, ?array $auth = null): array
{
    $headers = ['Content-Type: application/x-www-form-urlencoded'];

    if ($auth !== null && $auth[0] === 'basic') {
        $headers[] = 'Authorization: Basic ' . base64_encode($auth[1] . ':' . $auth[2]);
    } elseif ($auth !== null && $auth[0] === 'bearer') {
        $headers[] = 'Authorization: Bearer ' . $auth[1];
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query($params),
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT        => 10,
    ]);

    $body   = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $data = json_decode((string)$body, true);

    return ['status' => $status, 'data' => is_array($data) ? $data : null];
}

/* ------------------------------------------------------------------ */
/*  Liaison de compte (OAuth 2.0 Authorization Code)                   */
/* ------------------------------------------------------------------ */

function epic_should_complete_link(): bool
{
    return isset($_GET['code']) || isset($_GET['error']);
}

/**
 * Epic exige un redirect_uri strictement identique à celui déclaré au
 * Dev Portal. Le $returnUrl de link.php porte ?platform=&state= et serait
 * rejeté : on utilise $cfg['redirect_uri'] et on fait voyager le state par
 * le paramètre OAuth standard. D'où le repli sur $_SESSION['link_platform']
 * dans link.php (voir patch-epic.md).
 */
function epic_begin_link(array $cfg, string $returnUrl): string
{
    return EPIC_AUTHORIZE_URL . '?' . http_build_query([
        'client_id'     => (string)($cfg['client_id'] ?? ''),
        'response_type' => 'code',
        'scope'         => (string)($cfg['scope'] ?? 'basic_profile'),
        'redirect_uri'  => (string)($cfg['redirect_uri'] ?? ''),
        'state'         => (string)($_SESSION['link_state'] ?? ''),
    ]);
}

function epic_complete_link(array $cfg, string $returnUrl): array
{
    if (isset($_GET['error'])) {
        return ['ok' => false, 'error' => 'Autorisation refusée côté Epic.'];
    }

    $code         = trim((string)($_GET['code'] ?? ''));
    $clientId     = (string)($cfg['client_id'] ?? '');
    $clientSecret = (string)($cfg['client_secret'] ?? '');

    if ($code === '' || $clientId === '' || $clientSecret === '') {
        return ['ok' => false, 'error' => 'Configuration Epic incomplète.'];
    }

    $token = epic_http_post_form(
        EPIC_TOKEN_URL,
        [
            'grant_type'   => 'authorization_code',
            'code'         => $code,
            'redirect_uri' => (string)($cfg['redirect_uri'] ?? ''),
        ],
        ['basic', $clientId, $clientSecret]
    );
    error_log('EPIC token status : ' . $token['status']);
    error_log('EPIC token body   : ' . json_encode($token['data']));

    if ($token['status'] !== 200 || $token['data'] === null) {
        return ['ok' => false, 'error' => 'Échange du code Epic échoué.'];
    }

    $accessToken = (string)($token['data']['access_token'] ?? '');
    $accountId   = (string)($token['data']['account_id']   ?? '');
    $displayName = (string)($token['data']['display_name'] ?? '');

    // Repli sur userInfo si le token ne porte pas déjà l'identité
    if (($accountId === '' || $displayName === '') && $accessToken !== '') {
        $info = epic_http_get(EPIC_USERINFO_URL, ['Authorization: Bearer ' . $accessToken]);

        if ($info['status'] === 200 && $info['data'] !== null) {
            $accountId = $accountId !== ''
                ? $accountId
                : (string)($info['data']['sub'] ?? '');

            $displayName = (string)(
                $info['data']['preferred_username']
                ?? $info['data']['display_name']
                ?? $displayName
            );
        }
    }

    if ($accountId === '') {
        return ['ok' => false, 'error' => 'Identifiant Epic introuvable.'];
    }

    if ($displayName !== '') {
        epic_cache_pseudo($accountId, $displayName);
    }

    // On n'a plus besoin du token : autant ne pas le laisser vivre.
    if ($accessToken !== '') {
        epic_http_post_form(
            EPIC_REVOKE_URL,
            ['token' => $accessToken],
            ['basic', $clientId, $clientSecret]
        );
    }

    return ['ok' => true, 'accountId' => $accountId];
}

/* ------------------------------------------------------------------ */
/*  Cache pseudo (même dossier que les snapshots Steam)                */
/* ------------------------------------------------------------------ */

function epic_cache_pseudo(string $accountId, ?string $pseudo = null): ?string
{
    $dir = __DIR__ . '/../../cache/epic';

    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }

    $fichier = $dir . '/' . preg_replace('/[^0-9A-Za-z]/', '', $accountId) . '.json';

    if ($pseudo !== null) {
        @file_put_contents($fichier, json_encode(['name' => $pseudo, 't' => time()]), LOCK_EX);
        return $pseudo;
    }

    if (!is_file($fichier)) {
        return null;
    }

    $data = json_decode((string)file_get_contents($fichier), true);

    return is_array($data) ? ($data['name'] ?? null) : null;
}

/** Token client_credentials, mémorisé le temps de la requête PHP. */
function epic_client_token(array $cfg): ?string
{
    static $memo = null;

    if ($memo !== null && $memo['exp'] > time() + 30) {
        return $memo['token'];
    }

    $clientId     = (string)($cfg['client_id'] ?? '');
    $clientSecret = (string)($cfg['client_secret'] ?? '');

    if ($clientId === '' || $clientSecret === '') {
        return null;
    }

    $res = epic_http_post_form(
        EPIC_TOKEN_URL,
        ['grant_type' => 'client_credentials'],
        ['basic', $clientId, $clientSecret]
    );

    if ($res['status'] !== 200 || empty($res['data']['access_token'])) {
        return null;
    }

    $memo = [
        'token' => (string)$res['data']['access_token'],
        'exp'   => time() + (int)($res['data']['expires_in'] ?? 3600),
    ];

    return $memo['token'];
}

/** Pseudo Epic : cache d'abord, API Account ensuite. */
function epic_resolve_pseudo(array $cfg, string $accountId): ?string
{
    $pseudo = epic_cache_pseudo($accountId);

    if ($pseudo !== null) {
        return $pseudo;
    }

    $token = epic_client_token($cfg);

    if ($token === null) {
        return null;
    }

    $res = epic_http_get(
        EPIC_ACCOUNTS_URL . '?accountId=' . rawurlencode($accountId),
        ['Authorization: Bearer ' . $token]
    );

    if ($res['status'] === 200 && !empty($res['data'][0]['displayName'])) {
        $pseudo = (string)$res['data'][0]['displayName'];
        epic_cache_pseudo($accountId, $pseudo);
        return $pseudo;
    }

    return null;
}

/* ==================================================================
 *  ##  DÉBUT FOURNISSEUR FORTNITE  ##
 *
 *  Seule zone dépendante d'un tiers. Format de sortie attendu :
 *
 *    ['state' => 'ok', 'modes' => [...], 'battlePass' => ?int]
 *    ['state' => 'private'|'notfound'|'nokey'|'unavailable']
 *
 *  modes : clé => ['label','wins','kills','deaths','kd','matches',
 *                  'winRate','minutes','outlived']
 * ================================================================== */

const EPIC_FN_STATS_URL = 'https://fortnite-api.com/v2/stats/br/v2';

/** Normalise un bloc de stats brut. Les clés absentes valent 0. */
function epic_fortnite_mode(array $brut, string $label): array
{
    return [
        'label'    => $label,
        'wins'     => (int)  ($brut['wins']            ?? 0),
        'kills'    => (int)  ($brut['kills']           ?? 0),
        'deaths'   => (int)  ($brut['deaths']          ?? 0),
        'kd'       => (float)($brut['kd']              ?? 0),
        'matches'  => (int)  ($brut['matches']         ?? 0),
        'winRate'  => (float)($brut['winRate']         ?? 0),
        'minutes'  => (int)  ($brut['minutesPlayed']   ?? 0),
        'outlived' => (int)  ($brut['playersOutlived'] ?? 0),
    ];
}

function epic_fortnite_fetch(array $cfg, string $accountId): array
{
    $cle = (string)($cfg['fortnite_api_key'] ?? '');

    if ($cle === '') {
        return ['state' => 'nokey'];
    }

    $res = epic_http_get(
        EPIC_FN_STATS_URL . '?' . http_build_query([
            'accountId'   => $accountId,
            'accountType' => 'epic',
            'timeWindow'  => 'lifetime',
        ]),
        ['Authorization: ' . $cle]   // pas de préfixe Bearer chez ce fournisseur
    );

    // 403 = le joueur n'a pas rendu ses stats publiques dans Fortnite.
    // C'est le cas le plus fréquent, il mérite son propre message.
    if ($res['status'] === 403) {
        return ['state' => 'private'];
    }

    if ($res['status'] === 404) {
        return ['state' => 'notfound'];
    }

    if ($res['status'] !== 200 || $res['data'] === null) {
        return ['state' => 'unavailable'];
    }

    $data = $res['data']['data'] ?? [];

    // Le champ s'appelle "stats" dans le JSON brut ; certains wrappers
    // le renomment "inputs". On accepte les deux par sécurité.
    $tousInputs = $data['stats']['all'] ?? $data['inputs']['all'] ?? null;

    if (!is_array($tousInputs) || !is_array($tousInputs['overall'] ?? null)) {
        // Compte trouvé mais aucune partie exploitable
        return ['state' => 'private'];
    }

    $modes = ['overall' => epic_fortnite_mode($tousInputs['overall'], 'Toutes parties')];

    foreach (['solo' => 'Solo', 'duo' => 'Duo', 'squad' => 'Escouade'] as $slugMode => $label) {
        if (is_array($tousInputs[$slugMode] ?? null)) {
            $modes[$slugMode] = epic_fortnite_mode($tousInputs[$slugMode], $label);
        }
    }

    return [
        'state'      => 'ok',
        'modes'      => $modes,
        'battlePass' => isset($data['battlePass']['level'])
                        ? (int)$data['battlePass']['level']
                        : null,
    ];
}

/* ==================================================================
 *  ##  FIN FOURNISSEUR FORTNITE  ##
 * ================================================================== */

/** Messages d'état, factorisés pour rester cohérents partout. */
function epic_fortnite_message(string $state): string
{
    return match ($state) {
        'private'  => "Statistiques de carrière masquées. Dans Fortnite : Paramètres > Compte et confidentialité > afficher les statistiques de carrière publiquement.",
        'notfound' => "Aucune partie Fortnite trouvée pour ce compte Epic.",
        'nokey'    => "Statistiques Fortnite non configurées sur le site.",
        default    => "Statistiques Fortnite temporairement indisponibles.",
    };
}

/** Formatage court, à la française. */
function epic_nb(float $valeur, int $decimales = 0): string
{
    return number_format($valeur, $decimales, ',', ' ');
}

/* ------------------------------------------------------------------ */
/*  Stats -> carte normalisée (même format que steam_fetch_stats)      */
/* ------------------------------------------------------------------ */

function epic_fetch_stats(array $cfg, string $accountId): array
{
    $pseudo   = epic_resolve_pseudo($cfg, $accountId) ?? 'Compte Epic';
    $fortnite = epic_fortnite_fetch($cfg, $accountId);

    $base = [
        'platform'      => 'epic',
        'platformLabel' => 'Epic Games',
        'accountId'     => $accountId,
        'displayName'   => $pseudo,
        'avatar'        => '',        // Epic n'expose pas l'avatar aux tiers
        'profileUrl'    => '',
        'status'        => ['label' => 'Compte lié', 'online' => false],
        'activity'      => null,
        'links'         => [
            ['label' => 'Epic Games Store', 'url' => 'https://store.epicgames.com/'],
        ],
    ];

    /* --- Cas dégradé : carte honnête plutôt qu'une erreur. Le compte est
           bien lié, c'est seulement Fortnite qui ne répond pas. --- */
    if ($fortnite['state'] !== 'ok') {
        return [
            'ok'   => true,
            'card' => $base + [
                'subtitle'   => '',
                'highlights' => [
                    ['label' => 'Pseudo Epic',  'value' => $pseudo],
                    ['label' => 'Statistiques', 'value' => 'Indisponibles'],
                ],
                'sections'   => [[
                    'type'  => 'list',
                    'title' => 'Statistiques Fortnite',
                    'items' => [['name' => epic_fortnite_message($fortnite['state']), 'value' => '']],
                    'empty' => '',
                ]],
                'metrics'    => [
                    'accounts'    => 1,
                    'games'       => 0,
                    'playedGames' => 0,
                    'recentHours' => 0,
                    'totalHours'  => 0,
                    'topGame'     => null,
                    'recentTop'   => [],
                    'ranks'       => [],
                    'mainRank'    => null,
                ],
            ],
        ];
    }

    /* --- Cas nominal --- */
    $global = $fortnite['modes']['overall'];
    $heures = round($global['minutes'] / 60, 1);

    $highlights = [
        ['label' => 'Pseudo Epic',      'value' => $pseudo],
        ['label' => 'Victoires',        'value' => epic_nb($global['wins'])],
        ['label' => 'Ratio E/M',        'value' => epic_nb($global['kd'], 2)],
        ['label' => 'Éliminations',     'value' => epic_nb($global['kills'])],
        ['label' => 'Parties jouées',   'value' => epic_nb($global['matches'])],
        ['label' => 'Taux de victoire', 'value' => epic_nb($global['winRate'], 1) . ' %'],
        ['label' => 'Temps de jeu',     'value' => epic_nb($heures) . ' h'],
        ['label' => 'Joueurs survécus', 'value' => epic_nb($global['outlived'])],
    ];

    if ($fortnite['battlePass'] !== null) {
        $highlights[] = ['label' => 'Niveau du pass', 'value' => (string)$fortnite['battlePass']];
    }

    // Détail par mode, en sautant le global déjà affiché au-dessus
    $parMode    = [];
    $modeFavori = null;

    foreach ($fortnite['modes'] as $slugMode => $mode) {
        if ($slugMode === 'overall') {
            continue;
        }

        $parMode[] = [
            'name'  => $mode['label'],
            'value' => epic_nb($mode['wins']) . ' V · '
                     . epic_nb($mode['kd'], 2) . ' K/D · '
                     . epic_nb(round($mode['minutes'] / 60)) . ' h',
        ];

        if ($modeFavori === null || $mode['minutes'] > $modeFavori['minutes']) {
            $modeFavori = $mode;
        }
    }

    return [
        'ok'   => true,
        'card' => $base + [
            'subtitle'   => 'Fortnite',
            'highlights' => $highlights,
            'sections'   => [
                [
                    'type'  => 'list',
                    'title' => 'Fortnite par mode',
                    'items' => $parMode,
                    'empty' => 'Aucun mode détaillé disponible',
                ],
                [
                    'type'  => 'list',
                    'title' => 'À propos de ces données',
                    'items' => [[
                        'name'  => "Statistiques Fortnite uniquement : Epic n'expose pas le reste de la bibliothèque.",
                        'value' => '',
                    ]],
                    'empty' => '',
                ],
            ],
            'metrics'    => [
                'accounts'    => 1,
                // 1 seul "jeu" connu : Fortnite. Compter une bibliothèque
                // entière serait mentir, on assume le périmètre.
                'games'       => 1,
                'playedGames' => $global['matches'] > 0 ? 1 : 0,
                'recentHours' => 0,   // pas de fenêtre glissante côté Fortnite
                'totalHours'  => $heures,
                'topGame'     => [
                    'name'      => $modeFavori ? 'Fortnite — ' . $modeFavori['label'] : 'Fortnite',
                    'hours'     => round($heures),
                    'image'     => '',   // ajouter un visuel local si souhaité
                    'platform'  => 'Epic Games',
                    // Ne couvre que Fortnite : le hub affichera "≈"
                    'estimated' => true,
                ],
                'recentTop'   => [],
                'ranks'       => [],
                'mainRank'    => null,
            ],
        ],
    ];
}