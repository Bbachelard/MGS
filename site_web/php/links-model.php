<?php
declare(strict_types=1);

require_once __DIR__ . '/platforms.php';

/* ==================================================================
 *  Modèle des comptes de plateforme liés.
 *
 *  Un utilisateur peut lier plusieurs comptes sur une même plateforme,
 *  dans la limite de mgs_max_accounts($slug).
 *
 *  Invariants tenus ici :
 *    - un compte de plateforme n'appartient qu'à un seul user MGS
 *      (index uq_platform_account en base)
 *    - exactement un compte principal par (user, plateforme) dès qu'il
 *      y en a au moins un
 * ================================================================== */

/**
 * Tous les comptes d'un utilisateur, groupés par plateforme.
 * Le compte principal est toujours en tête de sa liste.
 *
 * @return array<string, list<array{id:int, accountId:string, isPrimary:bool, linkedAt:?string}>>
 */
function mgs_get_user_accounts(mysqli $conn, int $userId): array
{
    $comptes = [];
    foreach (array_keys(mgs_platforms()) as $slug) {
        $comptes[$slug] = [];
    }

    $stmt = $conn->prepare(
        'SELECT id, platform, platform_user_id, is_primary, linked_at
           FROM platform_links
          WHERE user_id = ?
       ORDER BY is_primary DESC, id ASC'
    );
    $stmt->bind_param('i', $userId);
    $stmt->execute();
    $result = $stmt->get_result();

    while ($row = $result->fetch_assoc()) {
        // Une plateforme retirée du registre laisse des lignes orphelines :
        // on les ignore au lieu de planter.
        if (!array_key_exists($row['platform'], $comptes)) {
            continue;
        }

        $comptes[$row['platform']][] = [
            'id'        => (int)$row['id'],
            'accountId' => (string)$row['platform_user_id'],
            'isPrimary' => (bool)(int)$row['is_primary'],
            'linkedAt'  => $row['linked_at'],
        ];
    }
    $stmt->close();

    return $comptes;
}

/** Nombre de comptes déjà liés sur une plateforme. */
function mgs_count_accounts(mysqli $conn, int $userId, string $platform): int
{
    $stmt = $conn->prepare(
        'SELECT COUNT(*) AS n FROM platform_links WHERE user_id = ? AND platform = ?'
    );
    $stmt->bind_param('is', $userId, $platform);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    return (int)($row['n'] ?? 0);
}

/**
 * accountId du compte principal, ou null si aucun compte lié.
 * Le tri de repli sur id couvre le cas d'une base incohérente
 * (aucune ligne marquée principale).
 */
function mgs_get_primary_account(mysqli $conn, int $userId, string $platform): ?string
{
    $stmt = $conn->prepare(
        'SELECT platform_user_id
           FROM platform_links
          WHERE user_id = ? AND platform = ?
       ORDER BY is_primary DESC, id ASC
          LIMIT 1'
    );
    $stmt->bind_param('is', $userId, $platform);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    return $row['platform_user_id'] ?? null;
}

/** Ce compte fait-il partie du profil de cet utilisateur ? */
function mgs_user_owns_account(mysqli $conn, int $userId, string $platform, string $accountId): bool
{
    $stmt = $conn->prepare(
        'SELECT 1 FROM platform_links
          WHERE user_id = ? AND platform = ? AND platform_user_id = ?
          LIMIT 1'
    );
    $stmt->bind_param('iss', $userId, $platform, $accountId);
    $stmt->execute();
    $trouve = $stmt->get_result()->fetch_assoc() !== null;
    $stmt->close();

    return $trouve;
}

/** Renvoie l'id du user MGS qui possède déjà ce compte, ou null. */
function mgs_get_link_owner(mysqli $conn, string $platform, string $accountId): ?int
{
    $stmt = $conn->prepare(
        'SELECT user_id FROM platform_links WHERE platform = ? AND platform_user_id = ?'
    );
    $stmt->bind_param('ss', $platform, $accountId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    return isset($row['user_id']) ? (int)$row['user_id'] : null;
}

/**
 * Ajoute un compte au profil. Ne remplace JAMAIS un compte existant :
 * précisément ce qu'on veut supprimer.
 *
 * @return array{ok:bool, code?:string, error?:string, id?:int, isPrimary?:bool}
 */
function mgs_add_link(mysqli $conn, int $userId, string $platform, string $accountId): array
{
    $info = mgs_platform($platform);

    if ($info === null) {
        return ['ok' => false, 'code' => 'platform', 'error' => 'Plateforme inconnue.'];
    }

    if ($accountId === '') {
        return ['ok' => false, 'code' => 'account', 'error' => 'Identifiant de compte vide.'];
    }

    if (mgs_user_owns_account($conn, $userId, $platform, $accountId)) {
        return [
            'ok'    => false,
            'code'  => 'deja_present',
            'error' => 'Ce compte ' . $info['label'] . ' est déjà dans ton profil.',
        ];
    }

    if (mgs_get_link_owner($conn, $platform, $accountId) !== null) {
        return [
            'ok'    => false,
            'code'  => 'deja_lie',
            'error' => 'Ce compte ' . $info['label'] . ' est déjà lié à un autre compte MGS.',
        ];
    }

    $max     = mgs_max_accounts($platform);
    $actuels = mgs_count_accounts($conn, $userId, $platform);

    if ($actuels >= $max) {
        return [
            'ok'    => false,
            'code'  => 'max',
            'error' => $max === 1
                ? 'Tu as déjà un compte ' . $info['label'] . ' lié. Délie-le avant d\'en ajouter un autre.'
                : 'Limite atteinte : ' . $max . ' comptes ' . $info['label'] . ' maximum.',
        ];
    }

    // Le premier compte de la plateforme devient principal d'office.
    $isPrimary = $actuels === 0 ? 1 : 0;

    try {
        $stmt = $conn->prepare(
            'INSERT INTO platform_links (user_id, platform, platform_user_id, is_primary)
             VALUES (?, ?, ?, ?)'
        );
        $stmt->bind_param('issi', $userId, $platform, $accountId, $isPrimary);
        $ok = $stmt->execute();
        $id = (int)$conn->insert_id;
        $stmt->close();
    } catch (mysqli_sql_exception $e) {
        if ((int)$e->getCode() === 1062) {
            // Deux index uniques peuvent déclencher un 1062, et ils n'ont
            // pas du tout le même sens. On distingue sur le message MySQL.
            if (str_contains($e->getMessage(), 'uq_user_platform')) {
                return [
                    'ok'    => false,
                    'code'  => 'migration',
                    'error' => 'Migration incomplète : l\'index uq_user_platform est toujours '
                               . 'présent sur platform_links, il interdit le multi-comptes.',
                ];
            }

            return [
                'ok'    => false,
                'code'  => 'deja_lie',
                'error' => 'Ce compte ' . $info['label'] . ' vient d\'être lié ailleurs.',
            ];
        }

        error_log('mgs_add_link: ' . $e->getMessage());
        return ['ok' => false, 'code' => 'sql', 'error' => 'Enregistrement impossible, réessaie.'];
    }

    if (!$ok) {
        return ['ok' => false, 'code' => 'sql', 'error' => 'Enregistrement impossible, réessaie.'];
    }

    return ['ok' => true, 'id' => $id, 'isPrimary' => $isPrimary === 1];
}

/**
 * Supprime un compte par son id de liaison.
 *
 * Le user_id est dans le WHERE : un id qui ne t'appartient pas ne
 * supprime rien, inutile de contrôler la propriété en amont.
 *
 * Si le compte supprimé était le principal, le plus ancien restant
 * prend sa place — sinon la plateforme se retrouverait sans principal.
 *
 * @return array{ok:bool, error?:string, platform?:string}
 */
function mgs_delete_link(mysqli $conn, int $userId, int $linkId): array
{
    $stmt = $conn->prepare(
        'SELECT platform, is_primary FROM platform_links WHERE id = ? AND user_id = ? LIMIT 1'
    );
    $stmt->bind_param('ii', $linkId, $userId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if ($row === null) {
        return ['ok' => false, 'error' => 'Compte introuvable.'];
    }

    $platform  = (string)$row['platform'];
    $etaitPrin = (bool)(int)$row['is_primary'];

    $stmt = $conn->prepare('DELETE FROM platform_links WHERE id = ? AND user_id = ?');
    $stmt->bind_param('ii', $linkId, $userId);
    $ok = $stmt->execute();
    $stmt->close();

    if (!$ok) {
        return ['ok' => false, 'error' => 'Suppression impossible, réessaie.'];
    }

    if ($etaitPrin) {
        $stmt = $conn->prepare(
            'UPDATE platform_links SET is_primary = 1
              WHERE user_id = ? AND platform = ?
           ORDER BY id ASC
              LIMIT 1'
        );
        $stmt->bind_param('is', $userId, $platform);
        $stmt->execute();
        $stmt->close();
    }

    return ['ok' => true, 'platform' => $platform];
}

/**
 * Désigne un compte comme principal. L'ancien principal de la même
 * plateforme est démis dans la même transaction : sans ça, un plantage
 * entre les deux requêtes laisserait deux principaux (ou zéro).
 *
 * @return array{ok:bool, error?:string, platform?:string}
 */
function mgs_set_primary(mysqli $conn, int $userId, int $linkId): array
{
    $stmt = $conn->prepare(
        'SELECT platform FROM platform_links WHERE id = ? AND user_id = ? LIMIT 1'
    );
    $stmt->bind_param('ii', $linkId, $userId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if ($row === null) {
        return ['ok' => false, 'error' => 'Compte introuvable.'];
    }

    $platform = (string)$row['platform'];

    $conn->begin_transaction();

    try {
        $stmt = $conn->prepare(
            'UPDATE platform_links SET is_primary = 0 WHERE user_id = ? AND platform = ?'
        );
        $stmt->bind_param('is', $userId, $platform);
        $stmt->execute();
        $stmt->close();

        $stmt = $conn->prepare(
            'UPDATE platform_links SET is_primary = 1 WHERE id = ? AND user_id = ?'
        );
        $stmt->bind_param('ii', $linkId, $userId);
        $stmt->execute();
        $stmt->close();

        $conn->commit();
    } catch (mysqli_sql_exception $e) {
        $conn->rollback();
        return ['ok' => false, 'error' => 'Modification impossible, réessaie.'];
    }

    return ['ok' => true, 'platform' => $platform];
}