<?php
declare(strict_types=1);

/* ==================================================================
 *  providers/riot/constantes.php — constantes du provider Riot.
 *
 *  Ce fichier s'est appelé config.php : un motif « config.php » non
 *  ancré dans .gitignore l'a exclu des commits à toutes les
 *  profondeurs, et le provider Riot tombait en erreur 500 faute de lui.
 *  Le nom actuel ne peut plus se faire attraper par une règle qui vise
 *  la configuration du site.
 *
 *  Séparées du code : ce sont les seules valeurs à toucher quand Riot
 *  ajoute une région, renomme une file ou déplace ses assets.
 * ================================================================== */

/** Plateforme de jeu -> cluster régional (account-v1, match-v5). */
const RIOT_ROUTES = [
    'euw1' => 'europe', 'eun1' => 'europe', 'tr1' => 'europe', 'ru' => 'europe', 'me1' => 'europe',
    'na1'  => 'americas', 'br1' => 'americas', 'la1' => 'americas', 'la2' => 'americas',
    'kr'   => 'asia', 'jp1' => 'asia',
    'oc1'  => 'sea', 'sg2' => 'sea', 'tw2' => 'sea', 'vn2' => 'sea',
];

const RIOT_QUEUES = [
    400  => 'Normale draft',
    420  => 'Classée Solo/Duo',
    430  => 'Normale aveugle',
    440  => 'Classée Flex',
    450  => 'ARAM',
    490  => 'Partie rapide',
    700  => 'Clash',
    1700 => 'Arena',
];

const RIOT_DIVISIONS = ['IV' => 0, 'III' => 1, 'II' => 2, 'I' => 3];

/** Tiers apex : pas de divisions, on étale sur les LP. */
const RIOT_TIERS_APEX = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];

/**
 * Percentile approximatif de chaque tier sur la ladder soloq EUW.
 * [plancher, plafond] = % de joueurs que tu dépasses.
 * C'est CE chiffre qui permet de comparer un Diamant LoL à un
 * Diamant CS2 : chaque provider doit renvoyer la même échelle 0-100.
 */
const RIOT_TIER_PERCENTILE = [
    'IRON'        => [0.0,   4.0],
    'BRONZE'      => [4.0,  20.0],
    'SILVER'      => [20.0, 40.0],
    'GOLD'        => [40.0, 60.0],
    'PLATINUM'    => [60.0, 78.0],
    'EMERALD'     => [78.0, 90.0],
    'DIAMOND'     => [90.0, 97.5],
    'MASTER'      => [97.5, 99.6],
    'GRANDMASTER' => [99.6, 99.9],
    'CHALLENGER'  => [99.9, 100.0],
];

/** Points de maîtrise moyens rapportés par partie (sert à estimer le temps de jeu). */
const RIOT_POINTS_PAR_PARTIE = 350;

/** Champions affichés dans « Champions favoris ». */
const RIOT_MASTERY_TOP = 3;

/**
 * Emblème de maîtrise, servi par CommunityDragon (ni clé API, ni version à
 * suivre). Riot réorganise ses assets de temps en temps : si l'image casse,
 * seule cette constante est à corriger — la carte retombe automatiquement
 * sur la pastille chiffrée.
 * Chemin de secours connu (niveaux 1-7 uniquement) :
 * .../plugins/rcp-be-lol-collections/global/default/images/mastery/mastery-icon-level-%d.png
 */
const RIOT_MASTERY_EMBLEM =
    'https://raw.communitydragon.org/latest/game/assets/ux/mastery/legendarychampionmastery/masterycrest_level%d_minis.png';
/* ---- Parties détaillées ------------------------------------------ */
/** Emblèmes de rang (CommunityDragon), utilisés quand le PNG local manque. */
const RIOT_RANK_EMBLEM =
    'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/%s.png';

/** Parties chargées d'emblée avec la carte. */
const RIOT_MATCHES_INITIAL = 3;

/** Parties ajoutées à chaque clic sur « Voir plus ». */
const RIOT_MATCHES_PAGE = 5;

/** Plafond de pagination. match-v5 ne remonte pas indéfiniment de toute façon. */
const RIOT_MATCHES_MAX = 100;

/** Une partie terminée ne change plus jamais : on la garde longtemps. */
const RIOT_MATCH_CACHE_JOURS = 60;

/** Modes dont on sait dessiner le détail (2 équipes de 5). L'Arena viendra plus tard. */
const RIOT_MODES_DETAILLES = [400, 410, 420, 430, 440, 450, 490, 700, 830, 840, 850];

/** teamId -> libellé affiché. */
const RIOT_EQUIPES = [100 => 'Équipe bleue', 200 => 'Équipe rouge'];

/** teamPosition -> libellé court. */
const RIOT_POSTES = [
    'TOP'     => 'Top',
    'JUNGLE'  => 'Jungle',
    'MIDDLE'  => 'Mid',
    'BOTTOM'  => 'Bot',
    'UTILITY' => 'Support',
];

/** Couleur d'accent par tier, pour les encadrés de rang. */
const RIOT_TIER_COULEUR = [
    'IRON'        => '#7d7d84',
    'BRONZE'      => '#a2673f',
    'SILVER'      => '#98a5a5',
    'GOLD'        => '#e0b04a',
    'PLATINUM'    => '#4ec2c2',
    'EMERALD'     => '#37b56a',
    'DIAMOND'     => '#6c7bff',
    'MASTER'      => '#b566d9',
    'GRANDMASTER' => '#e0575b',
    'CHALLENGER'  => '#4fd1ff',
];
