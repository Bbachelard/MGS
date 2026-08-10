<?php
$c = require __DIR__ . '/config.php';
var_dump(array_keys($c['PLATFORMS'] ?? []));
var_dump(array_map('strlen', $c['PLATFORMS']['epic'] ?? []));