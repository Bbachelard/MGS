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
        <div class="logo"><a href="../index.html"><img src="../content/image/mgs_letters.png" width="100"></a></div>
        <div class="nav-box1"><a href=""><img src="../content/image/Steam_icon.webp" width="50"></a></div>
        <div class="nav-box2"><a href=""><img src="../content/image/riot-icon.png" width="50"></a></div>
        <div class="nav-box3"><a href=""><img src="../content/image/Epic_icon.webp" width="50"></a></div>
         <div class="login"><a href="./disconnect.php">Déconnexion</a></div>
    </header>


    
      <div class="steam-link"><a href="../php/steam-link.php">Lier mon compte Steam</a></div>

      <div class="compte">
          <div id="stats-result" class="stats-result"></div>
      </div>

      <!-- Modale pour l'image agrandie (nécessaire pour openImageModal dans stats-display.js) -->
      <div id="imageModal" class="image-modal">
          <span class="image-modal-close">&times;</span>
          <img class="image-modal-content" id="imageModalContent">
      </div>

      <script src="../js/stats-display.js?v=1"></script>
      <script src="../js/profile-stats.js?v=1"></script>
  </body>
</html>
