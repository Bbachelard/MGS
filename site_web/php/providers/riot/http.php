<?php
declare(strict_types=1);

/* ==================================================================
 *  providers/riot/http.php — accès HTTP à l'API Riot.
 *
 *  La clé passe dans un header, jamais dans l'URL : sans ça elle finit
 *  dans les logs d'accès de tous les intermédiaires.
 * ================================================================== */

/* ------------------------------------------------------------------ */
/*  HTTP : la clé passe dans un header, pas dans l'URL                 */
/* ------------------------------------------------------------------ */
function riot_get(string $url, string $apiKey): array
{
    $context = stream_context_create([
        'http' => [
            'timeout'       => 8,
            'ignore_errors' => true,
            'header'        => "X-Riot-Token: {$apiKey}\r\nAccept: application/json\r\n",
        ],
    ]);

    $body   = @file_get_contents($url, false, $context);
    $status = 0;

    // $http_response_header est défini par file_get_contents dans ce scope
    if (isset($http_response_header[0]) && preg_match('#\s(\d{3})\s#', $http_response_header[0], $m)) {
        $status = (int)$m[1];
    }

    if ($body === false) {
        return ['status' => $status ?: 502, 'data' => null];
    }

    $data = json_decode($body, true);

    return ['status' => $status, 'data' => is_array($data) ? $data : null];
}

/** Traduit un code HTTP Riot en message affichable. */
function riot_error(int $status): array
{
    return match (true) {
        $status === 401 || $status === 403 => ['ok' => false, 'status' => 500, 'error' => 'Clé API Riot invalide ou expirée.'],
        $status === 404                    => ['ok' => false, 'status' => 404, 'error' => 'Compte Riot introuvable.'],
        $status === 429                    => ['ok' => false, 'status' => 429, 'error' => 'Trop de requêtes, réessaie dans une minute.'],
        default                            => ['ok' => false, 'status' => 502, 'error' => 'Service Riot indisponible.'],
    };
}

/**
 * Comme riot_get(), mais lance toutes les URL en parallèle.
 * Indispensable dès qu'on charge 5 ou 10 parties : en séquentiel c'est
 * 10 allers-retours de 200 ms empilés.
 *
 * @param  array<string,string> $urls  clé => URL
 * @return array<string,array{status:int, data:?array}>
 */
function riot_get_multi(array $urls, string $apiKey): array
{
    if (!$urls) {
        return [];
    }

    // Repli séquentiel si curl n'est pas compilé
    if (!function_exists('curl_multi_init')) {
        $out = [];
        foreach ($urls as $cle => $url) {
            $out[$cle] = riot_get($url, $apiKey);
        }
        return $out;
    }

    $multi   = curl_multi_init();
    $handles = [];

    foreach ($urls as $cle => $url) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => [
                'X-Riot-Token: ' . $apiKey,
                'Accept: application/json',
            ],
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_ENCODING       => '',   // gzip
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
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $data = json_decode((string)curl_multi_getcontent($ch), true);

        $resultats[$cle] = [
            'status' => $code,
            'data'   => is_array($data) ? $data : null,
        ];

        curl_multi_remove_handle($multi, $ch);
        curl_close($ch);
    }

    curl_multi_close($multi);

    return $resultats;
}
