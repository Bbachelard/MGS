<?php
/**
 * Script de test de connexion à la base de données.
 * À placer dans le même dossier que db.php (là où require __DIR__.'/db.php' fonctionne),
 * puis ouvre-le dans ton navigateur : http://tonsite/test-db.php
 *
 * ⚠️ Fichier de TEST uniquement : supprime-le une fois la vérification faite,
 * ne le laisse pas en ligne sur un site accessible publiquement.
 */

declare(strict_types=1);
error_reporting(E_ALL);
ini_set('display_errors', '1');

require __DIR__ . '/db.php'; // adapte le chemin si besoin

header('Content-Type: text/plain; charset=utf-8');

echo "=== Test de connexion à la base de données ===\n\n";

try {
    $pdo = getPDO();
    echo "✅ Connexion réussie !\n\n";

    // Test 1 : requête simple
    $stmt = $pdo->query('SELECT 1 AS test');
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    echo "Test SELECT 1 -> " . $result['test'] . "\n\n";

    // Test 2 : version du serveur MySQL/MariaDB
    $version = $pdo->query('SELECT VERSION() AS v')->fetch(PDO::FETCH_ASSOC);
    echo "Version du serveur : " . $version['v'] . "\n\n";

    // Test 3 : lister les tables de la base
    echo "Tables présentes dans la base :\n";
    $tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
    if (empty($tables)) {
        echo " (aucune table trouvée)\n";
    } else {
        foreach ($tables as $table) {
            echo " - $table\n";
        }
    }

} catch (PDOException $e) {
    http_response_code(500);
    echo "❌ Erreur de connexion : " . $e->getMessage() . "\n";
} catch (Throwable $e) {
    http_response_code(500);
    echo "❌ Erreur inattendue : " . $e->getMessage() . "\n";
}