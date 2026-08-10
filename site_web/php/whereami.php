<?php
declare(strict_types=1);

header('Content-Type: text/plain; charset=utf-8');

echo "fichier   : " . __FILE__ . "\n";
echo "config    : " . realpath(__DIR__ . '/../config.php') . "\n";
echo "php       : " . PHP_VERSION . "\n";
echo "user      : " . (function_exists('posix_getpwuid')
        ? posix_getpwuid(posix_geteuid())['name'] : get_current_user()) . "\n";

$config = require __DIR__ . '/../config.php';
$cfg    = $config['PLATFORMS']['epic'] ?? [];

foreach (['client_id', 'client_secret', 'deployment_id', 'redirect_uri'] as $k) {
    echo str_pad($k, 15) . ' len=' . strlen((string)($cfg[$k] ?? '')) . "\n";
}

$dir = __DIR__ . '/../cache';
echo "cache     : $dir — existe=" . (is_dir($dir) ? 'oui' : 'non')
   . " inscriptible=" . (is_writable($dir) ? 'oui' : 'non') . "\n";