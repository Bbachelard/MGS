<?php 

    require __DIR__ . '/../config.php';
    session_start();
    //parametres recus du formulaire de connexion

    $username = $_POST['username'];
    $password = $_POST['password'];


    //preparation d'une requete sql propre (je ferais plus l'erreur xD)

    $stmt = $conn->prepare("SELECT id, password_hash FROM users WHERE username = ?");
    $stmt->bind_param("s", $username);
    $stmt->execute();

    $result = $stmt->get_result();
    $row = $result->fetch_assoc();


    $hash = $row['password_hash'];

    $isPasswordCorrect = password_verify($password, $hash);


    if($isPasswordCorrect == true)
        {
            $_SESSION["logged"] = true;
            $_SESSION["user_id"]  = $row['id'];
            $_SESSION["username"] = $username;
            header("Location: ../logged/index.php"); 
        }
    else
        {
            header("Location: ../connexion/index.php?error=invalid_credentials");
            exit();
        }
    exit();
    

?>