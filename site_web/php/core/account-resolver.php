<?php
declare(strict_types=1);

require_once __DIR__ . '/http.php';
require_once dirname(__DIR__) . '/platforms.php';

/* ==================================================================
 *  php/core/account-resolver.php
 *
 *  Le même enchaînement « je valide la plateforme, puis je récupère un
 *  accountId soit directement soit en résolvant un pseudo » était
 *  recopié à l'identique dans api.php, matches.php et games-public.php.
 *  Trois copies, trois occasions de diverger sur un contrôle de sécurité.
 * ================================================================== */

/**
 * Valide ?platform= et vérifie que le provider sait faire $action.
 *
 * @param  string $action  ex. 'fetch_stats', 'fetch_games', 'fetch_matches'
 * @return array{0:string, 1:array}  [slug, définition de la plateforme]
 */
function mgs_require_platform(?string $entree, string $action, string $indispo): array
{
    $slug = mgs_resolve_platform($entree ?? '');

    if ($slug === null) {
        mgs_fail(400, 'Plateforme inconnue.');
    }

    $platform = mgs_platform($slug);

    if (!$platform['enabled']
        || !mgs_load_provider($slug)
        || !mgs_provider_supports($slug, $action)) {
        mgs_fail(501, $indispo . ' indisponible pour ' . $platform['label'] . '.');
    }

    return [$slug, $platform];
}

/**
 * Résolution PUBLIQUE d'un compte : accountId fourni tel quel, sinon
 * pseudo résolu auprès du provider.
 *
 * À n'utiliser que pour les vues publiques (accueil). Pour un profil
 * connecté, l'accountId doit venir de la base — cf.
 * mgs_resolve_owned_account() — sinon n'importe qui ferait scanner le
 * compte d'un tiers avec notre clé d'API.
 */
function mgs_resolve_public_account(string $slug, array $platform, string $manquant = 'Merci de saisir un pseudo.'): string
{
    $accountId = trim((string) ($_GET['accountId'] ?? $_GET['steamid'] ?? ''));
    $pseudo    = trim((string) ($_GET['pseudo'] ?? ''));

    if ($accountId !== '') {
        return $accountId;
    }

    if ($pseudo === '') {
        mgs_fail(400, $manquant);
    }

    if (!$platform['searchable'] || !mgs_provider_supports($slug, 'resolve_account_id')) {
        mgs_fail(501, "La recherche par pseudo n'est pas disponible pour " . $platform['label'] . '.');
    }

    $resolved = mgs_provider_call($slug, 'resolve_account_id', mgs_platform_config($slug), $pseudo);

    if (!$resolved['ok']) {
        mgs_fail($resolved['status'] ?? 404, $resolved['error']);
    }

    return (string) $resolved['accountId'];
}

/**
 * Résolution AUTHENTIFIÉE : l'accountId éventuellement transmis par le
 * client est systématiquement recoupé avec platform_links. Sans
 * paramètre, on retombe sur le compte principal du profil.
 */
function mgs_resolve_owned_account(mysqli $conn, int $userId, string $slug, array $platform): string
{
    require_once dirname(__DIR__) . '/links-model.php';

    $accountId = trim((string) ($_GET['accountId'] ?? ''));

    if ($accountId !== '') {
        if (!mgs_user_owns_account($conn, $userId, $slug, $accountId)) {
            mgs_fail(403, 'Ce compte ne fait pas partie de ce profil.');
        }

        return $accountId;
    }

    $accountId = mgs_get_primary_account($conn, $userId, $slug);

    if ($accountId === null || $accountId === '') {
        mgs_fail(404, 'Aucun compte ' . $platform['label'] . ' lié.');
    }

    return $accountId;
}
