<?php
declare(strict_types=1);

/* ==================================================================
 *  php/core/auth.php — contrôle de session, en un seul endroit.
 *
 *  Le site testait la connexion de DEUX façons différentes selon les
 *  fichiers :
 *      isset($_SESSION['user_id'])                      (endpoints JSON)
 *      $_SESSION['logged'] === true                     (pages HTML)
 *
 *  Ce n'est pas équivalent : disconnect.php remettait 'logged' à false
 *  sans vider 'user_id', si bien qu'un utilisateur déconnecté passait
 *  encore tous les contrôles des endpoints JSON. mgs_user_id() exige
 *  désormais LES DEUX conditions, et disconnect.php détruit la session.
 * ================================================================== */

/** Démarre la session si elle ne l'est pas déjà (idempotent). */
function mgs_session_start(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }
}

/** Id de l'utilisateur connecté, ou null. Aucune redirection. */
function mgs_user_id(): ?int
{
    if (($_SESSION['logged'] ?? false) !== true) {
        return null;
    }

    $id = (int) ($_SESSION['user_id'] ?? 0);

    return $id > 0 ? $id : null;
}

function mgs_is_logged(): bool
{
    return mgs_user_id() !== null;
}

/**
 * Garde pour un endpoint JSON : 401 si non connecté.
 * @return int l'id de l'utilisateur, garanti > 0
 */
function mgs_require_login(): int
{
    $id = mgs_user_id();

    if ($id === null) {
        mgs_fail(401, 'Session expirée, reconnecte-toi.');
    }

    return $id;
}

/**
 * Garde pour une page HTML : redirige vers la connexion si non connecté.
 * @return int l'id de l'utilisateur, garanti > 0
 */
function mgs_require_login_page(string $retour = '../connexion/index.php'): int
{
    $id = mgs_user_id();

    if ($id === null) {
        mgs_redirect($retour);
    }

    return $id;
}

/** Pseudo de l'utilisateur connecté (chaîne vide si inconnu). */
function mgs_username(): string
{
    return (string) ($_SESSION['username'] ?? '');
}

/**
 * Ouvre une session applicative après une authentification réussie.
 * L'id est régénéré : sans ça, un identifiant de session obtenu avant
 * la connexion resterait valide après (fixation de session).
 */
function mgs_login(int $userId, string $username): void
{
    mgs_session_start();
    session_regenerate_id(true);

    $_SESSION['logged']   = true;
    $_SESSION['user_id']  = $userId;
    $_SESSION['username'] = $username;
}

/**
 * Ferme la session pour de bon : contenu vidé, cookie expiré, session
 * détruite côté serveur. Remettre un simple drapeau à false ne suffit
 * pas — tout le reste de $_SESSION survivait.
 */
function mgs_logout(): void
{
    mgs_session_start();

    $_SESSION = [];

    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            [
                'expires'  => time() - 42000,
                'path'     => $p['path'],
                'domain'   => $p['domain'],
                'secure'   => $p['secure'],
                'httponly' => $p['httponly'],
                'samesite' => $p['samesite'] ?? 'Lax',
            ]
        );
    }

    session_destroy();
}
