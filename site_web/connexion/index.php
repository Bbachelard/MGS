<?php 
  session_start();

  if(isset($_SESSION["logged"]) && $_SESSION["logged"] == true)
  {
      header("Location: ../logged/index.php");
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
        <div class="login"><a href="">Connexion</a></div>
    </header>

    <div class="page">
      <div class="login-wrapper">
        <form action="verify_user.php" method="post" class="form_connect">
            <h1>Connexion</h1>
            <p>Entre tes identifiants pour accéder à ton espace.</p>

            <div class="form-group">
                <label for="username">Nom d'utilisateur</label>
                </br>
                <input
                    class="text-field"
                    type="text"
                    name="username"
                    id="username"
                    placeholder="Ton pseudo"
                    required
                >
            </div>

            <div class="form-group">
                <label for="password">Mot de passe</label>
                </br>
                <input
                    class="text-field"
                    type="password"
                    name="password"
                    id="password"
                    placeholder="••••••••"
                    required
                >
            </div>

            <div class="form-group">
                <input class="button" type="submit" value="Se connecter">
                <a href="https://my-gamers-stats.com/signup/" class="button-2">S'inscrire</a>
            </div>
            
        </form>
    </div>
    </div>
  </body>
</html>
