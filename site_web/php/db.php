<?php
function getPDO(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        require __DIR__ . '/../config.php';

        $pdo = new PDO(
            "mysql:host={$db_host};dbname={$db_name};charset=utf8mb4",
            $db_username,
            $db_password,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
    }
    return $pdo;
}