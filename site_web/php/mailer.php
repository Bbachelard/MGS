<?php
declare(strict_types=1);

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../smtp-config.php';

use PHPMailer\PHPMailer\PHPMailer;

/**
 * Envoie l'email de réinitialisation de mot de passe.
 * Lance une exception PHPMailer en cas d'échec (à catcher par l'appelant).
 */
function mgs_send_password_reset_email(string $toEmail, string $toUsername, string $resetLink): void
{
    global $smtp_host, $smtp_port, $smtp_username, $smtp_password, $smtp_encryption, $smtp_from_email, $smtp_from_name;

    $mail = new PHPMailer(true);

    $mail->isSMTP();
    $mail->Host       = $smtp_host;
    $mail->Port       = $smtp_port;
    $mail->SMTPAuth   = true;
    $mail->Username   = $smtp_username;
    $mail->Password   = $smtp_password;
    $mail->SMTPSecure = $smtp_encryption;
    $mail->CharSet    = 'UTF-8';

    $mail->setFrom($smtp_from_email, $smtp_from_name);
    $mail->addAddress($toEmail, $toUsername);

    $mail->isHTML(true);
    $mail->Subject = 'Réinitialisation de ton mot de passe — My Gamers Stats';

    $safeUsername = htmlspecialchars($toUsername, ENT_QUOTES, 'UTF-8');
    $safeLink     = htmlspecialchars($resetLink, ENT_QUOTES, 'UTF-8');

    $mail->Body = <<<HTML
    <div style="font-family: Arial, sans-serif; background:#1f1f1f; color:#fff; padding:24px;">
        <div style="max-width:480px;margin:0 auto;background:#2a2a33;border-radius:12px;padding:28px;">
            <h2 style="color:#7c5cff;margin-top:0;">My Gamers Stats</h2>
            <p>Bonjour {$safeUsername},</p>
            <p>Tu as demandé la réinitialisation de ton mot de passe. Ce lien est valable 1 heure.</p>
            <p style="text-align:center;margin:28px 0;">
                <a href="{$safeLink}" style="background:#7c5cff;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;display:inline-block;">
                    Réinitialiser mon mot de passe
                </a>
            </p>
            <p style="font-size:12px;color:#999;">Si tu n'es pas à l'origine de cette demande, ignore cet email : ton mot de passe restera inchangé.</p>
        </div>
    </div>
    HTML;

    $mail->AltBody = "Bonjour {$toUsername},\n\nPour réinitialiser ton mot de passe (valable 1 heure) :\n{$resetLink}\n\nSi tu n'es pas à l'origine de cette demande, ignore cet email.";

    $mail->send();
}