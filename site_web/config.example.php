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
        'riot' => [
            'api_key' => 'RGAPI-xxxxxxxx',
        ],

        // https://dev.epicgames.com/portal
        'epic' => [
            'client_id'     => 'VOTRE_CLIENT_ID',
            'client_secret' => 'VOTRE_CLIENT_SECRET',
        ],
    ],
];
