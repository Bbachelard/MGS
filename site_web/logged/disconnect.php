<?php

session_start();

$_SESSION["logged"] = true;
$_SESSION["username"] = "";
header("Location: ../index.html"); 