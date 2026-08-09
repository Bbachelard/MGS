<?php
declare(strict_types=1);

/**
 * Registre central des plateformes.
 *  - enabled    : un provider existe et fonctionne
 *  - linkable   : on sait lier un compte (OpenID / OAuth)
 *  - searchable : on sait chercher un joueur par pseudo depuis l'accueil
 */
function mgs_platforms(): array
{
    static $platforms = null;

    if ($platforms !== null) {
        return $platforms;
    }

    $platforms = [
        'steam' => [
            'slug'       => 'steam',
            'label'      => 'Steam',
            'icon'       => '/content/image/Steam_icon.webp',
            'enabled'    => true,
            'linkable'   => true,
            'verifiable' => false,
            'searchable' => true,
            'aliases'    => ['steam'],
        ],
        'riot' => [
            'slug'       => 'riot',
            'label'      => 'Riot Games',
            'icon'       => '/content/image/riot-icon.png',
            'enabled'    => true,
            'linkable'   => false, // passera à true le jour où RSO est accordé
            'verifiable' => true,  // liaison par preuve de propriété (icône)
            'searchable' => true,
            'aliases'    => ['riot', 'riot games', 'riotgames'],
        ],
        'epic' => [
            'slug'       => 'epic',
            'label'      => 'Epic Games',
            'icon'       => '/content/image/Epic_icon.webp',
            'enabled'    => false,
            'linkable'   => false,
            'verifiable' => false,
            'searchable' => false,
            'aliases'    => ['epic', 'epic games', 'epicgames'],
        ],
    ];

    return $platforms;
}

function mgs_platform(?string $slug): ?array
{
    if ($slug === null) {
        return null;
    }
    return mgs_platforms()[$slug] ?? null;
}

/**
 * Accepte "Steam", "steam", "Epic Games"... et renvoie le slug interne.
 */
function mgs_resolve_platform(?string $input): ?string
{
    $input = strtolower(trim((string)$input));

    if ($input === '') {
        return null;
    }

    foreach (mgs_platforms() as $slug => $platform) {
        if ($slug === $input || in_array($input, $platform['aliases'], true)) {
            return $slug;
        }
    }

    return null;
}

function mgs_load_provider(string $slug): bool
{
    $file = __DIR__ . '/providers/' . $slug . '.php';

    if (!is_file($file)) {
        return false;
    }

    require_once $file;
    return true;
}

function mgs_provider_supports(string $slug, string $action): bool
{
    return function_exists($slug . '_' . $action);
}

/**
 * Appelle steam_fetch_stats(), riot_fetch_stats()... selon le slug.
 */
function mgs_provider_call(string $slug, string $action, ...$args)
{
    return call_user_func_array($slug . '_' . $action, $args);
}

/** Petit helper HTTP partagé par tous les providers. */
function mgs_http_get_json(string $url): ?array
{
    $context = stream_context_create([
        'http' => ['timeout' => 8, 'ignore_errors' => true],
    ]);

    $body = @file_get_contents($url, false, $context);

    if ($body === false) {
        return null;
    }

    $data = json_decode($body, true);

    return is_array($data) ? $data : null;
}


/**
 * Comme mgs_http_get_json(), mais lance toutes les URL en parallèle.
 * @param  array<string,string> $urls  Clé => URL
 * @return array<string,?array>        Mêmes clés, décodées en tableau (ou null)
 */
function mgs_http_get_json_multi(array $urls): array
{
    if (!$urls) {
        return [];
    }

    // Repli séquentiel si l'extension curl n'est pas dispo
    if (!function_exists('curl_multi_init')) {
        $out = [];
        foreach ($urls as $cle => $url) {
            $out[$cle] = mgs_http_get_json($url);
        }
        return $out;
    }

    $multi   = curl_multi_init();
    $handles = [];

    foreach ($urls as $cle => $url) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_ENCODING       => '',   // active gzip
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
        $data = json_decode((string)curl_multi_getcontent($ch), true);
        $resultats[$cle] = is_array($data) ? $data : null;
        curl_multi_remove_handle($multi, $ch);
        curl_close($ch);
    }

    curl_multi_close($multi);

    return $resultats;
}