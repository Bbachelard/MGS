<?php


require __DIR__ . '/../config.php';


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