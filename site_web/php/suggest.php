<?php
declare(strict_types=1);

require_once __DIR__ . '/platforms.php';

/* ==================================================================
 *  Index de suggestions de pseudos.
 *
 *  Source unique : les comptes déjà liés par les utilisateurs du site.
 *  Aucune API externe n'expose de recherche par pseudo (ni Steam, ni
 *  Riot, ni Epic) — l'index maison est donc le seul moyen honnête de
 *  proposer des complétions.
 *
 *  Il se remplit tout seul : à chaque affichage de carte réussi,
 *  api.php mémorise le pseudo renvoyé par le provider.
 * ================================================================== */

/** Rafraîchit le pseudo mémorisé au plus une fois par semaine. */
const MGS_DISPLAY_NAME_TTL = 604800;

/**
 * Mémorise le pseudo affiché d'un compte lié.
 *
 * N'insère jamais : le WHERE ne touche que des lignes existantes de
 * platform_links. Un compte cherché anonymement depuis l'accueil
 * n'entre donc pas dans l'index — c'est voulu, on n'indexe que ce que
 * des utilisateurs ont volontairement rattaché à leur profil.
 *
 * Silencieux par construction : si la migration SQL n'est pas encore
 * passée, la colonne n'existe pas et on ne veut surtout pas faire
 * tomber l'affichage des stats pour ça.
 */
function mgs_remember_display_name(mysqli $conn, string $platform, string $accountId, ?string $name): void
{
    $name = trim((string)$name);

    if ($name === '' || $accountId === '' || $name === $accountId) {
        return;
    }

    if (function_exists('mb_substr')) {
        $name = mb_substr($name, 0, 191);
    }

    try {
        $stmt = $conn->prepare(
            'UPDATE platform_links
                SET display_name = ?, display_name_at = NOW()
              WHERE platform = ?
                AND platform_user_id = ?
                AND (display_name IS NULL
                     OR display_name <> ?
                     OR display_name_at IS NULL
                     OR display_name_at < (NOW() - INTERVAL ? SECOND))
              LIMIT 1'
        );

        if ($stmt === false) {
            return;
        }

        $ttl = MGS_DISPLAY_NAME_TTL;
        $stmt->bind_param('ssssi', $name, $platform, $accountId, $name, $ttl);
        $stmt->execute();
        $stmt->close();
    } catch (mysqli_sql_exception $e) {
        // Colonne absente (migration non jouée) : on ignore.
        error_log('mgs_remember_display_name: ' . $e->getMessage());
    }
}

/**
 * Échappe les jokers d'un LIKE. Sans ça, un joueur qui tape « % »
 * ramène l'index entier.
 */
function mgs_like_escape(string $valeur): string
{
    return str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $valeur);
}

/**
 * Cherche des comptes liés dont le pseudo (ou le nom du compte MGS
 * propriétaire) contient la saisie.
 *
 * @return list<array{accountId:string, label:string, owner:string, platform:string}>
 */
function mgs_suggest_accounts(mysqli $conn, string $platform, string $query, int $limit = 8): array
{
    $query = trim($query);

    if (strlen($query) < 2) {
        return [];
    }

    $esc     = mgs_like_escape($query);
    $contient = '%' . $esc . '%';
    $commence = $esc . '%';
    $limit    = max(1, min($limit, 20));

    $sql = "SELECT pl.platform_user_id AS account_id,
                   COALESCE(NULLIF(pl.display_name, ''), u.username) AS label,
                   u.username AS owner
              FROM platform_links pl
              INNER JOIN users u ON u.id = pl.user_id
             WHERE pl.platform = ?
               AND (pl.display_name LIKE ? ESCAPE '!'
                    OR u.username   LIKE ? ESCAPE '!')
          ORDER BY (COALESCE(NULLIF(pl.display_name, ''), u.username) LIKE ? ESCAPE '!') DESC,
                   pl.is_primary DESC,
                   CHAR_LENGTH(COALESCE(NULLIF(pl.display_name, ''), u.username)) ASC
             LIMIT ?";

    try {
        $stmt = $conn->prepare($sql);

        if ($stmt === false) {
            return [];
        }

        $stmt->bind_param('ssssi', $platform, $contient, $contient, $commence, $limit);
        $stmt->execute();
        $result = $stmt->get_result();

        $suggestions = [];

        while ($row = $result->fetch_assoc()) {
            $suggestions[] = [
                'accountId' => (string)$row['account_id'],
                'label'     => (string)$row['label'],
                'owner'     => (string)$row['owner'],
                'platform'  => $platform,
            ];
        }

        $stmt->close();

        return $suggestions;
    } catch (mysqli_sql_exception $e) {
        error_log('mgs_suggest_accounts: ' . $e->getMessage());
        return [];
    }
}
