<?php

session_start();

$_SESSION["logged"] = false;
$_SESSION["username"] = "";
header("Location: ../index.html"); 