<?php
declare(strict_types=1);

session_start();

if (!isset($_SESSION["logged"]) || $_SESSION["logged"] !== true) {
    header("Location: ../connexion/index.php");
    exit;
}

$config = require __DIR__ . '/../config.php';

$myId       = (int) ($_SESSION['user_id'] ?? 0);
$myUsername = $_SESSION['username'] ?? '';

$banner = null;

/* ---------------------------------------------------------
   Accepter / Refuser une demande d'ami
--------------------------------------------------------- */
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['friendship_id'], $_POST['action'])) {
    $friendshipId = (int) $_POST['friendship_id'];
    $action       = $_POST['action'];

    /*
     * On récupère la demande en vérifiant qu'elle appartient
     * bien à l'utilisateur connecté.
     */
    $stmt = $conn->prepare(
        "SELECT id, sender_id, receiver_id, status
         FROM friendships
         WHERE id = ?
           AND receiver_id = ?
           AND status = 'pending'
         LIMIT 1"
    );

    $stmt->bind_param("ii", $friendshipId, $myId);
    $stmt->execute();

    $friendship = $stmt->get_result()->fetch_assoc();

    $stmt->close();

    if (!$friendship) {
        $banner = [
            'type' => 'error',
            'text' => "Cette demande n'existe pas ou a déjà été traitée."
        ];
    } else {

        /* -------------------------
           Accepter
        ------------------------- */
        if ($action === 'accept') {

            $stmt = $conn->prepare(
                "UPDATE friendships
                 SET status = 'accepted'
                 WHERE id = ?
                   AND receiver_id = ?
                   AND status = 'pending'"
            );

            $stmt->bind_param("ii", $friendshipId, $myId);

            if ($stmt->execute()) {
                $banner = [
                    'type' => 'success',
                    'text' => "Demande d'ami acceptée."
                ];
            } else {
                $banner = [
                    'type' => 'error',
                    'text' => "Une erreur est survenue."
                ];
            }

            $stmt->close();

        /* -------------------------
           Refuser
        ------------------------- */
        } elseif ($action === 'refuse') {

            /*
             * Ici on supprime simplement la demande.
             * Cela permet à l'utilisateur de renvoyer
             * une demande plus tard.
             */
            $stmt = $conn->prepare(
                "DELETE FROM friendships
                 WHERE id = ?
                   AND receiver_id = ?
                   AND status = 'pending'"
            );

            $stmt->bind_param("ii", $friendshipId, $myId);

            if ($stmt->execute()) {
                $banner = [
                    'type' => 'success',
                    'text' => "Demande d'ami refusée."
                ];
            } else {
                $banner = [
                    'type' => 'error',
                    'text' => "Une erreur est survenue."
                ];
            }

            $stmt->close();

        } else {
            $banner = [
                'type' => 'error',
                'text' => "Action invalide."
            ];
        }
    }
}


/* ---------------------------------------------------------
   Récupération des demandes reçues
--------------------------------------------------------- */
$stmt = $conn->prepare(
    "SELECT
        friendships.id AS friendship_id,
        users.id AS user_id,
        users.username
     FROM friendships
     INNER JOIN users
        ON users.id = friendships.sender_id
     WHERE friendships.receiver_id = ?
       AND friendships.status = 'pending'
     ORDER BY friendships.id DESC"
);

$stmt->bind_param("i", $myId);
$stmt->execute();

$requests = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

$stmt->close();

?>
<!DOCTYPE html>
<html lang="fr">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <title>Demandes d'ami — My gamers stats</title>

    <link rel="stylesheet" href="../content/css/stylesheet.css">
    <link rel="stylesheet" href="../content/css/styleLogin.css">
    <link rel="stylesheet" href="../content/css/ajouts-stats.css">
</head>

<body>

<header class="navbar">

    <div class="logo">
        <a href="../index.html">
            <img src="../content/image/mgs_letters.png" width="100">
        </a>
    </div>

    <div class="login">
        <a href="./profile.php">Mon profil</a>
    </div>

</header>


<main>

    <div class="titre">
        <h1>Demandes d'ami</h1>
    </div>


    <?php if ($banner): ?>

        <div class="banner banner--<?= htmlspecialchars($banner['type']) ?>">
            <?= htmlspecialchars($banner['text']) ?>
        </div>

    <?php endif; ?>


    <div class="compte">

        <div class="stats-result">

            <?php if (empty($requests)): ?>

                <p class="stats-info">
                    Tu n'as aucune demande d'ami en attente.
                </p>

            <?php endif; ?>


            <?php foreach ($requests as $request): ?>

                <div class="player-card" style="margin-bottom: 16px;">

                    <div class="player-header">

                        <div class="player-identity">

                            <h3>
                                <?= htmlspecialchars($request['username']) ?>
                            </h3>

                            <span class="status-badge">
                                Demande d'ami
                            </span>

                        </div>

                    </div>


                    <div style="display: flex; gap: 10px; margin-top: 15px;">

                        <!-- Accepter -->
                        <form action="" method="post">

                            <input
                                type="hidden"
                                name="friendship_id"
                                value="<?= (int) $request['friendship_id'] ?>"
                            >

                            <input
                                type="hidden"
                                name="action"
                                value="accept"
                            >

                            <button
                                type="submit"
                                class="button"
                            >
                                Accepter
                            </button>

                        </form>


                        <!-- Refuser -->
                        <form action="" method="post">

                            <input
                                type="hidden"
                                name="friendship_id"
                                value="<?= (int) $request['friendship_id'] ?>"
                            >

                            <input
                                type="hidden"
                                name="action"
                                value="refuse"
                            >

                            <button
                                type="submit"
                                class="button"
                            >
                                Refuser
                            </button>

                        </form>

                    </div>

                </div>

            <?php endforeach; ?>

        </div>

    </div>

</main>

</body>
</html>