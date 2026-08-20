// ============================================================================
//  test/arene.test.js — se lance avec `npm test`, sans rien installer.
//
//  Node 22 a un client WebSocket intégré : on peut donc démarrer le vrai
//  serveur et lui parler comme le ferait un navigateur, sans dépendance.
// ============================================================================

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Les règles de combat sont testées SANS réseau : on instancie une salle et
// on la fait avancer tick par tick. C'est la seule façon d'avoir des
// positions connues — en passant par le WebSocket, tout le monde apparaît au
// hasard et plus rien n'est reproductible.
import { Salle } from "../server/salle.js";
import {
  PV_MAX,
  DEGATS_MISSILE,
  DEGATS_ULTI,
  CADENCE_TIR,
  ULTI_MAX,
  ULTI_PAR_TOUCHE,
  ULTI_DUREE,
  SOINS,
  SOIN_RECHARGE,
  TICK_MS,
  positionUlti,
} from "../public/shared.js";

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;

let reussis = 0;
let echecs = 0;

function verifier(titre, condition, detail = "") {
  if (condition) {
    reussis++;
    console.log(`  ok   ${titre}${detail ? "  — " + detail : ""}`);
  } else {
    echecs++;
    console.log(`  ÉCHEC ${titre}${detail ? "  — " + detail : ""}`);
  }
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/** Un joueur factice : se connecte, garde le dernier snapshot reçu. */
function joueur(nom, salon, perso) {
  const ws = new WebSocket(
    `ws://127.0.0.1:${PORT}/ws?nom=${encodeURIComponent(nom)}&salon=${salon}` +
      (perso === undefined ? "" : `&perso=${encodeURIComponent(perso)}`)
  );

  const etat = { ws, init: null, dernier: null, snapshots: 0, seq: 0, ev: [] };

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.t === "init") etat.init = msg;
    else if (msg.t === "etat") {
      etat.dernier = msg;
      etat.snapshots++;
      if (msg.ev) etat.ev.push(...msg.ev);
    } else if (msg.t === "pong") etat.pong = msg;
  });

  etat.pret = new Promise((r) => ws.addEventListener("open", r));
  etat.moi = () => etat.dernier?.joueurs.find((j) => j.i === etat.init.moi);

  // `extra` sert à joindre l'angle de visée (`a`) et le tir (`f`).
  etat.pousser = (e, n, extra = {}) => {
    for (let i = 0; i < n; i++) {
      etat.seq++;
      ws.send(JSON.stringify({ t: "cmd", seq: etat.seq, dt: 1 / 30, e, ...extra }));
    }
  };

  return etat;
}

/* --------------------------------------------------------------------------
   Outillage des tests « hors réseau » : une salle, des joueurs posés là où
   on veut, et des ticks déclenchés à la main.
   -------------------------------------------------------------------------- */

// Une connexion factice : la salle écrit dedans, personne ne lit.
function fausseConnexion() {
  return {
    envoye: [],
    envoyer(texte) {
      this.envoye.push(texte);
    },
    envoyerTrame() {},
    fermer() {},
  };
}

function salleDeTest() {
  const salle = new Salle("test", () => {});
  // arrivee() démarre un setInterval : on ne veut que des ticks manuels.
  const vraiDemarrer = salle.demarrerBoucle.bind(salle);
  salle.demarrerBoucle = () => {};
  salle.vraiDemarrer = vraiDemarrer;
  return salle;
}

/** Pose un joueur à un endroit précis, en pleine forme, sans invulnérabilité. */
function poser(salle, nom, x, y) {
  const j = salle.arrivee(fausseConnexion(), nom, "defaut");
  j.x = x;
  j.y = y;
  j.invuln = 0;
  j.rechargeTir = 0;
  return j;
}

const ticks = (salle, n) => {
  for (let i = 0; i < n; i++) salle.pas();
};

const serveur = spawn(process.execPath, ["server/index.js"], {
  cwd: RACINE,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "inherit"],
});

process.on("exit", () => serveur.kill());

await new Promise((r) => serveur.stdout.once("data", r));

try {
  console.log("\nFichiers statiques");

  const page = await fetch(`${BASE}/`);
  verifier(
    "GET / sert index.html",
    page.status === 200 && page.headers.get("content-type").startsWith("text/html")
  );

  const partage = await fetch(`${BASE}/shared.js`);
  const codePartage = await partage.text();
  verifier(
    "GET /shared.js sert du JavaScript",
    partage.status === 200 &&
      partage.headers.get("content-type").startsWith("text/javascript") &&
      codePartage.includes("export function simuler")
  );

  verifier("cache-control: no-cache sur les assets", partage.headers.get("cache-control") === "no-cache");

  const inconnu = await fetch(`${BASE}/nexistepas.js`);
  verifier("404 sur un fichier absent", inconnu.status === 404);

  const evasion = await fetch(`${BASE}/../server/index.js`, { redirect: "manual" });
  verifier(
    "traversée de dossier bloquée (/../server/index.js)",
    evasion.status === 404 || evasion.status === 403,
    "code " + evasion.status
  );

  console.log("\nSonde de santé");

  const sante = await (await fetch(`${BASE}/sante`)).json();
  verifier("GET /sante répond ok", sante.ok === true && sante.connexions === 0);

  console.log("\nUn joueur");

  const a = joueur("Ben", "mgs");
  await a.pret;
  await attendre(200);

  verifier("message init reçu", a.init !== null && typeof a.init.moi === "number");
  verifier("le monde est transmis", a.init?.monde?.l === 1600 && a.init?.murs?.length === 7);
  verifier("snapshots reçus (~20/s)", a.snapshots >= 2, a.snapshots + " en 200 ms");

  const avant = a.moi();
  a.pousser({ droite: true }, 20);
  await attendre(400);
  const apres = a.moi();

  verifier("le joueur bouge vers la droite", apres.x > avant.x + 20, `${avant.x} → ${apres.x}`);
  verifier("le serveur renvoie le n° de commande traité", apres.s > 0, "s=" + apres.s);
  verifier("le pseudo est conservé", apres.n === "Ben");

  a.ws.send(JSON.stringify({ t: "ping", t0: 1234 }));
  await attendre(150);
  verifier("ping → pong", a.pong?.t0 === 1234);

  console.log("\nAnti-triche");

  const posAvant = a.moi().x;
  a.pousser({ droite: true }, 200); // 200 commandes d'un coup
  await attendre(120); // ~2 ticks : 10 commandes appliquées au maximum
  const posApres = a.moi().x;
  const parcouru = posApres - posAvant;
  verifier(
    "200 commandes d'un coup ne téléportent pas",
    parcouru < 200,
    Math.round(parcouru) + " px en 2 ticks"
  );

  // Joueur neuf : la file de A est encore pleine des 200 commandes ci-dessus,
  // la mesure serait faussée par ce qu'il lui reste à rattraper.
  const triche = joueur("Triche", "triche");
  await triche.pret;
  await attendre(150);
  const bloque = triche.moi().x;
  triche.ws.send(JSON.stringify({ t: "cmd", seq: 1, dt: 999, e: { droite: true } }));
  await attendre(200);
  verifier(
    "un dt de 999 s est borné à 0,1 s (26 px max)",
    triche.moi().x - bloque < 30,
    Math.round(triche.moi().x - bloque) + " px"
  );
  triche.ws.close();

  a.ws.send("{ ceci n'est pas du json");
  a.ws.send(JSON.stringify({ t: "cmd", seq: 1 })); // pas de champ `e`
  await attendre(150);
  verifier("messages malformés : le serveur tient", a.ws.readyState === 1);

  console.log("\nDeux joueurs, même salon");

  const b = joueur("Louis", "mgs");
  await b.pret;
  await attendre(250);

  verifier("A voit 2 joueurs", a.dernier.joueurs.length === 2);
  verifier("B voit 2 joueurs", b.dernier.joueurs.length === 2);
  verifier("couleurs différentes", a.dernier.joueurs[0].c !== a.dernier.joueurs[1].c);

  console.log("\nSalons séparés");

  const c = joueur("Autre", "copains");
  await c.pret;
  await attendre(250);

  verifier("le salon copains est isolé", c.dernier.joueurs.length === 1);
  verifier("le salon mgs n'a pas bougé", a.dernier.joueurs.length === 2);

  const d = joueur("Sale", "Co PAINS/../evil<script>");
  await d.pret;
  await attendre(250);

  const santeB = await (await fetch(`${BASE}/sante`)).json();
  const nomsSalons = santeB.salons.map((s) => s.nom);
  verifier(
    "un nom de salon sale est normalisé, pas rejeté",
    nomsSalons.includes("copainsevilscript") &&
      !nomsSalons.some((n) => /[^a-z0-9-]/.test(n)),
    JSON.stringify(nomsSalons)
  );
  verifier("la sonde compte les connexions", santeB.connexions === 4, "connexions=" + santeB.connexions);

  console.log("\nPseudo hostile");

  const e = joueur('<img src=x onerror=alert(1)>', "mgs");
  await e.pret;
  await attendre(250);
  const nomRendu = e.moi().n;
  verifier(
    "les balises sont retirées du pseudo",
    !nomRendu.includes("<") && !nomRendu.includes(">") && nomRendu.length <= 16,
    JSON.stringify(nomRendu)
  );

  console.log("\nCombat en réseau");

  const f = joueur("Tireur", "combat", "ROBOT/../evil");
  await f.pret;
  await attendre(250);

  const ligne = f.moi();
  verifier(
    "le snapshot porte pv, kills, morts, dégâts et ulti",
    ligne.pv === PV_MAX && ligne.k === 0 && ligne.m === 0 && ligne.d === 0 && ligne.u === 0,
    JSON.stringify({ pv: ligne.pv, k: ligne.k, m: ligne.m, d: ligne.d, u: ligne.u })
  );
  verifier(
    "l'identifiant de personnage est filtré",
    ligne.sp === "robotevil",
    JSON.stringify(ligne.sp)
  );
  verifier(
    "les pastilles de soin sont transmises",
    Array.isArray(f.dernier.so) && f.dernier.so.length === SOINS.length
  );

  f.pousser({}, 40, { a: 0, f: true });
  await attendre(700);

  const tirs = f.ev.filter((e) => e.t === "tir").length;
  verifier(
    "40 ordres de tir d'un coup ne donnent pas 40 missiles",
    tirs >= 1 && tirs <= 4,
    tirs + " tirs en 700 ms"
  );

  f.ws.close();
  await attendre(150);

  console.log("\nCombat — tir, dégâts et cadence");

  {
    const salle = salleDeTest();
    const tireur = poser(salle, "A", 400, 820);
    const cible = poser(salle, "B", 520, 820);
    tireur.angle = 0; // pile en direction de B

    salle.message(tireur, JSON.stringify({ t: "cmd", seq: 1, dt: 0, e: {}, a: 0, f: true }));
    salle.pas();
    verifier("un missile part quand on tire", salle.missiles.length === 1);

    ticks(salle, 6);
    verifier(
      "le missile retire 5 PV",
      cible.pv === PV_MAX - DEGATS_MISSILE,
      `pv=${cible.pv}`
    );
    verifier("le missile disparaît en touchant", salle.missiles.length === 0);
    verifier("les dégâts sont crédités au tireur", tireur.degats === DEGATS_MISSILE);
    verifier(
      "10 % d'ulti par missile touché",
      tireur.ulti === ULTI_PAR_TOUCHE,
      tireur.ulti + " %"
    );

    // La cadence est la première chose qu'un tricheur essaie de contourner.
    for (let i = 0; i < 10; i++) {
      salle.message(tireur, JSON.stringify({ t: "cmd", seq: 20 + i, dt: 0, e: {}, a: 0, f: true }));
    }
    salle.pas();
    verifier(
      "10 ordres de tir dans le même tick = 1 missile",
      salle.missiles.length === 1,
      salle.missiles.length + " missile(s)"
    );

    // ... et la cadence, c'est bien 0,25 s.
    salle.message(tireur, JSON.stringify({ t: "cmd", seq: 40, dt: 0, e: {}, a: 0, f: true }));
    salle.pas();
    verifier("pas de second tir au tick suivant", salle.missiles.length === 1);
    verifier(
      "la recharge vaut la cadence annoncée",
      Math.abs(tireur.rechargeTir - (CADENCE_TIR - TICK_MS / 1000)) < 0.001,
      tireur.rechargeTir + " s"
    );
  }

  console.log("\nCombat — mort, réapparition et scores");

  {
    const salle = salleDeTest();
    const tireur = poser(salle, "A", 400, 820);
    const cible = poser(salle, "B", 520, 820);
    tireur.angle = 0;
    cible.pv = DEGATS_MISSILE; // un missile de plus et c'est fini

    const avant = { x: cible.x, y: cible.y };

    salle.message(tireur, JSON.stringify({ t: "cmd", seq: 1, dt: 0, e: {}, a: 0, f: true }));
    ticks(salle, 7);

    verifier("une mort est comptée à la victime", cible.morts === 1);
    verifier("un kill est compté au tireur", tireur.kills === 1);
    verifier("réapparition immédiate à pleine vie", cible.pv === PV_MAX);
    verifier(
      "réapparition ailleurs",
      Math.hypot(cible.x - avant.x, cible.y - avant.y) > 1,
      `${Math.round(avant.x)},${Math.round(avant.y)} → ${Math.round(cible.x)},${Math.round(cible.y)}`
    );
    verifier("courte invulnérabilité au retour", cible.invuln > 0);
    verifier(
      "les dégâts comptés ne dépassent pas les PV restants",
      tireur.degats === DEGATS_MISSILE,
      tireur.degats + " dégâts"
    );
  }

  console.log("\nZones de soin");

  {
    const salle = salleDeTest();
    const blesse = poser(salle, "A", SOINS[0].x, SOINS[0].y);
    blesse.pv = 5;

    salle.pas();
    verifier("la pastille rend toute la vie", blesse.pv === PV_MAX);
    verifier(
      "puis se met à recharger",
      Math.abs(salle.soins[0].recharge - SOIN_RECHARGE) < 0.2,
      salle.soins[0].recharge + " s"
    );

    const suivant = poser(salle, "B", SOINS[0].x, SOINS[0].y);
    suivant.pv = 5;
    salle.pas();
    verifier("elle ne se reprend pas pendant la recharge", suivant.pv === 5);

    // Pleine vie : la pastille ne doit pas être gaspillée.
    const salle2 = salleDeTest();
    const intact = poser(salle2, "A", SOINS[1].x, SOINS[1].y);
    salle2.pas();
    verifier("à pleine vie, la pastille reste en place", salle2.soins[1].recharge === 0);
  }

  console.log("\nAttaque spéciale — pause temporelle");

  const TICKS_ULTI = Math.ceil(ULTI_DUREE / (TICK_MS / 1000)) + 2;

  {
    const salle = salleDeTest();
    const lanceur = poser(salle, "A", 500, 800);
    const temoin = poser(salle, "B", 200, 200); // hors de portée de la spirale

    lanceur.ulti = ULTI_MAX - 10;
    salle.message(lanceur, JSON.stringify({ t: "ulti" }));
    verifier("l'ulti est refusée en dessous de 100 %", salle.gel === null);

    lanceur.ulti = ULTI_MAX;
    lanceur.angle = 0;
    salle.message(lanceur, JSON.stringify({ t: "ulti" }));
    verifier(
      "l'ulti se déclenche à 100 % et vide la jauge",
      salle.gel !== null && lanceur.ulti === 0
    );

    const xAvant = temoin.x;
    salle.message(
      temoin,
      JSON.stringify({ t: "cmd", seq: 1, dt: 1 / 30, e: { droite: true }, a: 0, f: true })
    );
    salle.pas();
    verifier("personne ne bouge pendant le gel", temoin.x === xAvant);
    verifier("personne ne tire pendant le gel", salle.missiles.length === 0);
    verifier(
      "les commandes gelées sont quand même acquittées",
      temoin.dernierSeq === 1,
      "seq=" + temoin.dernierSeq
    );

    ticks(salle, TICKS_ULTI);
    verifier("sans personne sur la trajectoire, l'ulti est perdue", salle.gel === null);
    verifier("et elle ne se recharge pas toute seule", lanceur.ulti === 0);
  }

  {
    const salle = salleDeTest();
    const lanceur = poser(salle, "A", 500, 800);
    lanceur.angle = 0;
    lanceur.ulti = ULTI_MAX;

    // La victime est posée exactement sur la trajectoire, à mi-course.
    const passage = positionUlti({ x: lanceur.x, y: lanceur.y, angle: 0 }, ULTI_DUREE / 2);
    const victime = poser(salle, "B", passage.x, passage.y);

    salle.message(lanceur, JSON.stringify({ t: "ulti" }));
    ticks(salle, TICKS_ULTI);

    verifier(
      "le projectile d'horloge élimine ce qu'il traverse",
      victime.morts === 1 && lanceur.kills === 1,
      `morts=${victime.morts} kills=${lanceur.kills}`
    );
    verifier(
      `l'ulti inflige ${DEGATS_ULTI} dégâts`,
      lanceur.degats === DEGATS_ULTI,
      lanceur.degats + " dégâts"
    );
    verifier("l'ulti ne recharge pas l'ulti", lanceur.ulti === 0);
    verifier("le gel s'arrête dès la touche", salle.gel === null);
  }

  console.log("\nDéconnexion");

  const avantDepart = a.dernier.joueurs.length;
  b.ws.close();
  e.ws.close();
  await attendre(300);
  verifier(
    "les partants disparaissent du snapshot",
    a.dernier.joueurs.length === avantDepart - 2,
    `${avantDepart} → ${a.dernier.joueurs.length}`
  );

  console.log("\nChemin WebSocket inconnu");

  const mauvais = new WebSocket(`ws://127.0.0.1:${PORT}/autre`);
  const refuse = await new Promise((r) => {
    mauvais.addEventListener("error", () => r(true));
    mauvais.addEventListener("open", () => r(false));
  });
  verifier("/autre est refusé (seul /ws est un WebSocket)", refuse);

  console.log("\nSalle vidée");

  a.ws.close();
  c.ws.close();
  d.ws.close();
  await attendre(400);
  const santeC = await (await fetch(`${BASE}/sante`)).json();
  verifier(
    "salles libérées quand tout le monde part",
    santeC.connexions === 0 && santeC.salons.length === 0,
    JSON.stringify(santeC)
  );
} finally {
  serveur.kill();
}

console.log(`\n${reussis} réussis, ${echecs} échecs\n`);
process.exit(echecs === 0 ? 0 : 1);
