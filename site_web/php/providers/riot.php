<?php
declare(strict_types=1);

/* ==================================================================
 *  Provider Riot Games — League of Legends
 *  ------------------------------------------------------------------
 *  Ce fichier faisait 1501 lignes. Il ne fait plus que charger les
 *  modules de providers/riot/, dans l'ordre de leurs dépendances :
 *
 *    constantes.php  constantes (régions, files, tiers, TTL de cache)
 *    http.php     appels à l'API Riot (la clé passe en header)
 *    ranks.php    rangs : formatage, percentile, emblèmes, couleurs
 *    assets.php   Data Dragon : champions, objets, sorts, runes
 *    stats.php    riot_resolve_account_id() + riot_fetch_stats()
 *    matches.php  historique détaillé des parties + son cache
 *    valorant.php rang, agents et parties Valorant (API tierce bornée)
 *    verify.php   liaison de compte par changement d'icône de profil
 *
 *  platforms.php appelle les fonctions riot_* par leur nom
 *  (mgs_provider_call), donc l'interface publique du provider est
 *  strictement inchangée : aucun appelant n'a été modifié.
 *
 *  accountId interne : "plateforme:puuid"   ex. "euw1:abc123..."
 * ================================================================== */

require_once __DIR__ . '/../platforms.php';

require_once __DIR__ . '/riot/constantes.php';
require_once __DIR__ . '/riot/http.php';
require_once __DIR__ . '/riot/ranks.php';
require_once __DIR__ . '/riot/assets.php';
require_once __DIR__ . '/riot/stats.php';
require_once __DIR__ . '/riot/matches.php';
require_once __DIR__ . '/riot/valorant.php';
require_once __DIR__ . '/riot/verify.php';
