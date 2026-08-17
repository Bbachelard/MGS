<?php
declare(strict_types=1);

/* ==================================================================
 *  php/games-mgs-model.php — le catalogue des jeux du groupe MGS.
 *
 *  Rien ici ne touche à la base de données : le catalogue est une
 *  liste écrite à la main, qu'on modifie en éditant le tableau
 *  ci-dessous. Le jour où il faudra le gérer depuis un back-office,
 *  seule mgs_group_games() changera — la page /game/ appelle cette
 *  fonction et rien d'autre.
 *
 *  ------------------------------------------------------------------
 *  POUR AJOUTER UN JEU : copier un bloc du tableau MGS_GAMES et le
 *  remplir. Les clés attendues :
 *
 *    slug        identifiant court, unique, en minuscules  (obligatoire)
 *    nom         nom affiché                                (obligatoire)
 *    type        'download' (à télécharger) | 'web' (jouable en ligne)
 *    url         lien de téléchargement, ou adresse du jeu en ligne
 *    resume      une phrase, affichée sous le titre
 *    description deux ou trois phrases, affichées dans la carte
 *    image       chemin depuis la racine du site, ou null
 *    plateformes ['Windows'], ['Navigateur'], ['Windows', 'Linux']…
 *    joueurs     'Solo', '1 à 4 joueurs', 'Multijoueur en ligne'…
 *    version     'v1.2' ou '' si sans objet
 *    poids       '180 Mo' pour un téléchargement, '' pour un jeu web
 *    statut      'disponible' | 'bientot'
 *    auteur      qui l'a fait, dans le groupe
 *
 *  Les jeux marqués 'bientot' s'affichent grisés, sans lien cliquable :
 *  on peut donc annoncer un jeu avant d'avoir l'URL définitive.
 * ================================================================== */

/**
 * Le catalogue.
 *
 * ⚠️ Les cinq entrées ci-dessous sont des EXEMPLES, là pour montrer les
 *    deux types de fiches (téléchargement / web) et les deux statuts.
 *    À remplacer par les vrais jeux du groupe.
 *
 * @return list<array<string, mixed>>
 */
function mgs_group_games(): array
{
    static $games = null;

    if ($games !== null) {
        return $games;
    }

    $games = [

        /* ---------------- EXEMPLE : jeu à télécharger ---------------- */
        [
            'slug'        => 'exemple-runner',
            'nom'         => 'MGS Runner',
            'type'        => 'download',
            'url'         => 'https://my-gamers-stats.com/downloads/mgs-runner.zip',
            'resume'      => 'Le petit runner du logo, en vrai jeu.',
            'description' => "Un runner nerveux repris de l'animation de fond du site. "
                           . "Trois niveaux, un classement local, et une bande-son maison. "
                           . "Décompresser l'archive et lancer l'exécutable, rien à installer.",
            'image'       => null,
            'plateformes' => ['Windows'],
            'joueurs'     => 'Solo',
            'version'     => 'v0.9',
            'poids'       => '46 Mo',
            'statut'      => 'disponible',
            'auteur'      => 'MGS',
        ],

        /* ------------------- EXEMPLE : jeu en ligne ------------------- */
        [
            'slug'        => 'exemple-quiz',
            'nom'         => 'Quiz MGS',
            'type'        => 'web',
            'url'         => 'https://my-gamers-stats.com/jeux/quiz/',
            'resume'      => 'Reconnais le jeu à partir de trois captures.',
            'description' => "Un quiz de culture jeu vidéo qui se joue directement dans le "
                           . "navigateur, sans installation. Une partie dure trois minutes ; "
                           . "les scores du groupe sont conservés d'une session à l'autre.",
            'image'       => null,
            'plateformes' => ['Navigateur'],
            'joueurs'     => 'Solo ou en groupe',
            'version'     => '',
            'poids'       => '',
            'statut'      => 'disponible',
            'auteur'      => 'MGS',
        ],

        /* ------------- EXEMPLE : jeu en ligne, multijoueur ------------- */
        [
            'slug'        => 'arene',
            'nom'         => 'Arène MGS',
            'type'        => 'web',
            'url'         => '/game/arene/',
            'resume'      => 'Une arène 2D où tout le monde bouge en même temps.',
            'description' => "Prototype multijoueur temps réel : on se déplace, on se "
                           . "bouscule, on glisse le long des murs. Serveur autoritaire, "
                           . "prédiction côté client et interpolation — les techniques de "
                           . "Quake III, en 500 lignes. Rien à installer.",
            'image'       => null,
            'plateformes' => ['Navigateur'],
            'joueurs'     => 'Multijoueur en ligne',
            'version'     => 'v0.1',
            'poids'       => '',
            'statut'      => 'disponible',
            'auteur'      => 'MGS',
        ],

        /* ---------- EXEMPLE : téléchargement, pas encore sorti ---------- */
        [
            'slug'        => 'exemple-dungeon',
            'nom'         => 'MGS Dungeon',
            'type'        => 'download',
            'url'         => '',
            'resume'      => 'Un rogue-like coopératif, en chantier.',
            'description' => "Exploration de donjons générés, jusqu'à quatre joueurs en "
                           . "réseau local. Le lien de téléchargement apparaîtra ici à la "
                           . "sortie de la première version jouable.",
            'image'       => null,
            'plateformes' => ['Windows', 'Linux'],
            'joueurs'     => "1 à 4 joueurs",
            'version'     => '',
            'poids'       => '',
            'statut'      => 'bientot',
            'auteur'      => 'MGS',
        ],
    ];

    // Chaque fiche est complétée : la page n'a jamais à tester l'absence
    // d'une clé, et un oubli dans le tableau ci-dessus ne provoque pas
    // de notice PHP au milieu du HTML.
    foreach ($games as $i => $game) {
        $games[$i] = mgs_game_normalise($game);
    }

    return $games;
}

/** Valeurs par défaut d'une fiche, pour que la vue n'ait rien à deviner. */
function mgs_game_normalise(array $game): array
{
    $defauts = [
        'slug'        => '',
        'nom'         => 'Sans titre',
        'type'        => 'download',
        'url'         => '',
        'resume'      => '',
        'description' => '',
        'image'       => null,
        'plateformes' => [],
        'joueurs'     => '',
        'version'     => '',
        'poids'       => '',
        'statut'      => 'disponible',
        'auteur'      => 'MGS',
    ];

    $game = array_merge($defauts, $game);

    $game['type']        = $game['type'] === 'web' ? 'web' : 'download';
    $game['statut']      = $game['statut'] === 'bientot' ? 'bientot' : 'disponible';
    $game['plateformes'] = array_values(array_filter((array) $game['plateformes']));
    $game['url']         = mgs_game_url($game['url']);

    // Pas d'URL = rien à cliquer, quel que soit le statut écrit à la main.
    if ($game['url'] === '') {
        $game['statut'] = 'bientot';
    }

    return $game;
}

/**
 * Ne laisse passer qu'une URL http(s) ou un chemin interne.
 *
 * Le catalogue est édité à la main dans un fichier PHP : une faute de
 * frappe qui produirait « javascript:… » dans un href serait une faille
 * ouverte sur toutes les pages. On filtre au lieu de faire confiance.
 */
function mgs_game_url(mixed $url): string
{
    $url = trim((string) $url);

    if ($url === '') {
        return '';
    }

    if (str_starts_with($url, '/')) {
        return $url;                       // chemin interne au site
    }

    $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));

    return in_array($scheme, ['http', 'https'], true) ? $url : '';
}

/** Libellé du type, pour la pastille de la carte. */
function mgs_game_type_label(string $type): string
{
    return $type === 'web' ? 'Jouable en ligne' : 'À télécharger';
}

/** Libellé du bouton d'action. */
function mgs_game_action_label(array $game): string
{
    if ($game['statut'] === 'bientot') {
        return 'Bientôt disponible';
    }

    return $game['type'] === 'web' ? 'Jouer maintenant' : 'Télécharger';
}

/**
 * Initiales servant de vignette quand le jeu n'a pas d'image.
 * Même principe que mgs_initiale() pour les avatars d'amis.
 */
function mgs_game_initiales(string $nom): string
{
    $mots     = preg_split('/\s+/u', trim($nom)) ?: [];
    $initiales = '';

    foreach (array_slice($mots, 0, 2) as $mot) {
        $initiales .= mb_substr($mot, 0, 1);
    }

    return mb_strtoupper($initiales !== '' ? $initiales : mb_substr($nom, 0, 1));
}

/** Compte les jeux par type : « 3 en ligne · 2 à télécharger ». */
function mgs_games_compte(array $games): array
{
    $compte = ['web' => 0, 'download' => 0, 'bientot' => 0];

    foreach ($games as $game) {
        $compte[$game['type']]++;

        if ($game['statut'] === 'bientot') {
            $compte['bientot']++;
        }
    }

    return $compte;
}
