<?php
declare(strict_types=1);

/* ==================================================================
 *  php/core/http.php — sorties HTTP normalisées.
 *
 *  Avant : chaque endpoint redéfinissait sa propre fonction d'erreur
 *  (mgs_json_error, mgs_games_error, mgs_games_public_error,
 *  mgs_matches_error, mgs_verify_error…) avec le même corps à un mot
 *  près. Elles sont toutes remplacées par mgs_fail() / mgs_json().
 * ================================================================== */

/** Drapeaux json_encode utilisés partout : accents lisibles, / non échappés. */
const MGS_JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;

/**
 * Déclare la réponse comme du JSON. À appeler avant toute écriture.
 *
 * @param int|null $cacheSeconds Cache navigateur privé, null = aucun.
 */
function mgs_json_header(?int $cacheSeconds = null): void
{
    // Signale au gestionnaire d'erreur fatale de bootstrap.php qu'il doit
    // répondre en JSON, pas en HTML.
    if (!defined('MGS_REPONSE_JSON')) {
        define('MGS_REPONSE_JSON', true);
    }

    header('Content-Type: application/json; charset=utf-8');

    if ($cacheSeconds !== null) {
        header('Cache-Control: private, max-age=' . max(0, $cacheSeconds));
    }
}

/**
 * Encode en JSON en garantissant qu'un corps exploitable part toujours.
 *
 * json_encode() renvoie false au moindre octet non-UTF8 (des pseudos de
 * joueurs en sont pleins) et « echo false » n'écrit rien : le client
 * recevait alors un corps vide avec un code 200 et affichait un message
 * de repli trompeur.
 */
function mgs_json_encode(mixed $payload): string
{
    $json = json_encode($payload, MGS_JSON_FLAGS);

    if ($json === false) {
        // 2e chance : on remplace les octets invalides au lieu d'échouer.
        $json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    }

    if ($json === false) {
        $json = '{"error":"Réponse illisible côté serveur ('
              . addslashes(json_last_error_msg()) . ')."}';
    }

    return $json;
}

/** Écrit une réponse JSON et termine le script. */
function mgs_json(mixed $payload, int $status = 200): never
{
    if ($status !== 200) {
        http_response_code($status);
    }

    echo mgs_json_encode($payload);
    exit;
}

/**
 * Erreur JSON standard : { "error": "..." }.
 * Remplace les 6 variantes locales qui existaient une par endpoint.
 */
function mgs_fail(int $status, string $message, array $extra = []): never
{
    mgs_json(['error' => $message] + $extra, $status);
}

/** Redirection + arrêt. */
function mgs_redirect(string $url): never
{
    header('Location: ' . $url);
    exit;
}

/** Refuse tout ce qui n'est pas la méthode attendue (réponse JSON). */
function mgs_require_method(string $method): void
{
    if (strtoupper($_SERVER['REQUEST_METHOD'] ?? '') !== strtoupper($method)) {
        mgs_fail(405, 'Méthode non autorisée.');
    }
}
