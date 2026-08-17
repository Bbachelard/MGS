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
function joueur(nom, salon) {
  const ws = new WebSocket(
    `ws://127.0.0.1:${PORT}/ws?nom=${encodeURIComponent(nom)}&salon=${salon}`
  );

  const etat = { ws, init: null, dernier: null, snapshots: 0, seq: 0 };

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.t === "init") etat.init = msg;
    else if (msg.t === "etat") {
      etat.dernier = msg;
      etat.snapshots++;
    } else if (msg.t === "pong") etat.pong = msg;
  });

  etat.pret = new Promise((r) => ws.addEventListener("open", r));
  etat.moi = () => etat.dernier?.joueurs.find((j) => j.i === etat.init.moi);

  etat.pousser = (e, n) => {
    for (let i = 0; i < n; i++) {
      etat.seq++;
      ws.send(JSON.stringify({ t: "cmd", seq: etat.seq, dt: 1 / 30, e }));
    }
  };

  return etat;
}

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
