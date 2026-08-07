<?php
session_start();
require __DIR__ . '/vendor/autoload.php';
$config = require __DIR__ . '/../config.php';

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    exit('Connecte-toi d\'abord sur le site.');
}

use xPaw\SteamOpenID\SteamOpenID;

$steam = new SteamOpenID($config['SITE_URL'] . '/php/steam-link-callback.php');
header('Location: ' . $steam->GetAuthUrl());
exit;