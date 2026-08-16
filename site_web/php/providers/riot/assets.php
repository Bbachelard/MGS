<?php
declare(strict_types=1);

/* ==================================================================
 *  providers/riot/assets.php — Data Dragon (noms de champions, objets,
 *  sorts, runes) et URL de base des images.
 *
 *  Aucune clé d'API n'est nécessaire ici. Tout est mis en cache 24 h :
 *  ces tables ne changent qu'à chaque patch.
 * ================================================================== */


/** Dernière version Data Dragon, mise en cache 24 h (aucune clé requise). */
function riot_ddragon_version(): string
{
    static $version = null;

    if ($version !== null) {
        return $version;
    }

    $cache = sys_get_temp_dir() . '/mgs_ddragon_version.txt';

    if (is_file($cache) && (time() - filemtime($cache)) < 86400) {
        return $version = trim((string)file_get_contents($cache));
    }

    $list = mgs_http_get_json('https://ddragon.leagueoflegends.com/api/versions.json');
    $version = $list[0] ?? '15.1.1';

    @file_put_contents($cache, $version);

    return $version;
}

/** Map championId => nom, mise en cache 24 h. */
function riot_champion_names(): array
{
    static $names = null;

    if ($names !== null) {
        return $names;
    }

    $cache = sys_get_temp_dir() . '/mgs_ddragon_champions.json';

    if (is_file($cache) && (time() - filemtime($cache)) < 86400) {
        $cached = json_decode((string)file_get_contents($cache), true);
        if (is_array($cached)) {
            return $names = $cached;
        }
    }

    $version = riot_ddragon_version();
    $data    = mgs_http_get_json("https://ddragon.leagueoflegends.com/cdn/{$version}/data/fr_FR/champion.json");

    $names = [];
    foreach ($data['data'] ?? [] as $champion) {
        $names[(int)$champion['key']] = $champion['name'];
    }

    @file_put_contents($cache, json_encode($names));

    return $names;
}

/**
 * Petit cache disque générique pour les catalogues Data Dragon.
 * Un fichier par catalogue dans le dossier temporaire, régénéré toutes les 24 h.
 */
function riot_ddragon_cache(string $cle, callable $builder, int $ttl = 86400): array
{
    static $memo = [];

    if (isset($memo[$cle])) {
        return $memo[$cle];
    }

    $fichier = sys_get_temp_dir() . '/mgs_ddragon_' . $cle . '.json';

    if (is_file($fichier) && (time() - filemtime($fichier)) < $ttl) {
        $data = json_decode((string)file_get_contents($fichier), true);
        if (is_array($data) && $data !== []) {
            return $memo[$cle] = $data;
        }
    }

    $data = $builder();

    if ($data !== []) {
        @file_put_contents($fichier, json_encode($data, JSON_UNESCAPED_UNICODE));
    }

    return $memo[$cle] = $data;
}

/**
 * championId -> clé d'asset Data Dragon ("MonkeyKing", "Leblanc"...).
 * On ne se fie PAS au championName de match-v5 : quelques champions ont un
 * nom d'API qui ne correspond pas au nom de fichier de l'icône.
 */
function riot_champion_keys(): array
{
    return riot_ddragon_cache('champion_keys', function (): array {
        $version = riot_ddragon_version();
        $data    = mgs_http_get_json("https://ddragon.leagueoflegends.com/cdn/{$version}/data/fr_FR/champion.json");

        $keys = [];
        foreach ($data['data'] ?? [] as $champion) {
            $keys[(int)$champion['key']] = (string)$champion['id'];
        }

        return $keys;
    });
}

/** itemId -> nom français. Sert aux infobulles des items. */
function riot_item_names(): array
{
    return riot_ddragon_cache('items', function (): array {
        $version = riot_ddragon_version();
        $data    = mgs_http_get_json("https://ddragon.leagueoflegends.com/cdn/{$version}/data/fr_FR/item.json");

        $noms = [];
        foreach ($data['data'] ?? [] as $id => $item) {
            $noms[(int)$id] = (string)($item['name'] ?? '');
        }

        return $noms;
    });
}

/** summonerSpellId -> ['key' => 'SummonerFlash', 'name' => 'Saut éclair']. */
function riot_summoner_spells(): array
{
    return riot_ddragon_cache('spells', function (): array {
        $version = riot_ddragon_version();
        $data    = mgs_http_get_json("https://ddragon.leagueoflegends.com/cdn/{$version}/data/fr_FR/summoner.json");

        $spells = [];
        foreach ($data['data'] ?? [] as $spell) {
            $spells[(int)$spell['key']] = [
                'key'  => (string)($spell['id'] ?? ''),
                'name' => (string)($spell['name'] ?? ''),
            ];
        }

        return $spells;
    });
}

/**
 * perkId (rune-clé ou style) -> ['icon' => 'perk-images/...png', 'name' => '...'].
 * Attention : les icônes de runes sont servies SANS numéro de version.
 */
function riot_perk_icons(): array
{
    return riot_ddragon_cache('perks', function (): array {
        $data = mgs_http_get_json('https://ddragon.leagueoflegends.com/cdn/15.1.1/data/fr_FR/runesReforged.json');

        $perks = [];

        foreach ($data ?? [] as $style) {
            $perks[(int)($style['id'] ?? 0)] = [
                'icon' => (string)($style['icon'] ?? ''),
                'name' => (string)($style['name'] ?? ''),
            ];

            foreach ($style['slots'] ?? [] as $slot) {
                foreach ($slot['runes'] ?? [] as $rune) {
                    $perks[(int)($rune['id'] ?? 0)] = [
                        'icon' => (string)($rune['icon'] ?? ''),
                        'name' => (string)($rune['name'] ?? ''),
                    ];
                }
            }
        }

        return $perks;
    });
}

/** Bases d'URL du CDN, envoyées une fois au front qui construit les liens lui-même. */
function riot_assets(): array
{
    $version = riot_ddragon_version();
    $cdn     = 'https://ddragon.leagueoflegends.com/cdn';

    return [
        'version'  => $version,
        'champion' => "{$cdn}/{$version}/img/champion/",
        'item'     => "{$cdn}/{$version}/img/item/",
        'spell'    => "{$cdn}/{$version}/img/spell/",
        'perk'     => "{$cdn}/img/",
    ];
}
