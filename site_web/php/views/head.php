<?php
declare(strict_types=1);

/* ==================================================================
 *  php/views/head.php — <head> commun aux pages HTML.
 *
 *  Les 7 pages avaient chacune leur propre <head>, avec des versions
 *  de cache différentes sur les mêmes feuilles de style (?v=1 ici,
 *  ?v=6 là) et, sur deux d'entre elles, ni charset, ni lang, ni
 *  viewport. MGS_ASSET_VERSION centralise le cache-busting.
 *
 *  ATTENTION : cette constante ne versionne que les URL écrites par
 *  mgs_asset(), c'est-à-dire les 4 feuilles racines et les scripts.
 *  Les modules de content/css/modules/ sont tirés par des @import
 *  DEPUIS ces feuilles : un @import sans « ?v= » est servi depuis le
 *  cache du navigateur indéfiniment, même après incrémentation.
 *  Un correctif CSS pouvait donc n'atteindre personne.
 *  Les @import portent maintenant le même « ?v= », écrit en dur.
 * ================================================================== */

/*
 * À incrémenter à chaque mise en production touchant le CSS ou le JS.
 *
 * Le numéro apparaît aussi, en dur, dans les @import des 4 feuilles
 * racines et dans index.html (page statique). Tout se met à jour d'un
 * coup, depuis site_web/ :
 *
 *   sed -i 's/?v=15/?v=16/g' index.html content/css/*.css
 *
 * puis la constante ci-dessous. Un contrôle rapide avant de livrer :
 *
 *   grep -c '?v=15' index.html content/css/*.css   # 0 partout
 */
const MGS_ASSET_VERSION = '15';

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
 * @param string       $robots   Directive d'indexation. Les pages servies par
 *                               mgs_head() étaient toutes privées, d'où le
 *                               « noindex » par défaut ; le catalogue de jeux,
 *                               lui, est public et passe « index, follow ».
 */
function mgs_head(
    string $titre,
    array $styles = [],
    string $base = '..',
    string $robots = 'noindex, nofollow'
): void {
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
    <meta name="robots" content="<?= htmlspecialchars($robots, ENT_QUOTES, 'UTF-8') ?>">
    <title><?= htmlspecialchars($titre, ENT_QUOTES, 'UTF-8') ?> — My Gamers Stats</title>
    <link rel="icon" type="image/x-icon" href="/favicon.ico">
<?php foreach ($styles as $style): ?>
    <link rel="stylesheet" href="<?= htmlspecialchars($base . mgs_asset($style), ENT_QUOTES, 'UTF-8') ?>">
<?php endforeach; ?>
</head>
<?php
}
