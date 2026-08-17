<?php
declare(strict_types=1);

/* ==================================================================
 *  php/views/head.php — <head> commun aux pages HTML.
 *
 *  Les 7 pages avaient chacune leur propre <head>, avec des versions
 *  de cache différentes sur les mêmes feuilles de style (?v=1 ici,
 *  ?v=6 là) et, sur deux d'entre elles, ni charset, ni lang, ni
 *  viewport. MGS_ASSET_VERSION centralise le cache-busting : une seule
 *  valeur à incrémenter après un déploiement.
 * ================================================================== */

/** À incrémenter à chaque mise en production touchant le CSS ou le JS. */
const MGS_ASSET_VERSION = '12';

/** Ajoute le numéro de version à une URL d'asset. */
function mgs_asset(string $chemin): string
{
    return $chemin . '?v=' . MGS_ASSET_VERSION;
}

/**
 * Écrit le <head> complet.
 *
 * @param string       $titre    Titre de la page (échappé ici).
 * @param list<string> $styles   Feuilles à charger, relatives à la racine du site.
 * @param string       $base     Préfixe de chemin ('..' depuis un sous-dossier).
 */
function mgs_head(string $titre, array $styles = [], string $base = '..'): void
{
    $base = rtrim($base, '/');

    $styles = $styles ?: [
        '/content/css/stylesheet.css',
        '/content/css/styleLogin.css',
        '/content/css/ajouts-stats.css',
    ];
    ?>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title><?= htmlspecialchars($titre, ENT_QUOTES, 'UTF-8') ?> — My Gamers Stats</title>
    <link rel="icon" type="image/x-icon" href="/favicon.ico">
<?php foreach ($styles as $style): ?>
    <link rel="stylesheet" href="<?= htmlspecialchars($base . mgs_asset($style), ENT_QUOTES, 'UTF-8') ?>">
<?php endforeach; ?>
</head>
<?php
}
