<?php
declare(strict_types=1);

mysqli_report(MYSQLI_REPORT_OFF);          // évite le fatal si la base n'est pas joignable en CLI

$path   = __DIR__ . '/../config.php';
$config = require $path;
$cfg    = $config['PLATFORMS']['epic'] ?? [];

echo "config lu : $path\n";
foreach (['client_id', 'client_secret', 'deployment_id', 'redirect_uri', 'scope'] as $k) {
    $v = (string)($cfg[$k] ?? '');
    echo str_pad($k, 15) . ' len=' . strlen($v)
       . ($k === 'redirect_uri' || $k === 'scope' ? " [$v]" : '') . "\n";
}

$ch = curl_init('https://api.epicgames.dev/epic/oauth/v2/token');
curl_setopt_array($ch, [
    CURLOPT_POST       => true,
    CURLOPT_POSTFIELDS => http_build_query([
        'grant_type'    => 'client_credentials',
        'deployment_id' => (string)($cfg['deployment_id'] ?? ''),
    ]),
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/x-www-form-urlencoded',
        'Authorization: Basic ' . base64_encode(
            (string)($cfg['client_id'] ?? '') . ':' . (string)($cfg['client_secret'] ?? '')
        ),
    ],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 10,
]);

$body = curl_exec($ch);
echo "\nHTTP " . curl_getinfo($ch, CURLINFO_HTTP_CODE) . "\n";
echo 'curl : ' . (curl_error($ch) ?: 'ok') . "\n";
echo substr((string)$body, 0, 600) . "\n";
curl_close($ch);