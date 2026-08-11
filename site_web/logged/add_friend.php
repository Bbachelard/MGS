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
   Traitement de l'envoi d'une demande d'ami (POST)
--------------------------------------------------------- */
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['add_friend_id'])) {
    $targetId = (int) $_POST['add_friend_id'];

    if ($targetId === $myId) {
        $banner = ['type' => 'error', 'text' => "Tu ne peux pas t'ajouter toi-même."];
    } else {
        // Vérifie que l'utilisateur ciblé existe bien
        $stmt = $conn->prepare("SELECT id FROM users WHERE id = ?");
        $stmt->bind_param("i", $targetId);
        $stmt->execute();
        $exists = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        if (!$exists) {
            $banner = ['type' => 'error', 'text' => "Cet utilisateur n'existe pas."];
        } else {
            // Vérifie qu'aucune demande n'existe déjà, dans un sens ou dans l'autre
            $stmt = $conn->prepare(
                "SELECT id, sender_id, status FROM friendships
                 WHERE (sender_id = ? AND receiver_id = ?)
                    OR (sender_id = ? AND receiver_id = ?)
                 LIMIT 1"
            );
            $stmt->bind_param("iiii", $myId, $targetId, $targetId, $myId);
            $stmt->execute();
            $existing = $stmt->get_result()->fetch_assoc();
            $stmt->close();

            if ($existing) {
                if ($existing['status'] === 'accepted') {
                    $banner = ['type' => 'error', 'text' => "Vous êtes déjà amis."];
                } elseif ((int) $existing['sender_id'] === $myId) {
                    $banner = ['type' => 'error', 'text' => "Demande déjà envoyée, en attente de réponse."];
                } else {
                    $banner = ['type' => 'error', 'text' => "Cet utilisateur t'a déjà envoyé une demande d'ami."];
                }
            } else {
                $stmt = $conn->prepare(
                    "INSERT INTO friendships (sender_id, receiver_id) VALUES (?, ?)"
                );
                $stmt->bind_param("ii", $myId, $targetId);

                if ($stmt->execute()) {
                    $banner = ['type' => 'success', 'text' => "Demande d'ami envoyée."];
                } else {
                    $banner = ['type' => 'error', 'text' => "Une erreur est survenue, réessaie plus tard."];
                }
                $stmt->close();
            }
        }
    }
}

/* ---------------------------------------------------------
   Recherche d'un utilisateur (GET)
--------------------------------------------------------- */
$query   = trim($_GET['q'] ?? '');
$results = [];

if ($query !== '') {
    $like = '%' . $query . '%';
    $stmt = $conn->prepare(
        "SELECT id, username FROM users WHERE username LIKE ? AND id != ? ORDER BY username LIMIT 20"
    );
    $stmt->bind_param("si", $like, $myId);
    $stmt->execute();
    $results = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    // Récupère l'état de relation existant pour chaque résultat affiché
    if ($results) {
        $ids = array_column($results, 'id');
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $types = str_repeat('i', count($ids) + 1) . 'i';

        $sql = "SELECT sender_id, receiver_id, status FROM friendships
                WHERE (sender_id = ? AND receiver_id IN ($placeholders))
                   OR (receiver_id = ? AND sender_id IN ($placeholders))";
        $stmt = $conn->prepare($sql);

        $params = array_merge([$myId], $ids, [$myId], $ids);
        $stmt->bind_param(str_repeat('i', count($params)), ...$params);
        $stmt->execute();
        $relations = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmt->close();

        $relationByUser = [];
        foreach ($relations as $rel) {
            $otherId = (int) $rel['sender_id'] === $myId ? (int) $rel['receiver_id'] : (int) $rel['sender_id'];
            $relationByUser[$otherId] = [
                'status'   => $rel['status'],
                'isSender' => (int) $rel['sender_id'] === $myId,
            ];
        }

        foreach ($results as &$r) {
            $r['relation'] = $relationByUser[(int) $r['id']] ?? null;
        }
        unset($r);
    }
}
?>
<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ajouter un ami — My gamers stats</title>
    <link rel="stylesheet" href="../content/css/stylesheet.css">
    <link rel="stylesheet" href="../content/css/styleLogin.css">
    <link rel="stylesheet" href="../content/css/ajouts-stats.css">
  </head>
  <body>
    <header class="navbar">
        <div class="logo"><a href="../index.html"><img src="../content/image/mgs_letters.png" width="100"></a></div>
        <div class="login"><a href="./index.php">Mon profil</a></div>
    </header>

    <main>
        <div class="titre"><h1>Ajouter un ami</h1></div>

        <?php if ($banner): ?>
            <div class="banner banner--<?= $banner['type'] ?>"><?= htmlspecialchars($banner['text']) ?></div>
        <?php endif; ?>

        <form action="" method="get" class="form-example">
            <div class="login-wrapper" style="margin: 30px auto 0;">
                <label for="q">Rechercher un joueur</label>
                <input
                    type="text"
                    id="q"
                    name="q"
                    class="text-field"
                    placeholder="Pseudo à rechercher"
                    value="<?= htmlspecialchars($query) ?>"
                >
                <button type="submit" class="button">Rechercher</button>
            </div>
        </form>

        <div class="compte">
            <div class="stats-result">
                <?php if ($query !== '' && empty($results)): ?>
                    <p class="stats-info">Aucun utilisateur trouvé pour « <?= htmlspecialchars($query) ?> ».</p>
                <?php endif; ?>

                <?php foreach ($results as $user): ?>
                    <div class="player-card" style="margin-bottom: 16px;">
                        <div class="player-header">
                            <div class="player-identity">
                                <h3><?= htmlspecialchars($user['username']) ?></h3>
                            </div>
                        </div>

                        <?php if ($user['relation'] === null): ?>
                            <form action="" method="post">
                                <input type="hidden" name="add_friend_id" value="<?= (int) $user['id'] ?>">
                                <button type="submit" class="button">Ajouter en ami</button>
                            </form>
                        <?php elseif ($user['relation']['status'] === 'accepted'): ?>
                            <span class="status-badge online">Déjà amis</span>
                        <?php elseif ($user['relation']['isSender']): ?>
                            <span class="status-badge">Demande envoyée</span>
                        <?php else: ?>
                            <span class="status-badge">Vous a envoyé une demande</span>
                        <?php endif; ?>
                    </div>
                <?php endforeach; ?>
            </div>
        </div>
    </main>
  </body>
</html>
