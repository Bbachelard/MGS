<?php

require __DIR__ . '/../config.php';
session_start();

$username = $_POST['username'];
$password = $_POST['password'];

$stmt = $conn->prepare(
    "SELECT id, password_hash FROM users WHERE username = ?"
);

$stmt->bind_param("s", $username);
$stmt->execute();

$result = $stmt->get_result();
$row = $result->fetch_assoc();

if ($row === null) {
    // L'utilisateur n'existe pas
    header("Location: index.php?error=invalid");
    exit();
}

if (password_verify($password, $row['password_hash'])) {

    session_regenerate_id(true);

    $_SESSION["logged"] = true;
    $_SESSION["user_id"] = $row['id'];
    $_SESSION["username"] = $username;

    header("Location: ../logged/index.php");
    exit();
}

header("Location: index.php?error=invalid");
exit();