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

/* ==================================================================
 *  Valorant
 *  ------------------------------------------------------------------
 *  Même compte Riot, autre jeu, autre échelle de rangs. Les valeurs
 *  ci-dessous ne dépendent pas du fournisseur de stats : elles
 *  décrivent le jeu, pas l'API qui le sert.
 * ================================================================== */

/**
 * Plateforme League of Legends -> région Valorant.
 * Le PUUID est global, mais les routes Valorant sont régionales et ne
 * portent pas les mêmes codes que celles de LoL.
 */
const RIOT_VAL_REGIONS = [
    'euw1' => 'eu',    'eun1' => 'eu',    'tr1' => 'eu',    'ru'  => 'eu',    'me1' => 'eu',
    'na1'  => 'na',    'br1'  => 'br',    'la1' => 'latam', 'la2' => 'latam',
    'kr'   => 'kr',    'jp1'  => 'ap',
    'oc1'  => 'ap',    'sg2'  => 'ap',    'tw2' => 'ap',    'vn2' => 'ap',
];

/** Région servie quand la plateforme LoL n'est pas dans la table. */
const RIOT_VAL_REGION_DEFAUT = 'eu';

/** Tiers Valorant, DANS L'ORDRE : riot_val_tier() indexe dessus. */
const RIOT_VAL_TIERS = [
    'IRON'      => 'Fer',
    'BRONZE'    => 'Bronze',
    'SILVER'    => 'Argent',
    'GOLD'      => 'Or',
    'PLATINUM'  => 'Platine',
    'DIAMOND'   => 'Diamant',
    'ASCENDANT' => 'Ascendant',
    'IMMORTAL'  => 'Immortel',
    'RADIANT'   => 'Radiant',
];

/**
 * Tiers sans division affichée. Radiant est le seul : tous les autres,
 * Immortel compris, gardent leurs paliers 1/2/3.
 */
const RIOT_VAL_TIERS_SANS_DIVISION = ['RADIANT'];

/** Modes de jeu -> libellé français. Les absents s'affichent tels quels. */
const RIOT_VAL_MODES = [
    'competitive' => 'Compétitif',
    'unrated'     => 'Non classé',
    'swiftplay'   => 'Partie rapide',
    'spikerush'   => 'Spike Rush',
    'deathmatch'  => 'Match à mort',
    'escalation'  => 'Escalade',
    'teamdeathmatch' => 'Match à mort par équipe',
    'replication' => 'Réplication',
    'premier'     => 'Premier',
];

/**
 * Percentile approximatif de chaque tier sur la ladder compétitive.
 * [plancher, plafond] = % de joueurs que tu dépasses.
 * MÊME ÉCHELLE que RIOT_TIER_PERCENTILE : c'est ce qui permet au hub de
 * classer un Immortel Valorant au-dessus d'un Diamant LoL.
 */
const RIOT_VAL_TIER_PERCENTILE = [
    'IRON'      => [0.0,   5.0],
    'BRONZE'    => [5.0,  19.0],
    'SILVER'    => [19.0, 39.0],
    'GOLD'      => [39.0, 58.0],
    'PLATINUM'  => [58.0, 75.0],
    'DIAMOND'   => [75.0, 87.0],
    'ASCENDANT' => [87.0, 94.5],
    'IMMORTAL'  => [94.5, 99.97],
    'RADIANT'   => [99.97, 100.0],
];

/** Couleur d'accent par tier Valorant, pour les encadrés de rang. */
const RIOT_VAL_TIER_COULEUR = [
    'IRON'      => '#7d7d84',
    'BRONZE'    => '#a2673f',
    'SILVER'    => '#98a5a5',
    'GOLD'      => '#e0b04a',
    'PLATINUM'  => '#4ec2c2',
    'DIAMOND'   => '#c471ed',
    'ASCENDANT' => '#37b56a',
    'IMMORTAL'  => '#a63b5d',
    'RADIANT'   => '#fffbb0',
];

/**
 * Emblème de rang Valorant, servi par le CDN de valorant-api.com
 * (ni clé, ni version à suivre). %d = tier.id brut.
 * Si l'image casse, seule cette constante est à corriger — la carte
 * retombe automatiquement sur le libellé texte.
 */
const RIOT_VAL_RANK_EMBLEM =
    'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/%d/largeicon.png';

/** Portrait d'agent. %s = nom de l'agent en minuscules. */
const RIOT_VAL_AGENT_ICON = 'https://valorant-api.com/v1/agents/%s/displayicon';

/**
 * Jaquette du jeu, affichée dans le tableau des jeux et sur la carte
 * « Jeu principal ». Poser le fichier à ce chemin ; sans lui, le
 * tableau retombe sur les initiales (onerror="this.remove()").
 */
const RIOT_VAL_JAQUETTE = '/content/image/games/valorant.jpg';

/** Parties demandées au fournisseur (sert aussi aux agents favoris). */
const RIOT_VAL_MATCHES_MAX = 20;

/** Parties listées sur la carte. */
const RIOT_VAL_MATCHES_AFFICHEES = 5;

/** Agents affichés dans « Agents favoris ». */
const RIOT_VAL_AGENTS_TOP = 3;

/**
 * Durée moyenne d'une partie compétitive, en minutes. Le fournisseur
 * ne renvoie pas la durée : c'est le seul moyen d'estimer un temps de
 * jeu. Toute valeur qui en découle est marquée 'estimated' => true.
 */
const RIOT_VAL_MINUTES_PAR_PARTIE = 35;

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
