// ===========================================================================
//  client.js — tout ce qui tourne dans le navigateur.
//
//  Le client ne décide de RIEN : c'est le serveur qui fait autorité. Mais si
//  on attendait bêtement la réponse du serveur pour bouger, on sentirait la
//  latence à chaque clic (~50 à 200 ms de mou). D'où les 3 techniques
//  classiques, toutes présentes ici :
//
//   1. PRÉDICTION       : je bouge tout de suite chez moi, sans attendre.
//   2. RÉCONCILIATION   : quand la vraie position arrive, je la reprends et je
//                         rejoue les commandes que le serveur n'a pas encore
//                         traitées. Si j'avais bien deviné → rien ne bouge.
//   3. INTERPOLATION    : les AUTRES joueurs sont affichés 100 ms dans le
//                         passé, entre deux snapshots. On perd 100 ms mais on
//                         gagne un mouvement parfaitement fluide.
//
//  Ce qui a été ajouté au combat : le tir, les dégâts, la mort, les soins, le
//  flash et l'ulti ne sont JAMAIS calculés ici. Le client envoie « je vise
//  là », « je vais là » ou « je tire », le serveur répond « voilà ce qui
//  s'est passé ». C'est la seule façon de ne pas offrir l'arène au premier
//  venu qui ouvre la console.
// ===========================================================================

import {
  PAS_CLIENT,
  PV_MAX,
  ULTI_MAX,
  FLASH_RECHARGE,
  ZONE_RECHARGE,
  ZONE_RALENTI,
  KILLS_PAR_PALIER,
  cadenceDe,
  degatsDe,
  simuler,
} from "./shared.js";
import { dessiner, camera } from "./rendu.js";
import * as sprites from "./sprites.js";
import * as sons from "./sons.js";

// --- éléments de la page -------------------------------------------------
const canvas    = document.getElementById("jeu");
const ctx       = canvas.getContext("2d");
const accueil   = document.getElementById("accueil");
const champNom  = document.getElementById("nom");
const choixPerso= document.getElementById("choixPerso");
const hud       = document.getElementById("hud");
const tableau   = document.getElementById("tableau");
const corpsScore= document.getElementById("corpsScore");
const fil       = document.getElementById("fil");
const barrePv   = document.getElementById("barrePv");
const texteePv  = document.getElementById("textePv");
const barreUlti = document.getElementById("barreUlti");
const texteUlti = document.getElementById("texteUlti");
const barreFlash= document.getElementById("barreFlash");
const texteFlash= document.getElementById("texteFlash");
const barreZone = document.getElementById("barreZone");
const texteZone = document.getElementById("texteZone");
const jauges    = document.getElementById("jauges");
const arme      = document.getElementById("arme");
const panneau   = document.getElementById("panneau");
const restePalier = document.getElementById("restePalier");
const banniereSerie = document.getElementById("banniereSerie");
const repriseSouris = document.getElementById("repriseSouris");

// --- bots ------------------------------------------------------------------
const difficulteBots   = document.getElementById("difficulteBots");
const botsCompteEl     = document.getElementById("botsCompte");
const botsMoins        = document.getElementById("botsMoins");
const botsPlus         = document.getElementById("botsPlus");
const difficulteBotsPanneau = document.getElementById("difficulteBotsPanneau");
const ajouterBotPanneau     = document.getElementById("ajouterBotPanneau");
const retirerBotPanneau     = document.getElementById("retirerBotPanneau");
const compteBotsEl          = document.getElementById("compteBots");
const annoncesSerieCase     = document.getElementById("annoncesSerie");

// --- réglages (panneau) ---------------------------------------------------
const boutonReglages  = document.getElementById("boutonReglages");
const reglages        = document.getElementById("reglages");
const fermerReglages  = document.getElementById("fermerReglages");
const reinitReglages  = document.getElementById("reinitReglages");
const sensibiliteRange= document.getElementById("sensibilite");
const sensibiliteValeur = document.getElementById("sensibiliteValeur");
const boutonsTouches  = [...document.querySelectorAll(".toucheBouton")];

// --- paramètres d'URL ----------------------------------------------------
// Le site MGS ouvre le jeu avec ?nom=<pseudo>&salon=mgs : le joueur connecté
// n'a plus qu'à cliquer.
const params = new URLSearchParams(location.search);
const salon  = params.get("salon") || "principal";

// Photo de profil Steam transmise par le site (?avatar=…) : source du skin
// "steam" ci-dessous. Un contrôle minimal ici (le serveur revalide de toute
// façon avant de la rediffuser aux autres joueurs) évite juste d'afficher
// n'importe quoi dans SON PROPRE sélecteur si l'URL est bidouillée.
const avatarSteamBrut = (params.get("avatar") || "").trim();
const avatarSteam = /^https:\/\//i.test(avatarSteamBrut) ? avatarSteamBrut : "";

// --- état du client ------------------------------------------------------
let ws          = null;
let monId       = null;
let monPerso    = { x: 0, y: 0 };  // position prédite
let precedent   = { x: 0, y: 0 };  // position au pas précédent (pour lisser)
let seq         = 0;               // numéro de la prochaine commande
let enAttente   = [];              // commandes envoyées, pas encore confirmées
let snapshots   = [];              // historique des états reçus
let ping        = 0;
let horloge     = null;
let gel         = null;            // pause temporelle en cours (ou null)
let moiServeur  = null;            // ma ligne dans le dernier snapshot
let persoChoisi = "defaut";
let dernierScore = 0;
let dernierSnapshotJoueurs = []; // le dernier msg.joueurs reçu — sert au compte de bots (panneau ⚙)

const RETARD = 100; // ms — de combien on affiche les autres dans le passé

// Couleur et son de chaque palier de série de kills — le SEUIL et le LIBELLÉ,
// eux, viennent du serveur (voir FENETRE_MULTIKILL et NOMS_SERIE dans
// shared.js) : ici, seulement de quoi les habiller à l'écran et à l'oreille.
const SERIES_KILL = {
  2: { son: "double-kill", couleur: "#38bdf8" },
  3: { son: "triple-kill", couleur: "#c084fc" },
  4: { son: "quadra-kill", couleur: "#fb923c" },
  5: { son: "penta-kill",  couleur: "#f472b6" },
};

// Le curseur affiché à l'écran n'est PAS le pointeur du système (il est
// caché par le CSS, `cursor: none`) : c'est un viseur virtuel, déplacé par
// les DÉPLACEMENTS relatifs de la souris, multipliés par la sensibilité.
// C'est ce qui rend le réglage de sensibilité réel : la souris du système
// n'apparaît jamais, seul ce viseur compte, pour viser comme pour cliquer.
const souris = { x: 0, y: 0 };
let angle = 0;
let tirEnCours = false;

// Le point cliqué (déplacement) — en coordonnées MONDE, ou null si on est
// arrivé / si on n'a encore rien cliqué. Envoyé dans chaque commande, comme
// l'étaient les touches avant : c'est ce qui rend la prédiction et la
// réconciliation possibles avec le clic-déplacement aussi.
let cible = null;
let encliquant = false; // le clic droit est maintenu : on suit la souris
let monRalenti = 0; // secondes restantes sous l'effet d'une zone ennemie (prédit)

// Effets visuels ÉPHÉMÈRES (ping de clic, éclat de flash) : purement
// cosmétiques, jamais envoyés au serveur. Les zones de ralentissement, elles,
// viennent du serveur (`zones`, plus bas) — ce ne sont pas des effets mais un
// vrai état de jeu.
let effets = [];

/* ==========================================================================
   Touches et sensibilité — réglables, mémorisés dans le navigateur
   ========================================================================== */

const TOUCHES_DEFAUT = {
  tirer:   "KeyA",
  flash:   "KeyE",
  ulti:    "KeyR",
  zone:    "KeyZ",
  tableau: "Tab",
  son:     "KeyM",
};

function chargerTouches() {
  try {
    const brut = JSON.parse(localStorage.getItem("arene-touches"));
    if (!brut || typeof brut !== "object") return { ...TOUCHES_DEFAUT };
    const fusion = { ...TOUCHES_DEFAUT };
    for (const action of Object.keys(TOUCHES_DEFAUT)) {
      if (typeof brut[action] === "string" && brut[action]) fusion[action] = brut[action];
    }
    return fusion;
  } catch {
    return { ...TOUCHES_DEFAUT }; // navigation privée, ou valeur corrompue
  }
}

function sauverTouches() {
  try { localStorage.setItem("arene-touches", JSON.stringify(touches)); } catch { /* navigation privée */ }
}

function chargerSensibilite() {
  const v = Number(localStorage.getItem("arene-sensibilite"));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

function sauverSensibilite() {
  try { localStorage.setItem("arene-sensibilite", String(sensibilite)); } catch { /* navigation privée */ }
}

// La bannière et le son de série de kills se coupent indépendamment du son
// général : certains joueurs aiment le jeu mais trouvent l'annonce criarde.
function chargerAnnoncesSerie() {
  try {
    const brut = localStorage.getItem("arene-annonces-serie");
    return brut === null ? true : brut === "1"; // activé par défaut
  } catch {
    return true;
  }
}

function sauverAnnoncesSerie() {
  try { localStorage.setItem("arene-annonces-serie", annoncesSerie ? "1" : "0"); } catch { /* navigation privée */ }
}

let touches     = chargerTouches();
let sensibilite = chargerSensibilite();
let annoncesSerie = chargerAnnoncesSerie();

/** Le nom lisible d'une touche (`e.code`), pour l'afficher dans le HUD. */
function labelTouche(code) {
  if (!code) return "?";
  if (code.startsWith("Key"))   return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const NOMS = {
    Space: "Espace", Tab: "Tab",
    ShiftLeft: "Maj", ShiftRight: "Maj",
    ControlLeft: "Ctrl", ControlRight: "Ctrl",
    AltLeft: "Alt", AltRight: "Alt",
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  };
  return NOMS[code] || code;
}

/* ==========================================================================
   Entrées — tir, flash, ulti au clavier ; déplacement au clic
   ========================================================================== */

addEventListener("keydown", (e) => {
  // Échap : LA sortie de secours. Rien d'autre au clavier ne permettait de
  // reprendre la main une fois entré dans l'arène — le panneau de réglages,
  // lui, n'a pas `cursor: none` et rend donc la souris immédiatement visible
  // et libre. Avant tout autre test : elle doit marcher quel que soit le
  // focus, et même verrouillée sur une touche en cours de remappage — mais
  // dans ce cas le capteur de remappage (plus bas) intercepte l'événement
  // en premier et coupe sa propagation, donc on n'arrive jamais ici.
  if (e.code === "Escape") {
    if (reglages.hidden) ouvrirReglages(); else fermerLeReglages();
    e.preventDefault();
    return;
  }

  if (!reglages.hidden) return; // le panneau de réglages est ouvert : on ne joue pas
  if (document.activeElement instanceof HTMLInputElement) return; // on tape son pseudo

  // Maj+A / Maj+Z choisissent directement l'amélioration proposée, sans avoir
  // à cliquer sur le panneau — pratique en plein combat. Touches FIXES,
  // indépendantes du remappage : comme la position des boutons à l'écran.
  if (e.shiftKey && !panneau.hidden) {
    if (e.code === "KeyA") { choisir("cadence"); e.preventDefault(); return; }
    if (e.code === "KeyZ") { choisir("degats"); e.preventDefault(); return; }
  }

  if (e.code === touches.tirer)   { appuyerTir(); e.preventDefault(); return; }
  if (e.code === touches.flash)   { if (!e.repeat) demanderFlash(); e.preventDefault(); return; }
  if (e.code === touches.ulti)    { if (!e.repeat) demanderUlti(); e.preventDefault(); return; }
  if (e.code === touches.zone)    { if (!e.repeat) demanderZone(); e.preventDefault(); return; }
  if (e.code === touches.tableau) { tableau.classList.add("grand"); e.preventDefault(); return; }
  if (e.code === touches.son)     { basculerSon(); return; }
});

addEventListener("keyup", (e) => {
  if (e.code === touches.tirer)   { tirEnCours = false; e.preventDefault(); return; }
  if (e.code === touches.tableau) { tableau.classList.remove("grand"); e.preventDefault(); return; }
});

// Si on change d'onglet, on relâche tout (sinon on tire ou on suit la souris
// tout seul en revenant).
addEventListener("blur", () => {
  tirEnCours = false;
  encliquant = false;
});

// Le curseur système ne sert plus à rien (il est caché) : on avance le
// viseur virtuel par petits pas, à la vitesse de la souris physique fois la
// sensibilité réglée. C'est ce qui rend le réglage de sensibilité réel, y
// compris pour le clic-déplacement, qui vise ce même point.
addEventListener("mousemove", (e) => {
  souris.x = Math.max(0, Math.min(vue.l, souris.x + e.movementX * sensibilite));
  souris.y = Math.max(0, Math.min(vue.h, souris.y + e.movementY * sensibilite));
});

// Le jeu est affiché dans une iframe sur my-gamers-stats.com : sans clic, le
// clavier va à la page parente. Un clic n'importe où rend la main au jeu.
addEventListener("mousedown", (e) => {
  if (accueil.hidden) window.focus();

  // Clic DROIT = déplacement, à la manière d'un MOBA. On ignore le clic
  // avant d'être en jeu, pendant le gel (le serveur l'ignorerait de toute
  // façon) et par-dessus le panneau de réglages.
  if (e.button === 2 && accueil.hidden && reglages.hidden && !gel) {
    encliquant = true;
    cible = { x: camera.x + souris.x, y: camera.y + souris.y };
    // Le ping visuel façon LoL : purement local, aucun aller-retour serveur
    // à attendre pour le voir apparaître.
    effets.push({ type: "clic", x: cible.x, y: cible.y, debut: performance.now() });
  }
});
addEventListener("mouseup", (e) => {
  if (e.button === 2) encliquant = false;
});
// Le clic droit fait tout le travail désormais : le menu du navigateur n'a
// rien à faire là, pour ne pas interrompre une partie sur un clic maladroit.
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

/* ==========================================================================
   Verrouillage du curseur (Pointer Lock)

   Avant ceci, le curseur SYSTÈME restait libre (juste invisible via
   `cursor: none`) : rien n'empêchait de sortir de l'iframe, voire de
   l'écran, pendant qu'on jouait. Le viseur virtuel, lui, reste bloqué aux
   bords du canvas (voir mousemove plus haut) — les deux se désynchronisent
   alors complètement, avec des sauts de visée dès qu'on rentre. Verrouiller
   le curseur sur le canvas règle les deux à la fois : la souris SYSTÈME ne
   peut plus sortir du jeu, et seul Échap (comportement du navigateur, pas du
   code ci-dessous) la libère.

   Les navigateurs sans Pointer Lock (rare) continuent de fonctionner
   exactement comme avant : `canvas.requestPointerLock` est alors absent, et
   chaque appel est protégé par `?.()`.
   ========================================================================== */

function verrouille() {
  return document.pointerLockElement === canvas;
}

function majEtatVerrouillage() {
  // Le bouton ⚙ suppose un vrai curseur cliquable : verrouillé, un clic
  // dessus ne peut plus arriver (la souris système ne bouge plus). On le
  // masque plutôt que de laisser un bouton mort à l'écran — Échap reste,
  // dans tous les cas, le seul chemin documenté vers les réglages en jeu.
  boutonReglages.hidden = verrouille();

  // La reprise ne s'affiche qu'en pleine partie : ni sur l'écran d'accueil
  // (pas encore de verrou à reprendre), ni par-dessus le panneau de
  // réglages (déjà ouvert, déjà une façon de « reprendre la main »).
  const doitAfficher = !verrouille() && accueil.hidden && reglages.hidden;
  repriseSouris.hidden = !doitAfficher;
}

document.addEventListener("pointerlockchange", majEtatVerrouillage);
document.addEventListener("pointerlockerror", majEtatVerrouillage);

repriseSouris.addEventListener("click", () => {
  canvas.requestPointerLock?.().catch(() => {});
});

// Tactile : un doigt vise, tire, ET déplace (pas de clavier sur mobile).
canvas.addEventListener("touchstart", (e) => {
  const t = e.touches[0];
  souris.x = t.clientX;
  souris.y = t.clientY;
  if (!gel) cible = { x: camera.x + souris.x, y: camera.y + souris.y };
  appuyerTir();
  e.preventDefault();
}, { passive: false });
canvas.addEventListener("touchmove", (e) => {
  const t = e.touches[0];
  souris.x = t.clientX;
  souris.y = t.clientY;
  e.preventDefault();
}, { passive: false });
canvas.addEventListener("touchend", () => { tirEnCours = false; });

function envoyer(objet) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(objet));
}

function demanderUlti() {
  // Le client demande, le serveur vérifie la charge. Envoyer ce message à
  // 100 par seconde ne donne pas 100 ultis.
  envoyer({ t: "ulti" });
}

function demanderFlash() {
  // Même principe : le serveur vérifie seul la recharge et calcule
  // l'arrivée. Le client ne fait que demander.
  envoyer({ t: "flash" });
}

/* ==========================================================================
   Bots — n'importe quel joueur peut en ajouter dans le salon où il se trouve
   ou en retirer ; le serveur décide seul du plafond et du comportement
   (voir server/salle.js). Le client ne fait que demander.
   ========================================================================== */

function ajouterBot(difficulte) {
  envoyer({ t: "bot", action: "ajouter", difficulte });
}

function retirerBot() {
  envoyer({ t: "bot", action: "retirer" });
}

// Compte les bots à ajouter dès l'entrée dans l'arène, choisi avant de
// cliquer sur « Entrer dans l'arène ».
let botsAEnvoyer = 0;
const BOTS_MAX_ACCUEIL = 5;

function majBotsCompteAccueil() {
  botsCompteEl.textContent = String(botsAEnvoyer);
}
botsMoins.addEventListener("click", () => {
  botsAEnvoyer = Math.max(0, botsAEnvoyer - 1);
  majBotsCompteAccueil();
});
botsPlus.addEventListener("click", () => {
  botsAEnvoyer = Math.min(BOTS_MAX_ACCUEIL, botsAEnvoyer + 1);
  majBotsCompteAccueil();
});

// Panneau de réglages, en jeu : ajouter/retirer un bot à la volée.
ajouterBotPanneau.addEventListener("click", () => ajouterBot(difficulteBotsPanneau.value));
retirerBotPanneau.addEventListener("click", () => retirerBot());

function majCompteBots() {
  const n = dernierSnapshotJoueurs.filter((j) => j.ia).length;
  compteBotsEl.textContent = n <= 1 ? `${n} bot dans ce salon` : `${n} bots dans ce salon`;
}

function demanderZone() {
  // Contrairement au flash (direction seule), la zone a besoin d'un POINT :
  // le serveur borne la distance à ZONE_PORTEE et recule le point s'il tombe
  // dans un mur, exactement comme pour le rayon d'ulti.
  envoyer({ t: "zone", x: camera.x + souris.x, y: camera.y + souris.y });
}

/**
 * La touche de tir fait deux choses selon le moment : tirer normalement, ou
 * déclencher le rayon de l'ulti pendant sa propre pause temporelle. Une seule
 * touche à retenir, c'est mieux.
 */
function appuyerTir() {
  if (gel && gel.par === monId && !gel.ray) {
    envoyer({ t: "ultiTir" });
    return;
  }
  tirEnCours = true;
}

let sonCoupe = false;
function basculerSon() {
  sonCoupe = !sonCoupe;
  sons.couper(sonCoupe);
  document.getElementById("etatSon").textContent = sonCoupe ? `son coupé (${labelTouche(touches.son)})` : `son (${labelTouche(touches.son)})`;
}

/* ==========================================================================
   Panneau de réglages : touches et sensibilité
   ========================================================================== */

function majBoutonsTouches() {
  for (const bouton of boutonsTouches) {
    bouton.textContent = labelTouche(touches[bouton.dataset.action]);
    bouton.classList.remove("ecoute");
  }
}

let ecouteur = null; // la fonction en train d'attendre une touche à réassigner

function annulerEcoute() {
  if (ecouteur) {
    removeEventListener("keydown", ecouteur, true);
    ecouteur = null;
  }
  for (const bouton of boutonsTouches) bouton.classList.remove("ecoute");
}

for (const bouton of boutonsTouches) {
  bouton.addEventListener("click", () => {
    annulerEcoute();
    bouton.classList.add("ecoute");
    bouton.textContent = "…";

    // Capture, pas bouillonnement : on veut cette touche AVANT qu'elle
    // n'atteigne le jeu (sinon appuyer sur « R » pour réassigner l'ulti
    // déclencherait l'ulti au passage).
    ecouteur = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== "Escape") {
        touches[bouton.dataset.action] = e.code;
        sauverTouches();
      }
      annulerEcoute();
      majBoutonsTouches();
    };
    addEventListener("keydown", ecouteur, true);
  });
}

function ouvrirReglages() {
  majBoutonsTouches();
  sensibiliteRange.value = sensibilite;
  sensibiliteValeur.textContent = sensibilite.toFixed(1) + "×";
  annoncesSerieCase.checked = annoncesSerie;
  majCompteBots();
  reglages.hidden = false;
  majEtatVerrouillage();
}

function fermerLeReglages() {
  reglages.hidden = true;
  annulerEcoute();
  sensibiliteRange.blur();
  // On était en jeu (pas sur l'écran d'accueil) : la souris redevient
  // capturée, comme avant l'ouverture du panneau. Un clic bouton — donc un
  // geste utilisateur — juste avant, c'est ce qui autorise le navigateur à
  // reverrouiller le curseur ici. Si le navigateur refuse (cooldown juste
  // après un Échap), la bannière de reprise prend le relais.
  if (accueil.hidden) canvas.requestPointerLock?.().catch(() => {});
  majEtatVerrouillage();
}

boutonReglages.addEventListener("click", ouvrirReglages);
fermerReglages.addEventListener("click", fermerLeReglages);
reglages.addEventListener("click", (e) => { if (e.target === reglages) fermerLeReglages(); });

reinitReglages.addEventListener("click", () => {
  touches = { ...TOUCHES_DEFAUT };
  sauverTouches();
  sensibilite = 1;
  sauverSensibilite();
  majBoutonsTouches();
  sensibiliteRange.value = 1;
  sensibiliteValeur.textContent = "1.0×";
  annoncesSerie = true;
  sauverAnnoncesSerie();
  annoncesSerieCase.checked = true;
});

sensibiliteRange.addEventListener("input", () => {
  sensibilite = Number(sensibiliteRange.value) || 1;
  sensibiliteValeur.textContent = sensibilite.toFixed(1) + "×";
  sauverSensibilite();
});

annoncesSerieCase.addEventListener("change", () => {
  annoncesSerie = annoncesSerieCase.checked;
  sauverAnnoncesSerie();
});

/* ==========================================================================
   Taille du canvas
   ========================================================================== */

let vue = { l: 0, h: 0 };
function redimensionner() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const premierAppel = vue.l === 0;

  vue = { l: innerWidth, h: innerHeight };
  canvas.width  = vue.l * dpr;
  canvas.height = vue.h * dpr;
  canvas.style.width  = vue.l + "px";
  canvas.style.height = vue.h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Le viseur virtuel démarre au centre de l'écran ; un redimensionnement
  // ultérieur se contente de le garder dans le cadre.
  if (premierAppel) {
    souris.x = vue.l / 2;
    souris.y = vue.h / 2;
  } else {
    souris.x = Math.min(souris.x, vue.l);
    souris.y = Math.min(souris.y, vue.h);
  }
}
addEventListener("resize", redimensionner);
redimensionner();

/* ==========================================================================
   Connexion
   ========================================================================== */

function connecter(nom) {
  const proto = location.protocol === "https:" ? "wss" : "ws";

  // L'adresse du WebSocket est construite RELATIVEMENT à la page, jamais en
  // dur. En local le jeu est servi à la racine (`/` → `/ws`) ; sur le VPS,
  // Apache le passe sous `/jeu/` (`/jeu/` → `/jeu/ws`).
  const base = location.pathname.replace(/[^/]*$/, "");
  const url =
    `${proto}://${location.host}${base}ws` +
    `?nom=${encodeURIComponent(nom)}` +
    `&salon=${encodeURIComponent(salon)}` +
    `&perso=${encodeURIComponent(persoChoisi)}` +
    (persoChoisi === "steam" && avatarSteam ? `&avatar=${encodeURIComponent(avatarSteam)}` : "");

  ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    const e = document.getElementById("etatCo");
    e.textContent = "connecté";
    e.className = "";
    horloge = setInterval(() => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ t: "ping", t0: Date.now() }));
    }, 2000);
  });

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.t === "init") {
      monId = msg.moi;
      accueil.hidden = true;
      hud.hidden = false;
      tableau.hidden = false;
      jauges.hidden = false;

      // Les bots choisis avant d'entrer : une demande par bot, comme le
      // ferait un clic répété sur « + Ajouter » du panneau de réglages.
      for (let i = 0; i < botsAEnvoyer; i++) ajouterBot(difficulteBots.value);

      requestAnimationFrame(boucle);

    } else if (msg.t === "etat") {
      snapshots.push({ t: performance.now(), joueurs: msg.joueurs, pr: msg.pr || [] });
      if (snapshots.length > 40) snapshots.shift();

      gel = msg.g || null;
      derniersSoins = msg.so || [];
      derniersBoucliers = msg.bo || [];
      meteorites = msg.mt || [];
      zones = msg.zo || [];
      dernierSnapshotJoueurs = msg.joueurs;
      reconcilier(msg.joueurs);
      if (msg.ev) traiterEvenements(msg.ev);

      document.getElementById("nbJoueurs").textContent = msg.joueurs.length;
      document.getElementById("tick").textContent = msg.tick;
      majJauges();
      majTableau(msg.joueurs);
      if (!reglages.hidden) majCompteBots();

    } else if (msg.t === "pong") {
      ping = Date.now() - msg.t0;
      document.getElementById("ping").textContent = ping;
    }
  });

  ws.addEventListener("close", () => {
    if (horloge) { clearInterval(horloge); horloge = null; }
    const e = document.getElementById("etatCo");
    e.textContent = "déconnecté — recharge la page";
    e.className = "ko";
  });
}

let derniersSoins = [];
let derniersBoucliers = [];
let meteorites = [];
let zones = [];

// Le dernier moment (performance.now()) où chaque joueur a été touché : sert
// au flash bref sur son sprite (voir rendu.js#joueurs). Un id -> un seul
// timestamp, purgé au fil de l'eau dans afficher() plutôt que d'accumuler
// indéfiniment sur une longue partie.
let dernieresTouches = new Map();
// Doit rester égal à DUREE_TOUCHE_FX dans rendu.js : c'est là que le flash
// est réellement dessiné, ici on ne fait que savoir quand l'oublier.
const DUREE_TOUCHE_FX = 260; // ms

/**
 * Un jeu de petites gouttes, tirées au sort une seule fois par éclaboussure :
 * les retirer au sort à chaque frame ferait scintiller l'effet au lieu de le
 * laisser s'estomper proprement.
 */
function fabriquerGouttes() {
  const gouttes = [];
  const n = 5 + Math.floor(Math.random() * 3); // 5 à 7
  for (let i = 0; i < n; i++) {
    gouttes.push({
      a: Math.random() * Math.PI * 2,
      d: 6 + Math.random() * 16,
      r: 2 + Math.random() * 3,
    });
  }
  return gouttes;
}

/* ==========================================================================
   Réconciliation
   ========================================================================== */

function reconcilier(joueurs) {
  const moi = joueurs.find((j) => j.i === monId);
  if (!moi) return;

  moiServeur = moi;

  monPerso.x = moi.x;
  monPerso.y = moi.y;
  // Juste besoin de savoir SI on est ralenti : ce petit crédit se consomme
  // en quelques pas côté client (voir pasClient) et se retend à chaque
  // snapshot tant que le serveur continue de dire `rl`.
  if (moi.rl) monRalenti = 0.3;

  enAttente = enAttente.filter((c) => c.seq > moi.s);

  // Pendant le gel, le serveur n'applique rien : rejouer localement nous
  // ferait avancer tout seul, puis reculer au tick suivant. Le facteur de
  // ralenti COURANT est appliqué à toute la file rejouée — une approximation
  // du même ordre que la légère élasticité déjà tolérée sur les collisions
  // entre joueurs (voir le README).
  const facteur = monRalenti > 0 ? ZONE_RALENTI : 1;
  if (!gel) for (const c of enAttente) simuler(monPerso, c.c, c.dt, facteur);

  precedent.x = monPerso.x;
  precedent.y = monPerso.y;
}

/* ==========================================================================
   Événements (sons + fil des éliminations)
   ========================================================================== */

function traiterEvenements(evenements) {
  for (const e of evenements) {
    switch (e.t) {
      case "tir":
      case "soin":
      case "ulti-tir":
      case "ulti-touche":
      case "ulti-rate":
        sons.jouer(e.t, volumeSelonDistance(e.x, e.y));
        break;

      // Le tir a fini sa course quelque part (mur ou joueur) : l'éclaboussure
      // apparaît toujours au point d'impact. "touche" en plus, garde le
      // joueur touché en mémoire pour le flash sur son sprite, et joue le son
      // "vitre" (voir sons.js) plutôt que celui, plus sourd, du mur.
      case "impact":
      case "touche":
        sons.jouer(e.t, volumeSelonDistance(e.x, e.y));
        effets.push({
          type: "caca-splash",
          x: e.x,
          y: e.y,
          debut: performance.now(),
          gouttes: fabriquerGouttes(),
        });
        if (e.t === "touche" && e.sur != null) {
          dernieresTouches.set(e.sur, performance.now());
        }
        break;

      case "flash":
        sons.jouer("flash", volumeSelonDistance(e.x, e.y));
        // L'éclat de téléportation : visible par tout le monde, à l'arrivée.
        effets.push({ type: "flash", x: e.x, y: e.y, debut: performance.now() });
        break;

      case "zone":
        sons.jouer("zone", volumeSelonDistance(e.x, e.y));
        ajouterAuFil(
          `🌀 ${e.nom} : champ de ralentissement`,
          e.par === monId ? "#db2777" : "#9292a3"
        );
        break;

      case "bouclier":
      case "bouclier-pris":
        sons.jouer("bouclier", volumeSelonDistance(e.x, e.y));
        break;

      // Une météorite naît hors du terrain : la distance ne veut rien dire,
      // et de toute façon tout le monde doit l'entendre arriver.
      case "meteorite":
        sons.jouer("meteorite", 0.9);
        ajouterAuFil("☄ météorite", "#ff9d3c");
        break;

      case "palier":
        if (e.sur === monId) {
          sons.jouer("palier", 1);
          ajouterAuFil("Arme améliorable — choisis en bas à gauche", "#fbbf24");
        }
        break;

      case "amelioration":
        if (e.sur === monId) sons.jouer("palier", 1);
        ajouterAuFil(
          `${e.nom} : arme ${e.choix === "cadence" ? "plus rapide" : "plus puissante"}`,
          e.sur === monId ? "#fbbf24" : "#9292a3"
        );
        break;

      case "ulti":
        sons.jouer("ulti", 1);
        ajouterAuFil(`⏸ ${e.nom} fige le temps`, "#9b83ff");
        break;

      // Double/Triple/Quadra/Penta Kill — le serveur a déjà décidé du seuil
      // et du libellé (voir FENETRE_MULTIKILL et NOMS_SERIE dans shared.js) :
      // le client ne fait qu'annoncer. Visible par TOUT LE MONDE dans le fil
      // (comme un vrai FPS compétitif), mais la grosse bannière + le son ne
      // jouent que pour l'auteur de la série, et seulement si l'annonce n'a
      // pas été coupée dans les réglages.
      case "multikill": {
        const infoSerie = SERIES_KILL[e.n];
        ajouterAuFil(`🔥 ${e.nom} : ${e.label}`, infoSerie ? infoSerie.couleur : "#fbbf24");
        if (annoncesSerie) {
          const volume = e.sur === monId ? 1 : volumeSelonDistance(e.x, e.y) * 0.6;
          sons.jouer(infoSerie ? infoSerie.son : "kill", volume);
          if (e.sur === monId) afficherBanniereSerie(e.label, infoSerie?.couleur);
        }
        break;
      }

      case "mort": {
        const jeMeurs = e.victime === monId;
        const jeTue = e.tueur === monId;

        if (jeTue) sons.jouer("kill", 1);
        if (jeMeurs) sons.jouer("mort", 1);
        if (!jeTue && !jeMeurs) sons.jouer("mort", volumeSelonDistance(e.x, e.y) * 0.5);

        const tueur = e.nomTueur || "l'arène";
        ajouterAuFil(`${tueur} ⇒ ${e.nomVictime}`, jeTue ? "#4ade80" : jeMeurs ? "#ff6b6b" : "#9292a3");
        break;
      }
    }
  }
}

// Un son lointain doit s'entendre moins fort : sans ça, une salle à 8 se
// transforme en vacarme permanent.
function volumeSelonDistance(x, y) {
  const d = Math.hypot(x - monPerso.x, y - monPerso.y);
  return Math.max(0.12, Math.min(1, 1 - d / 900));
}

function ajouterAuFil(texte, couleur) {
  const ligne = document.createElement("div");
  ligne.textContent = texte;
  ligne.style.color = couleur;
  fil.prepend(ligne);

  while (fil.childElementCount > 6) fil.lastElementChild.remove();
  setTimeout(() => ligne.remove(), 6000);
}

let banniereMinuteur = null;

/** La grande bannière "DOUBLE KILL" etc., façon LoL/Overwatch — nous seul la voyons. */
function afficherBanniereSerie(texte, couleur) {
  banniereSerie.style.setProperty("--couleurSerie", couleur || "#7c5cff");
  banniereSerie.textContent = texte;

  // Redémarrer l'animation CSS si une bannière est déjà en train de jouer
  // (série qui s'enchaîne vite) : retirer la classe, forcer un reflow, la
  // remettre — sinon le navigateur ignore la ré-application immédiate.
  banniereSerie.classList.remove("jouer");
  void banniereSerie.offsetWidth;
  banniereSerie.classList.add("jouer");

  clearTimeout(banniereMinuteur);
  banniereMinuteur = setTimeout(() => banniereSerie.classList.remove("jouer"), 1700);
}

/* ==========================================================================
   HUD : jauges et tableau des scores
   ========================================================================== */

function majJauges() {
  if (!moiServeur) return;

  const pv = Math.max(0, moiServeur.pv);
  barrePv.style.width = (pv / PV_MAX) * 100 + "%";
  barrePv.style.background =
    pv > PV_MAX * 0.5 ? "#4ade80" : pv > PV_MAX * 0.25 ? "#fbbf24" : "#ff6b6b";
  texteePv.textContent = `${pv} / ${PV_MAX}`;

  const u = moiServeur.u || 0;
  barreUlti.style.width = (u / ULTI_MAX) * 100 + "%";
  texteUlti.textContent = u >= ULTI_MAX ? `ULTI PRÊTE — ${labelTouche(touches.ulti)}` : `ulti ${u}%`;
  texteUlti.classList.toggle("prete", u >= ULTI_MAX);

  const flRecharge = moiServeur.fl || 0;
  const flPret = flRecharge <= 0;
  barreFlash.style.width = Math.max(0, Math.min(1, 1 - flRecharge / FLASH_RECHARGE)) * 100 + "%";
  texteFlash.textContent = flPret
    ? `flash prêt — ${labelTouche(touches.flash)}`
    : `flash ${flRecharge.toFixed(1)} s`;
  texteFlash.classList.toggle("prete", flPret);

  const zrRecharge = moiServeur.zr || 0;
  const zrPret = zrRecharge <= 0;
  barreZone.style.width = Math.max(0, Math.min(1, 1 - zrRecharge / ZONE_RECHARGE)) * 100 + "%";
  texteZone.textContent = zrPret
    ? `zone prête — ${labelTouche(touches.zone)}`
    : `zone ${zrRecharge.toFixed(1)} s`;
  texteZone.classList.toggle("prete", zrPret);

  // L'état de l'arme, et ce qu'il reste à faire pour le palier suivant.
  const nc = moiServeur.nc || 0;
  const nd = moiServeur.nd || 0;
  const reste = KILLS_PAR_PALIER - (moiServeur.kp || 0);
  arme.textContent =
    `${degatsDe(nd)} dég. · ${(1 / cadenceDe(nc)).toFixed(1)} tirs/s` +
    (nc + nd > 0 ? ` · niv. ${nc + nd}` : "") +
    ` · palier dans ${reste} kill${reste > 1 ? "s" : ""}`;

  // Le choix d'arme : proposé à la mort, il reste affiché tant qu'on n'a pas
  // tranché. Il ne bloque pas la partie — on peut jouer avec le panneau
  // ouvert, et choisir quand on a une seconde.
  const enAttente = moiServeur.ch || 0;
  panneau.hidden = enAttente <= 0;
  if (enAttente > 0) {
    restePalier.textContent =
      enAttente > 1 ? `${enAttente} améliorations à choisir` : "Améliore ton arme";
  }
}

function choisir(choix) {
  envoyer({ t: "amelioration", choix });
  panneau.hidden = true; // le serveur confirmera au prochain snapshot
}

// Le tableau bouge peu : le reconstruire 20 fois par seconde ferait clignoter
// le texte pour rien. 4 fois par seconde suffit largement.
function majTableau(joueurs) {
  const maintenant = performance.now();
  if (maintenant - dernierScore < 250) return;
  dernierScore = maintenant;

  const classes = [...joueurs].sort(
    (a, b) => b.k - a.k || a.m - b.m || b.d - a.d
  );

  corpsScore.textContent = "";

  for (const j of classes) {
    const ligne = document.createElement("tr");
    if (j.i === monId) ligne.className = "moi";

    ligne.innerHTML =
      `<td><span class="pastille"></span></td>` +
      `<td class="nom"></td><td>${j.k}</td><td>${j.m}</td><td>${j.d}</td>`;

    ligne.querySelector(".pastille").style.background = j.c;
    // textContent, jamais innerHTML : le pseudo vient d'un autre joueur.
    const celluleNom = ligne.querySelector(".nom");
    celluleNom.textContent = j.n;
    if (j.ia) {
      const etiquette = document.createElement("span");
      etiquette.className = "etiquetteBot";
      etiquette.textContent = "BOT";
      celluleNom.append(etiquette);
    }

    corpsScore.append(ligne);
  }
}

/* ==========================================================================
   Boucle principale
   ========================================================================== */

let accum = 0;
let dernierTemps = performance.now();

function boucle(maintenant) {
  requestAnimationFrame(boucle);

  const dt = Math.min((maintenant - dernierTemps) / 1000, 0.25);
  dernierTemps = maintenant;
  accum += dt;

  while (accum >= PAS_CLIENT) {
    accum -= PAS_CLIENT;
    pasClient();
  }

  afficher(accum / PAS_CLIENT, maintenant);
}

function pasClient() {
  // La souris (le viseur virtuel) est en pixels écran ; la caméra du dernier
  // rendu donne la conversion vers le monde. On vise donc VRAIMENT là où le
  // viseur pointe, et on clique VRAIMENT là où il se trouve.
  const cx = camera.x + souris.x;
  const cy = camera.y + souris.y;
  angle = Math.atan2(cy - monPerso.y, cx - monPerso.x);

  // Le clic gauche est maintenu : on continue de suivre le viseur, comme
  // dans un MOBA où on garde le bouton enfoncé pour courir vers la souris.
  if (encliquant && !gel) cible = { x: cx, y: cy };

  seq++;

  // Pendant le gel, on n'envoie aucune destination : le serveur l'ignorerait
  // de toute façon, et prédire un déplacement qui n'aura pas lieu produirait
  // un rappel élastique à la fin du gel.
  const c = gel ? null : cible;
  const cmd = { t: "cmd", seq, dt: PAS_CLIENT, c, a: Math.round(angle * 1000) / 1000, f: !gel && tirEnCours };

  if (ws && ws.readyState === 1) ws.send(JSON.stringify(cmd));
  enAttente.push(cmd);
  if (enAttente.length > 120) enAttente.shift();

  precedent.x = monPerso.x;
  precedent.y = monPerso.y;

  if (!gel) {
    monRalenti = Math.max(0, monRalenti - PAS_CLIENT);
    const facteur = monRalenti > 0 ? ZONE_RALENTI : 1;
    simuler(monPerso, c, PAS_CLIENT, facteur); // ← la prédiction

    // Arrivé : on arrête d'envoyer une destination, sinon le serveur (et
    // nous) referions le même calcul, pour rien, à chaque commande.
    if (c && Math.hypot(c.x - monPerso.x, c.y - monPerso.y) < 1) cible = null;
  }
}

/* ==========================================================================
   Interpolation des autres joueurs et des missiles
   ========================================================================== */

function interpoler() {
  const cible = performance.now() - RETARD;

  let a = null, b = null;
  for (let i = snapshots.length - 1; i >= 0; i--) {
    if (snapshots[i].t <= cible) { a = snapshots[i]; b = snapshots[i + 1] || null; break; }
  }
  if (!a) a = snapshots[snapshots.length - 1];
  if (!a) return { liste: [], missiles: [] };
  if (!b) return { liste: a.joueurs, missiles: a.pr };

  const alpha = (cible - a.t) / (b.t - a.t);

  const liste = a.joueurs.map((j) => {
    const suiv = b.joueurs.find((k) => k.i === j.i);
    if (!suiv) return j;
    return { ...j, x: j.x + (suiv.x - j.x) * alpha, y: j.y + (suiv.y - j.y) * alpha };
  });

  // Les missiles aussi : à 480 px/s, sans interpolation ils avancent par
  // sauts de 24 px.
  const missiles = a.pr.map((m) => {
    const suiv = b.pr.find((k) => k.i === m.i);
    if (!suiv) return m;
    return { ...m, x: m.x + (suiv.x - m.x) * alpha, y: m.y + (suiv.y - m.y) * alpha };
  });

  return { liste, missiles };
}

function afficher(alpha, temps) {
  const { liste, missiles } = interpoler();

  // Les pings et éclats sont éphémères : on jette ceux qui ont fini de vivre.
  effets = effets.filter((e) => temps - e.debut < 700);

  for (const [id, t] of dernieresTouches) {
    if (temps - t > DUREE_TOUCHE_FX) dernieresTouches.delete(id);
  }

  // Notre position affichée : entre le pas précédent et le pas actuel.
  const mx = precedent.x + (monPerso.x - precedent.x) * alpha;
  const my = precedent.y + (monPerso.y - precedent.y) * alpha;

  dessiner(ctx, vue, {
    monId,
    mx,
    my,
    liste,
    missiles,
    meteorites,
    zones,
    effets,
    touches: dernieresTouches,
    soins: derniersSoins,
    boucliers: derniersBoucliers,
    gel,
    souris,
    temps,
    toucheTir: labelTouche(touches.tirer),
  });
}

/* ==========================================================================
   Démarrage
   ========================================================================== */

async function preparerPersos() {
  const persos = await sprites.charger();
  if (!persos.length && !avatarSteam) return; // rien à proposer : on jouera en cercles

  const demande  = (params.get("perso") || "").toLowerCase();
  const memorise = localStorage.getItem("arene-perso");

  // "steam" est un skin virtuel (la photo transmise par le site), pas une
  // entrée de persos.json — il faut le reconnaître à part.
  const connu = (id) => (id === "steam" ? !!avatarSteam : persos.some((p) => p.id === id));

  // Priorité : choix explicite dans l'URL > dernier choix mémorisé >
  // photo Steam par défaut (pré-sélectionnée, mais on peut en changer) >
  // premier personnage de la liste.
  persoChoisi =
    (connu(demande) && demande) ||
    (connu(memorise) && memorise) ||
    (avatarSteam ? "steam" : "") ||
    (persos[0] && persos[0].id) ||
    "defaut";

  function ajouterBouton(id, nom, source, classeSupp) {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "perso" + (classeSupp ? " " + classeSupp : "") + (id === persoChoisi ? " actif" : "");
    bouton.title = nom;

    const img = document.createElement("img");
    img.src = source;
    img.alt = nom;
    bouton.append(img);

    bouton.addEventListener("click", () => {
      persoChoisi = id;
      try { localStorage.setItem("arene-perso", id); } catch { /* navigation privée */ }
      for (const autre of choixPerso.children) autre.classList.remove("actif");
      bouton.classList.add("actif");
    });

    choixPerso.append(bouton);
  }

  if (avatarSteam) ajouterBouton("steam", "Ta photo Steam", avatarSteam, "perso-steam");
  for (const p of persos) ajouterBouton(p.id, p.nom, p.fichier);
}

async function lancer() {
  const nom = (champNom.value || "").trim() || "Joueur" + Math.floor(Math.random() * 900 + 100);
  document.getElementById("jouer").disabled = true;

  // Verrouiller le curseur DANS LE MÊME geste utilisateur que le clic — sinon
  // certains navigateurs refusent la demande. C'est ce qui empêche la souris
  // de sortir de l'écran du jeu : une fois verrouillée, seule la touche
  // Échap (gérée nativement par le navigateur) peut la libérer.
  canvas.requestPointerLock?.().catch(() => {});

  // Le navigateur n'autorise le son qu'après un geste de l'utilisateur : ce
  // clic est le bon moment, et le seul.
  await sons.demarrer();

  connecter(nom);
}

document.getElementById("jouer").addEventListener("click", lancer);
document.getElementById("choixCadence").addEventListener("click", () => choisir("cadence"));
document.getElementById("choixDegats").addEventListener("click", () => choisir("degats"));
champNom.addEventListener("keydown", (e) => { if (e.key === "Enter") lancer(); });

// Pseudo transmis par le site : on pré-remplit le champ plutôt que de lancer
// la partie tout seul — un joueur qui arrive doit pouvoir corriger son nom, et
// une iframe qui ouvrirait une connexion sans clic n'aurait pas le clavier.
const nomFourni = (params.get("nom") || "").trim().slice(0, 16);
if (nomFourni) champNom.value = nomFourni;
champNom.focus();

document.getElementById("etatSon").textContent = `son (${labelTouche(touches.son)})`;

preparerPersos();
