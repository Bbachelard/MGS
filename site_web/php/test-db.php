<?php

 require __DIR__ . '/../config.php';

$stmt = $conn->prepare("SELECT * FROM users");
$stmt->execute();
$result = $stmt->get_result();
$row = $result->fetch_assoc();

$hash = $row['hash'];

echo($hash);