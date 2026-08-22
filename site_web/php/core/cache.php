<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/platforms.php';   // MGS_ROOT

/* ==================================================================
 *  php/core/cache.php — cache disque des réponses d'API externes.
 *
 *  api.php et matches.php portaient chacun le même bloc : construire un
 *  chemin, comparer filemtime() au TTL, readfile(), file_put_contents().
 *  Il vit ici une seule fois.
 *
 *  Le cache stocke du JSON DÉJÀ ENCODÉ : on le renvoie tel quel sans
 *  repasser par un decode/encode inutile.
 * ================================================================== */

/** Racine des caches, hors arborescence publique servie par le serveur. */
function mgs_cache_dir(string $espace): string
{
    $dir = MGS_ROOT . '/cache/' . $espace;

    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }

    return $dir;
}

/**
 * Chemin d'un fichier de cache. Les composants de la clé sont hachés :
 * un accountId peut contenir « : », « # » et autres caractères qui n'ont
 * rien à faire dans un nom de fichier.
 *
 * @param list<string|int> $composants
 */
function mgs_cache_file(string $espace, string $prefixe, array $composants): string
{
    $cle = sha1(implode('|', array_map('strval', $composants)));

    return mgs_cache_dir($espace) . '/' . $prefixe . '-' . $cle . '.json';
}

/**
 * Sert la réponse depuis le cache si elle est encore fraîche, et
 * termine le script. Sinon rend la main à l'appelant.
 *
 * ?refresh=1 (bouton « actualiser ») court-circuite le cache.
 */
function mgs_cache_serve(string $fichier, int $ttl): void
{
    if (isset($_GET['refresh'])) {
        return;
    }

    if (!is_file($fichier) || (time() - filemtime($fichier)) >= $ttl) {
        return;
    }

    header('X-MGS-Cache: hit');
    readfile($fichier);
    exit;
}

/** Enregistre la réponse encodée puis l'émet, en signalant le miss. */
function mgs_cache_store_and_send(string $fichier, string $json): never
{
    @file_put_contents($fichier, $json, LOCK_EX);

    header('X-MGS-Cache: miss');
    echo $json;
    exit;
}

/**
 * Lit une entrée de cache si elle est encore fraîche, sans jamais imprimer
 * ni s'arrêter — contrairement à mgs_cache_serve(). Pour les appelants qui
 * ont besoin de la VALEUR en cache plutôt que d'y répondre directement
 * (ex. game/arene/index.php, qui compose une URL au lieu de renvoyer du
 * JSON). Renvoie null si absent, périmé, ou illisible.
 */
function mgs_cache_read(string $fichier, int $ttl): ?array
{
    if (!is_file($fichier) || (time() - filemtime($fichier)) >= $ttl) {
        return null;
    }

    $data = json_decode((string) file_get_contents($fichier), true);

    return is_array($data) ? $data : null;
}
