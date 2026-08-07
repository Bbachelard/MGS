<?php
require __DIR__ . '/../config.php';
session_start();

// Si déjà connecté, on redirige
if (isset($_SESSION["logged"]) && $_SESSION["logged"] == true) {
    header("Location: ../logged/index.php");
    exit;
}

// On n'accepte que les requêtes POST
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    header("Location: ../signup/index.php");
    exit;
}

// Petite fonction utilitaire pour rediriger avec une erreur
function redirectWithError($message) {
    $_SESSION['signup_error'] = $message;
    header("Location: ../signup/index.php");
    exit;
}

$username = trim($_POST['username'] ?? '');
$email    = trim($_POST['email'] ?? '');
$password = $_POST['password'] ?? '';

// Validation côté serveur
if ($username === '' || $email === '' || $password === '') {
    redirectWithError("Tous les champs sont obligatoires.");
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    redirectWithError("Adresse mail invalide.");
}

if (strlen($password) < 8) {
    redirectWithError("Le mot de passe doit contenir au moins 8 caractères.");
}

// Vérifier unicité username / email
$stmt = $conn->prepare("SELECT id FROM users WHERE username = ? OR email = ?");
$stmt->bind_param("ss", $username, $email);
$stmt->execute();
$result = $stmt->get_result();

if ($result->num_rows > 0) {
    redirectWithError("Ce nom d'utilisateur ou cette adresse mail est déjà utilisé.");
}
$stmt->close();

// Hash du mot de passe
$password_hash = password_hash($password, PASSWORD_DEFAULT);

// Insertion
$stmt = $conn->prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)");
$stmt->bind_param("sss", $username, $email, $password_hash);

if ($stmt->execute()) {
    $_SESSION["logged"]   = true;
    $_SESSION["user_id"]  = $stmt->insert_id;
    $_SESSION["username"] = $username;

    $stmt->close();
    $conn->close();

    header("Location: ../logged/index.php");
    exit;
}

// Si on arrive ici, l'insert a échoué (erreur serveur, pas la faute de l'utilisateur)
$stmt->close();
$conn->close();
redirectWithError("Une erreur est survenue, réessaie plus tard.");