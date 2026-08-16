<?php
declare(strict_types=1);

/**
 * smtp-config.example.php — modèle de configuration SMTP.
 *
 * Copier en smtp-config.php et remplir. smtp-config.php est dans
 * .gitignore : il contient le mot de passe du compte d'envoi.
 *
 * Utilisé par php/mailer.php (email de réinitialisation de mot de passe).
 */

$smtp_host       = 'smtp.exemple.fr';
$smtp_port       = 587;
$smtp_username   = 'no-reply@my-gamers-stats.com';
$smtp_password   = 'MOT_DE_PASSE_SMTP';
$smtp_encryption = 'tls';        // 'tls' (587) ou 'ssl' (465)
$smtp_from_email = 'no-reply@my-gamers-stats.com';
$smtp_from_name  = 'My Gamers Stats';
