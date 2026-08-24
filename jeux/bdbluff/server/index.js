// ============================================================================
//  server/index.js — le serveur de BDBluff.
//
//  Il fait deux choses :
//    1. servir les fichiers de public/ (le client) ;
//    2. tenir les salons de jeu et router les WebSockets vers le bon.
//
//  Les règles du jeu sont dans server/salon.js. Il tourne dans un conteneur
//  `node:22-alpine` sur le VPS, à côté d'Apache et du conteneur `arene` —
//  même moule que jeux/arene/server/index.js, à qui ce fichier doit
//  beaucoup.
// ============================================================================

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { accepter } from "./ws.js";
import { Salon } from "./salon.js";
import { JOUEURS_MAX } from "../public/shared.js";

const PORT = Number(process.env.PORT || 8080);
const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

// Mot de passe de la catégorie de thèmes HARD — jamais commis dans le dépôt.
// Vide par défaut : la catégorie reste verrouillée tant que l'opérateur du
// VPS n'a pas défini BDBLUFF_MDP_HARD (voir jeux/bdbluff/README.md).
const MOT_DE_PASSE_HARD = process.env.BDBLUFF_MDP_HARD || "";

// Garde-fous. Le VPS est petit : mieux vaut refuser proprement que ramer.
const MAX_SALONS = 100;
const MAX_CONNEXIONS = 200;

let connexionsOuvertes = 0;

const salons = new Map(); // nom -> Salon

/* ==========================================================================
   Nettoyage des entrées venues du client
   ========================================================================== */

/** Le pseudo est réaffiché à tous les autres joueurs, y compris dans le chat. */
function nettoyerPseudo(brut) {
  const nom = String(brut || "")
    .replace(/[<>&"'\r\n\t]/g, "")
    .trim()
    .slice(0, 16);

  return nom === "" ? "Anonyme" : nom;
}

/** Le nom du salon crée un salon : on le borne, sinon on en crée à l'infini. */
function nettoyerSalon(brut) {
  const nom = String(brut || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 24);

  return nom === "" ? "principal" : nom;
}

/**
 * Le jeton de reconnexion est fabriqué par le serveur (crypto.randomBytes(24)
 * en hexadécimal, cf. salon.js) : on ne l'accepte que sous cette forme
 * exacte, sinon un jeton bidon pourrait être confondu avec une chaîne vide
 * et retomber par erreur sur le chemin "nouvelle arrivée".
 */
function nettoyerJeton(brut) {
  const jeton = String(brut || "");
  return /^[a-f0-9]{48}$/.test(jeton) ? jeton : "";
}

/* ==========================================================================
   Les fichiers statiques (le client)
   ========================================================================== */

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function servirFichier(requete, reponse) {
  const url = new URL(requete.url, "http://interne");
  let chemin = decodeURIComponent(url.pathname);

  if (chemin.endsWith("/")) chemin += "index.html";

  // path.normalize + le contrôle de préfixe : sans ça, /../../etc/passwd
  // sort du dossier public/.
  const cible = path.normalize(path.join(RACINE, chemin));

  if (!cible.startsWith(RACINE + path.sep) && cible !== RACINE) {
    reponse.writeHead(403).end("Interdit");
    return;
  }

  fs.readFile(cible, (err, contenu) => {
    if (err) {
      reponse.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      reponse.end("Introuvable");
      return;
    }

    const ext = path.extname(cible);
    reponse.writeHead(200, {
      "content-type": TYPES[ext] || "application/octet-stream",
      // Les règles du jeu (shared.js, themes.js) doivent toujours être à
      // jour côté client : jamais de cache dessus. Les stickers ne changent
      // qu'à la main, eux, on les laisse en cache.
      "cache-control": ext === ".svg" || ext === ".png" ? "public, max-age=3600" : "no-cache",
    });
    reponse.end(contenu);
  });
}

/* ==========================================================================
   Le serveur
   ========================================================================== */

const serveur = http.createServer((requete, reponse) => {
  const url = new URL(requete.url, "http://interne");

  // Sonde de santé : `curl localhost:8080/sante` depuis le VPS.
  if (url.pathname === "/sante") {
    const listeSalons = [...salons.values()].map((s) => ({
      nom: s.nom,
      joueurs: s.joueurs.size,
      phase: s.phase,
      manche: s.mancheCourante,
    }));

    reponse.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    reponse.end(
      JSON.stringify({
        ok: true,
        connexions: connexionsOuvertes,
        salons: listeSalons,
        depuis: Math.round(process.uptime()) + " s",
      })
    );
    return;
  }

  servirFichier(requete, reponse);
});

serveur.on("upgrade", (requete, socket) => {
  const url = new URL(requete.url, "http://interne");

  if (url.pathname !== "/ws") {
    socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
    return;
  }

  if (connexionsOuvertes >= MAX_CONNEXIONS) {
    socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    return;
  }

  const nomSalon = nettoyerSalon(url.searchParams.get("salon"));
  const salonExistant = salons.get(nomSalon);

  if (!salonExistant && salons.size >= MAX_SALONS) {
    socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    return;
  }

  // Un salon plein refuse une NOUVELLE arrivée (Salon.arrivee le referait de
  // toute façon), mais autant ne pas ouvrir le WebSocket pour rien — sauf
  // si c'est une reconnexion (jeton valide), qu'il ne faut jamais bloquer.
  const jeton = nettoyerJeton(url.searchParams.get("jeton"));
  if (!jeton && salonExistant && salonExistant.joueurs.size >= JOUEURS_MAX) {
    socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    return;
  }

  const co = accepter(requete, socket);
  if (!co) return;

  const salon = salonExistant || new Salon(nomSalon, (s) => salons.delete(s.nom), MOT_DE_PASSE_HARD);
  if (!salonExistant) salons.set(nomSalon, salon);

  salon.arrivee(co, nettoyerPseudo(url.searchParams.get("nom")), jeton);

  // Après arrivee(), surtout pas avant : c'est arrivee()/_reattacher() qui
  // pose le gestionnaire de fermeture. En s'enveloppant ici, on ne l'écrase
  // pas — et le compteur ne se met pas à mentir.
  connexionsOuvertes++;
  const fermetureInitiale = co.surFermeture;
  co.surFermeture = () => {
    connexionsOuvertes--;
    fermetureInitiale();
  };
});

serveur.listen(PORT, () => {
  console.log(`BDBluff — en écoute sur le port ${PORT}`);
});

// `docker compose restart` envoie SIGTERM : on ferme proprement plutôt que
// de laisser Docker tuer le processus au bout de 10 s.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`${signal} reçu — arrêt.`);
    for (const salon of salons.values()) {
      salon.arreterBoucle();
      for (const j of salon.joueurs.values()) {
        if (j.co && j.co.ouverte) j.co.fermer(1001);
      }
    }
    serveur.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

export { serveur, salons };
