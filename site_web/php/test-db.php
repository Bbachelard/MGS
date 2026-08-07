<?php

$configPath = __DIR__ . '/../config.php';
var_dump($configPath);
var_dump(file_exists($configPath));
echo file_get_contents($configPath);
exit;

/*
require __DIR__ . '/../config.php';

$username = 'testuser'; 

$stmt = $conn->prepare("SELECT * FROM users WHERE username = ?");
$stmt->bind_param("s", $username);
$stmt->execute();
$result = $stmt->get_result();
$row = $result->fetch_assoc();

if ($row) {
    echo "User ID: " . $row['id'] . ", Username: " . $row['username'] . ", Email: " . $row['email'] . "\n";
} else {
    echo "Aucun utilisateur trouvé.\n";
}