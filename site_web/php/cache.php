<?php
declare(strict_types=1);

function mgs_cache_chemin(string $cle): string
{
    $dir = __DIR__ . '/../cache/api';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir . '/' . hash('sha256', $cle) . '.json';
}

function mgs_cache_get(string $cle, int $ttl): ?array
{
    $f = mgs_cache_chemin($cle);
    if (!is_file($f) || (time() - filemtime($f)) > $ttl) return null;
    $d = json_decode((string)file_get_contents($f), true);
    return is_array($d) ? $d : null;
}

function mgs_cache_set(string $cle, array $data): void
{
    @file_put_contents(mgs_cache_chemin($cle), json_encode($data), LOCK_EX);
}