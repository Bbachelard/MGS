// ===========================================================================
//  client.js — tout ce qui tourne dans le navigateur.
//
//  Le client ne décide de RIEN : c'est le serveur qui fait autorité. Mais si
//  on attendait bêtement la réponse du serveur pour bouger, on sentirait la
//  latence à chaque touche (~50 à 200 ms de mou). D'où les 3 techniques
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
//  Ce qui a été ajouté au combat : le tir, les dégâts, la mort, les soins et
//  l'ulti ne sont JAMAIS calculés ici. Le client envoie « je vise là » et
//  « je tire », le serveur répond « voilà ce qui s'est passé ». C'est la
//  seule façon de ne pas offrir l'arène au premier venu qui ouvre la console.
// ===========================================================================

import {
  PAS_CLIENT,
  PV_MAX,
  ULTI_MAX,
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
const jauges    = document.getElementById("jauges");
const arme      = document.getElementById("arme");
const panneau   = document.getElementById("panneau");
const restePalier = document.getElementById("restePalier");

// --- paramètres d'URL ----------------------------------------------------
// Le site MGS ouvre le jeu avec ?nom=<pseudo>&salon=mgs : le joueur connecté
// n'a plus qu'à cliquer.
const params = new URLSearchParams(location.search);
const salon  = params.get("salon") || "principal";

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

const RETARD = 100; // ms — de combien on affiche les autres dans le passé

const entree = { haut: false, bas: false, gauche: false, droite: false };
const souris = { x: 0, y: 0 };
let angle = 0;
let tirEnCours = false;

/* ==========================================================================
   Entrées
   ========================================================================== */

const TOUCHES = {
  KeyW: "haut",   KeyZ: "haut",   ArrowUp:    "haut",
  KeyS: "bas",                    ArrowDown:  "bas",
  KeyA: "gauche", KeyQ: "gauche", ArrowLeft:  "gauche",
  KeyD: "droite",                 ArrowRight: "droite",
};

addEventListener("keydown", (e) => {
  const t = TOUCHES[e.code];
  if (t) { entree[t] = true; e.preventDefault(); return; }

  if (e.code === "KeyE")   { demanderUlti(); e.preventDefault(); }
  if (e.code === "Space")  { appuyerTir(); e.preventDefault(); }
  if (e.code === "Tab")    { tableau.classList.add("grand"); e.preventDefault(); }
  if (e.code === "KeyM")   { basculerSon(); }
});

addEventListener("keyup", (e) => {
  const t = TOUCHES[e.code];
  if (t) { entree[t] = false; e.preventDefault(); return; }

  if (e.code === "Space") { tirEnCours = false; e.preventDefault(); }
  if (e.code === "Tab")   { tableau.classList.remove("grand"); e.preventDefault(); }
});

// Si on change d'onglet, on relâche tout (sinon on part en ligne droite).
addEventListener("blur", () => {
  for (const k in entree) entree[k] = false;
  tirEnCours = false;
});

addEventListener("mousemove", (e) => {
  souris.x = e.clientX;
  souris.y = e.clientY;
});

// Le jeu est affiché dans une iframe sur my-gamers-stats.com : sans clic, le
// clavier va à la page parente. Un clic n'importe où rend la main au jeu.
addEventListener("mousedown", (e) => {
  if (accueil.hidden) window.focus();
  if (e.button === 0) appuyerTir();
  if (e.button === 2) demanderUlti();
});
addEventListener("mouseup", (e) => {
  if (e.button === 0) tirEnCours = false;
});
// Clic droit = ulti : le menu du navigateur n'a rien à faire là.
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// Tactile : un doigt vise et tire en même temps.
canvas.addEventListener("touchstart", (e) => {
  const t = e.touches[0];
  souris.x = t.clientX;
  souris.y = t.clientY;
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

/**
 * Le même geste — clic gauche, espace, ou un doigt — fait deux choses selon
 * le moment : tirer normalement, ou déclencher le rayon de l'ulti pendant sa
 * propre pause temporelle. Un seul bouton à retenir, c'est mieux.
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
  document.getElementById("etatSon").textContent = sonCoupe ? "son coupé (M)" : "son (M)";
}

/* ==========================================================================
   Taille du canvas
   ========================================================================== */

let vue = { l: 0, h: 0 };
function redimensionner() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  vue = { l: innerWidth, h: innerHeight };
  canvas.width  = vue.l * dpr;
  canvas.height = vue.h * dpr;
  canvas.style.width  = vue.l + "px";
  canvas.style.height = vue.h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    `&perso=${encodeURIComponent(persoChoisi)}`;

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
      requestAnimationFrame(boucle);

    } else if (msg.t === "etat") {
      snapshots.push({ t: performance.now(), joueurs: msg.joueurs, pr: msg.pr || [] });
      if (snapshots.length > 40) snapshots.shift();

      gel = msg.g || null;
      derniersSoins = msg.so || [];
      derniersBoucliers = msg.bo || [];
      meteorites = msg.mt || [];
      reconcilier(msg.joueurs);
      if (msg.ev) traiterEvenements(msg.ev);

      document.getElementById("nbJoueurs").textContent = msg.joueurs.length;
      document.getElementById("tick").textContent = msg.tick;
      majJauges();
      majTableau(msg.joueurs);

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

/* ==========================================================================
   Réconciliation
   ========================================================================== */

function reconcilier(joueurs) {
  const moi = joueurs.find((j) => j.i === monId);
  if (!moi) return;

  moiServeur = moi;

  monPerso.x = moi.x;
  monPerso.y = moi.y;

  enAttente = enAttente.filter((c) => c.seq > moi.s);

  // Pendant le gel, le serveur n'applique rien : rejouer localement nous
  // ferait avancer tout seul, puis reculer au tick suivant.
  if (!gel) for (const c of enAttente) simuler(monPerso, c.e, c.dt);

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
      case "impact":
      case "touche":
      case "soin":
      case "ulti-tir":
      case "ulti-touche":
      case "ulti-rate":
        sons.jouer(e.t, volumeSelonDistance(e.x, e.y));
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
          ajouterAuFil("Arme améliorable — au prochain respawn", "#fbbf24");
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
  texteUlti.textContent = u >= ULTI_MAX ? "ULTI PRÊTE — E" : `ulti ${u}%`;
  texteUlti.classList.toggle("prete", u >= ULTI_MAX);

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
    ligne.querySelector(".nom").textContent = j.n;

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
  // La souris est en pixels écran ; la caméra du dernier rendu donne la
  // conversion vers le monde. On vise donc VRAIMENT là où on pointe.
  const cx = camera.x + souris.x;
  const cy = camera.y + souris.y;
  angle = Math.atan2(cy - monPerso.y, cx - monPerso.x);

  seq++;

  // Pendant le gel, on n'envoie aucune touche : le serveur les ignorerait de
  // toute façon, et prédire un déplacement qui n'aura pas lieu produirait un
  // rappel élastique à la fin du gel.
  const e = gel ? { haut: false, bas: false, gauche: false, droite: false } : { ...entree };
  const cmd = { t: "cmd", seq, dt: PAS_CLIENT, e, a: Math.round(angle * 1000) / 1000, f: !gel && tirEnCours };

  if (ws && ws.readyState === 1) ws.send(JSON.stringify(cmd));
  enAttente.push(cmd);
  if (enAttente.length > 120) enAttente.shift();

  precedent.x = monPerso.x;
  precedent.y = monPerso.y;
  if (!gel) simuler(monPerso, cmd.e, PAS_CLIENT); // ← la prédiction
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
    soins: derniersSoins,
    boucliers: derniersBoucliers,
    gel,
    souris,
    temps,
  });
}

/* ==========================================================================
   Démarrage
   ========================================================================== */

async function preparerPersos() {
  const persos = await sprites.charger();
  if (!persos.length) return; // aucun manifeste : on jouera en cercles

  const demande = (params.get("perso") || "").toLowerCase();
  const memorise = localStorage.getItem("arene-perso");
  const defaut = persos.find((p) => p.id === demande) ||
                 persos.find((p) => p.id === memorise) ||
                 persos[0];
  persoChoisi = defaut.id;

  for (const p of persos) {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "perso" + (p.id === persoChoisi ? " actif" : "");
    bouton.title = p.nom;

    const img = document.createElement("img");
    img.src = p.fichier;
    img.alt = p.nom;
    bouton.append(img);

    bouton.addEventListener("click", () => {
      persoChoisi = p.id;
      try { localStorage.setItem("arene-perso", p.id); } catch { /* navigation privée */ }
      for (const autre of choixPerso.children) autre.classList.remove("actif");
      bouton.classList.add("actif");
    });

    choixPerso.append(bouton);
  }
}

async function lancer() {
  const nom = (champNom.value || "").trim() || "Joueur" + Math.floor(Math.random() * 900 + 100);
  document.getElementById("jouer").disabled = true;

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

preparerPersos();
