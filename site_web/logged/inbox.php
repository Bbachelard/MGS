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
if (
    $_SERVER['REQUEST_METHOD'] === 'POST'
    && isset($_POST['friendship_id'], $_POST['action'])
) {
    $friendshipId = (int) $_POST['friendship_id'];
    $action       = $_POST['action'];

    // Vérifie que la demande existe et nous est bien destinée
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

    } elseif ($action === 'accept') {

        /* -------------------------
           Accepter
        ------------------------- */

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


    } elseif ($action === 'refuse') {

        /* -------------------------
           Refuser
        ------------------------- */

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


/* ---------------------------------------------------------
   Récupération de la liste des amis
--------------------------------------------------------- */
$stmt = $conn->prepare(
    "SELECT
        users.id,
        users.username
     FROM friendships

     INNER JOIN users
        ON users.id = CASE
            WHEN friendships.sender_id = ?
                THEN friendships.receiver_id
            ELSE friendships.sender_id
        END

     WHERE friendships.status = 'accepted'

       AND (
            friendships.sender_id = ?
            OR friendships.receiver_id = ?
       )

     ORDER BY users.username ASC"
);

$stmt->bind_param("iii", $myId, $myId, $myId);
$stmt->execute();

$friends = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

$stmt->close();

?>
<!DOCTYPE html>
<html lang="fr">

<head>

    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <title>Amis — My gamers stats</title>

    <link
        rel="stylesheet"
        href="../content/css/stylesheet.css"
    >

    <link
        rel="stylesheet"
        href="../content/css/styleLogin.css"
    >

    <link
        rel="stylesheet"
        href="../content/css/ajouts-stats.css"
    >

</head>


<body>

<header class="navbar">

    <div class="logo">

        <a href="../index.html">

            <img
                src="../content/image/mgs_letters.png"
                width="100"
                alt="My Gamer Stats"
            >

        </a>

    </div>


    <div class="login">

        <a href="./index.php">
            Mon profil
        </a>

    </div>

</header>


<main>

    <div class="titre">

        <h1>Mes amis</h1>

    </div>


    <?php if ($banner): ?>

        <div class="banner banner--<?= htmlspecialchars($banner['type']) ?>">

            <?= htmlspecialchars($banner['text']) ?>

        </div>

    <?php endif; ?>



    <!-- =====================================================
         DEMANDES D'AMI
    ====================================================== -->

    <div class="compte">

        <div class="stats-result">

            <h2>Demandes d'ami</h2>


            <?php if (empty($requests)): ?>

                <div class="empty-state">
                    Tu n'as aucune demande d'ami en attente.
                </div>

            <?php else: ?>

                <div class="friends-grid">

                    <?php foreach ($requests as $request): ?>

                        <div class="friend-card friend-card--request">

                            <div class="friend-card__main">

                                <div class="friend-avatar">
                                    <?= htmlspecialchars(mb_strtoupper(mb_substr($request['username'], 0, 1))) ?>
                                </div>

                                <div class="friend-info">

                                    <h3><?= htmlspecialchars($request['username']) ?></h3>

                                    <span class="status-badge">
                                        Veut devenir ton ami
                                    </span>

                                </div>

                            </div>


                            <div class="friend-actions">

                                <form action="" method="post" class="friend-actions__form">

                                    <input type="hidden" name="friendship_id" value="<?= (int) $request['friendship_id'] ?>">
                                    <input type="hidden" name="action" value="accept">

                                    <button type="submit" class="button btn-sm">
                                        Accepter
                                    </button>

                                </form>

                                <form action="" method="post" class="friend-actions__form">

                                    <input type="hidden" name="friendship_id" value="<?= (int) $request['friendship_id'] ?>">
                                    <input type="hidden" name="action" value="refuse">

                                    <button type="submit" class="button button--ghost btn-sm">
                                        Refuser
                                    </button>

                                </form>

                            </div>

                        </div>

                    <?php endforeach; ?>

                </div>

            <?php endif; ?>

        </div>

    </div>



    <!-- =====================================================
         LISTE DES AMIS
    ====================================================== -->

    <div class="compte">

        <div class="stats-result">

            <h2>Liste de mes amis</h2>


            <?php if (empty($friends)): ?>

                <div class="empty-state">
                    Tu n'as pas encore d'amis.
                </div>

            <?php else: ?>

                <div class="friends-grid">

                    <?php foreach ($friends as $friend): ?>

                        <div class="friend-card">

                            <div class="friend-card__main">

                                <div class="friend-avatar">
                                    <?= htmlspecialchars(mb_strtoupper(mb_substr($friend['username'], 0, 1))) ?>
                                </div>

                                <div class="friend-info">

                                    <h3><?= htmlspecialchars($friend['username']) ?></h3>

                                    <span class="status-badge online">
                                        Ami
                                    </span>

                                </div>

                            </div>


                            <div class="friend-actions">

    
                                <a href="./friend_profile.php?id=<?= (int) $friend['id'] ?>"
                                    class="button btn-sm"
                                >
                                    Voir le profil
                                </a>

                            </div>

                        </div>

                    <?php endforeach; ?>

                </div>

            <?php endif; ?>

        </div>

    </div>


</main>

</body>

</html>