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
    die("Utilisateur introuvable");
}

if (!password_verify($password, $row['password_hash'])) {
    die("Mot de passe refusé");
}

session_regenerate_id(true);

$_SESSION["logged"] = true;
$_SESSION["user_id"] = $row['id'];
$_SESSION["username"] = $username;

echo "<pre>";
echo "CONNEXION OK\n";
echo "Session ID : " . session_id() . "\n";
var_dump($_SESSION);
exit();