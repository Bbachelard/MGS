<?php
declare(strict_types=1);

/**
 * php/suggest.php — autocomplétion de pseudos pour la recherche d'accueil.
 *
 *   GET /php/suggest.php?platform=steam&q=bla
 *
 * Réponse :
 *   { "platform": "steam", "results": [ {accountId, label, owner, platform}, … ] }
 *
 * Fonctionne pour les 3 plateformes, y compris celles dont la recherche
 * par pseudo est impossible côté API (Epic, et Riot sans le tag) : la
 * suggestion porte l'accountId, donc api.php n'a plus rien à résoudre.
 *
 * Ne renvoie que des comptes volontairement liés par des utilisateurs
 * du site. Aucune donnée privée : pseudo public de la plateforme +
 * nom du compte MGS, tous deux déjà visibles dans la recherche d'amis.
 */

require_once __DIR__ . '/platforms.php';
require_once __DIR__ . '/suggest-model.php';

header('Content-Type: application/json; charset=utf-8');

// L'autocomplétion est appelée à chaque frappe : un cache court côté
// navigateur évite de marteler MySQL sur un aller-retour.
header('Cache-Control: private, max-age=30');

$config = require __DIR__ . '/../config.php';

/** Sortie vide mais valide : le front n'a jamais à gérer d'erreur ici. */
function mgs_suggest_vide(string $platform = ''): never
{
    echo json_encode(['platform' => $platform, 'results' => []], JSON_UNESCAPED_UNICODE);
    exit;
}

$slug = mgs_resolve_platform($_GET['platform'] ?? '');

if ($slug === null) {
    mgs_suggest_vide();
}

$query = trim((string)($_GET['q'] ?? ''));

// 2 caractères minimum : en dessous, la liste n'a aucune valeur et
// la requête ramènerait la moitié de l'index.
if (function_exists('mb_strlen') ? mb_strlen($query) < 2 : strlen($query) < 2) {
    mgs_suggest_vide($slug);
}

if (function_exists('mb_substr')) {
    $query = mb_substr($query, 0, 64);
}

if (!isset($conn) || !($conn instanceof mysqli)) {
    mgs_suggest_vide($slug);
}

echo json_encode([
    'platform' => $slug,
    'results'  => mgs_suggest_accounts($conn, $slug, $query, 8),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
