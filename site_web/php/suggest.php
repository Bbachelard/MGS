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
 * Ne renvoie que des comptes volontairement liés par des utilisateurs du
 * site. Aucune donnée privée : pseudo public de la plateforme + nom du
 * compte MGS, tous deux déjà visibles dans la recherche d'amis.
 */

require_once __DIR__ . '/core/bootstrap.php';
require_once __DIR__ . '/suggest-model.php';

/** Nombre de suggestions renvoyées. */
const MGS_SUGGEST_LIMITE = 8;

/** En dessous, la liste n'a aucune valeur et la requête ramènerait la
 *  moitié de l'index. */
const MGS_SUGGEST_MIN = 2;

/** Longueur maximale de la saisie prise en compte. */
const MGS_SUGGEST_MAX = 64;

// L'autocomplétion est appelée à chaque frappe : un cache court côté
// navigateur évite de marteler MySQL sur un aller-retour.
mgs_json_header(30);

/** Sortie vide mais valide : le front n'a jamais à gérer d'erreur ici. */
function mgs_suggest_vide(string $platform = ''): never
{
    mgs_json(['platform' => $platform, 'results' => []]);
}

$slug = mgs_resolve_platform($_GET['platform'] ?? '');

if ($slug === null) {
    mgs_suggest_vide();
}

$query = trim((string) ($_GET['q'] ?? ''));

if (mb_strlen($query) < MGS_SUGGEST_MIN) {
    mgs_suggest_vide($slug);
}

$query = mb_substr($query, 0, MGS_SUGGEST_MAX);

if (!isset($conn) || !($conn instanceof mysqli)) {
    mgs_suggest_vide($slug);
}

mgs_json([
    'platform' => $slug,
    'results'  => mgs_suggest_accounts($conn, $slug, $query, MGS_SUGGEST_LIMITE),
]);
