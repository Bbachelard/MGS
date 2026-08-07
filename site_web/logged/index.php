<?php
session_start();

if (!isset($_SESSION["logged"]) || $_SESSION["logged"] !== true) {
    header("Location: ../connexion/index.php");
    exit;
}
?>

<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="../content/css/stylesheet.css">
    <link rel="stylesheet" href="../content/css/styleLogin.css">
    <title>Connexion</title>
  </head>
  <body>
    <header class="navbar">
        <div class="logo"><a href=""><img src="../content/image/mgs_letters.png" width="100"></a></div>
        <div class="nav-box1"><a href=""><img src="../content/image/Steam_icon.webp" width="50"></a></div>
        <div class="nav-box2"><a href=""><img src="../content/image/riot-icon.png" width="50"></a></div>
        <div class="nav-box3"><a href=""><img src="../content/image/Epic_icon.webp" width="50"></a></div>
        <div class="login"><a href="">Déconnexion</a></div>
    </header>
  </body>
</html>
