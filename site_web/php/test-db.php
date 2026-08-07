<?php

require __DIR__ . '/../config.php';

$stmt = $conn->prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)");
$username = 'testuser';
$email = 'test@example.com';
$passwordHash = password_hash('test1234', PASSWORD_BCRYPT); 

$stmt->bind_param("sss", $username, $email, $passwordHash);
$stmt->execute();

if ($stmt->error) {
    echo "Erreur lors de l'insertion : " . $stmt->error . "\n";
}

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