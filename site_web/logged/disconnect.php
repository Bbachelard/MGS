<?php
declare(strict_types=1);

/**
 * logged/disconnect.php — déconnexion.
 *
 * L'ancienne version se contentait de $_SESSION['logged'] = false. Le
 * reste de la session survivait, user_id compris — or tous les endpoints
 * JSON (games.php, session-status.php, unlink.php, verify.php…) ne
 * testaient QUE isset($_SESSION['user_id']). Un utilisateur « déconnecté »
 * gardait donc un accès complet à ses données via l'API.
 *
 * mgs_logout() vide la session, expire le cookie et détruit la session
 * côté serveur.
 */

require_once __DIR__ . '/../php/core/http.php';
require_once __DIR__ . '/../php/core/auth.php';

mgs_logout();
mgs_redirect('../index.html');
