<?php

 require __DIR__ . '/../config.php';



 $stmt = $conn->prepare("INSERT INTO users (username, email, password_hash)
VALUES ('testuser', 'test@example.com', '$2y$');");


$stmt = $conn->prepare("SELECT * FROM users");
$stmt->execute();
$result = $stmt->get_result();
$row = $result->fetch_assoc();
