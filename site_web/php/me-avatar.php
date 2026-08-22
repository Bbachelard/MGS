<?php
declare(strict_types=1);

/**
 * php/me-avatar.php — la photo de profil Steam de l'utilisateur connecté.
 *
 *   GET /php/me-avatar.php   ->  { "avatar": "https://…jpg" | null }
 *
 * Volontairement minimal : pas de session tierce, pas de choix de compte —
 * uniquement TON compte Steam principal, celui affiché dans la navbar sur
 * toutes les pages tant que tu es connecté. Répond toujours 200, avatar à
 * null si rien n'est lié : la navbar retombe alors sur l'icône par défaut.
 */

require_once __DIR__ . '/core/bootstrap.php';
require_once __DIR__ . '/core/cache.php';
require_once __DIR__ . '/links-model.php';

mgs_json_header();

const MGS_AVATAR_CACHE_TTL = 600;   // 10 minutes, comme api.php

$userId = mgs_user_id();

if ($userId === null) {
    mgs_json(['avatar' => null]);
}

$steamId = mgs_get_primary_account($conn, $userId, 'steam');

if ($steamId === null) {
    mgs_json(['avatar' => null]);
}

$cacheFile = mgs_cache_file('avatar', 'steam', [$steamId]);
mgs_cache_serve($cacheFile, MGS_AVATAR_CACHE_TTL);

mgs_load_provider('steam');
$avatar = steam_fetch_avatar(mgs_platform_config('steam'), $steamId);

mgs_cache_store_and_send($cacheFile, mgs_json_encode(['avatar' => $avatar]));
