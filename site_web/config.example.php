<?php
declare(strict_types=1);

/**
 * config.example.php — modèle de configuration.
 *
 * Copier en config.php et remplir. config.php est dans .gitignore :
 * il contient le mot de passe MySQL et les clés d'API, il ne doit
 * JAMAIS être commité.
 *
 * Ce fichier a deux rôles :
 *   1. définir $conn, la connexion mysqli utilisée par tout le site
 *   2. renvoyer le tableau de configuration
 */

// Les erreurs SQL doivent lever des exceptions : links-model.php et
// create_user.php s'appuient dessus pour distinguer un doublon (1062)
// d'une vraie panne.
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$conn = new mysqli(
    'localhost',      // hôte
    'mgs_user',       // utilisateur
    'MOT_DE_PASSE',   // mot de passe
    'mgs'             // base
);

$conn->set_charset('utf8mb4');

return [
    // Sans slash final. Sert à construire les URL de retour OAuth et
    // les liens de réinitialisation de mot de passe.
    'SITE_URL' => 'https://my-gamers-stats.com',

    'PLATFORMS' => [
        // https://steamcommunity.com/dev/apikey
        'steam' => [
            'api_key' => 'VOTRE_CLE_STEAM',
        ],

        // https://developer.riotgames.com
        // Une clé de développement expire toutes les 24 h.
        //
        // valorant_api_key : clé HenrikDev, pour les stats Valorant.
        // Riot n'ouvre PAS ses endpoints Valorant aux clés de
        // développement (« Personal Key Applications are currently not
        // supported ») : il faut une clé Production approuvée, ce qui
        // n'est pas accordé à un site personnel. On passe donc par
        // l'API communautaire, exactement comme Fortnite passe par
        // fortnite-api.com.
        //
        // Obtenir la clé : rejoindre le Discord HenrikDev
        // (https://discord.com/invite/X3GaVkX2YN) et faire la demande
        // dans le salon dédié. Gratuit, format HDEV-….
        //
        // Laisser vide désactive proprement Valorant : la carte Riot
        // reste exactement celle d'avant, sans message d'erreur.
        'riot' => [
            'api_key'          => 'RGAPI-xxxxxxxx',
            'valorant_api_key' => '',   // HDEV-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
        ],

        // https://dev.epicgames.com/portal
        'epic' => [
            'client_id'     => 'VOTRE_CLIENT_ID',
            'client_secret' => 'VOTRE_CLIENT_SECRET',
        ],
    ],
];
