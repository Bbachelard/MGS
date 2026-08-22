// ============================================================================
//  server/index.js — le serveur de l'Arène MGS.
//
//  Il fait deux choses :
//    1. servir les fichiers de public/ (le client) ;
//    2. tenir les salles de jeu et pousser l'état 20 fois par seconde.
//
//  Les règles du jeu, elles, sont dans server/salle.js.
//
//  Il tourne dans un conteneur `node:22-alpine` sur le VPS, à côté d'Apache.
//  Apache lui passe /jeu/ (voir apache/mgs-arene.conf). Aucune dépendance :
//  le dossier est monté tel quel, `node server/index.js` suffit.
//
//  Une salle = un objet en mémoire. C'est exactement ce que PHP en mutualisé
//  ne savait pas faire, et ce que ton VPS fait sans effort : le processus
//  reste vivant entre deux messages.
// ============================================================================

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { accepter } from "./ws.js";
import { Salle } from "./salle.js";

const PORT = Number(process.env.PORT || 8080);
const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

// Garde-fous. Le VPS est petit : mieux vaut refuser proprement que ramer.
const MAX_JOUEURS_PAR_SALLE = 32;
const MAX_SALLES = 20;
const MAX_CONNEXIONS = 200;

let connexionsOuvertes = 0;

const salles = new Map(); // nom -> Salle

/* ==========================================================================
   Nettoyage des entrées venues du client
   ========================================================================== */

/**
 * Le pseudo est réaffiché à tous les autres joueurs : ni balise, ni saut de
 * ligne. Le rendu se fait dans un <canvas> (pas de HTML), mais on nettoie à
 * la source plutôt que de compter dessus.
 */
function nettoyerPseudo(brut) {
  const nom = String(brut || "")
    .replace(/[<>&"'\r\n\t]/g, "")
    .trim()
    .slice(0, 16);

  return nom === "" ? "Anonyme" : nom;
}

/** Le nom du salon crée une salle : on le borne, sinon on en crée à l'infini. */
function nettoyerSalon(brut) {
  const nom = String(brut || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 24);

  return nom === "" ? "principal" : nom;
}

/**
 * L'identifiant de personnage sert à construire un chemin d'image côté client
 * (`perso/<id>.png`) et il est rediffusé à tous les autres joueurs : c'est
 * exactement le genre de chaîne qui, mal filtrée, va chercher un fichier
 * ailleurs sur le serveur. On le réduit à [a-z0-9-].
 */
function nettoyerSprite(brut) {
  const id = String(brut || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 24);

  return id === "" ? "defaut" : id;
}

/**
 * L'URL de la photo Steam (skin "steam") est rediffusée à TOUS les autres
 * joueurs de la salle. Sans contrôle, n'importe qui peut se connecter au
 * WebSocket en sautant la page PHP (qui, elle, ne fournit que de vraies
 * URL Steam) et faire afficher n'importe quelle image chez tout le monde.
 * On n'accepte donc que le CDN d'avatars Steam, en HTTPS.
 */
const HOTES_AVATAR_AUTORISES = new Set([
  "avatars.akamai.steamstatic.com",
  "avatars.cloudflare.steamstatic.com",
  "avatars.steamstatic.com",
  "steamcdn-a.akamaihd.net",
]);

function nettoyerAvatar(brut) {
  const valeur = String(brut || "").slice(0, 300);
  if (!valeur) return null;

  let url;
  try {
    url = new URL(valeur);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || !HOTES_AVATAR_AUTORISES.has(url.hostname)) {
    return null;
  }

  return url.href;
}

/* ==========================================================================
   Les fichiers statiques (le client)
   ========================================================================== */

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
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
      // Le client et la physique changent ensemble : un shared.js en cache
      // face à un serveur à jour, et tout le monde tressaute. Les images et
      // les sons, eux, ne changent qu'à la main : on les laisse en cache.
      "cache-control":
        ext === ".png" || ext === ".jpg" || ext === ".mp3" || ext === ".ogg" || ext === ".wav"
          ? "public, max-age=3600"
          : "no-cache",
    });
    reponse.end(contenu);
  });
}

/* ==========================================================================
   Le serveur
   ========================================================================== */

const serveur = http.createServer((requete, reponse) => {
  const url = new URL(requete.url, "http://interne");

  // Sonde de santé : `curl localhost:8080/sante` depuis le VPS dit tout de
  // suite si le jeu tourne, et combien de monde il y a.
  if (url.pathname === "/sante") {
    const salons = [...salles.values()].map((s) => ({
      nom: s.nom,
      joueurs: s.joueurs.size,
      tick: s.tick,
    }));

    reponse.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    reponse.end(
      JSON.stringify({
        ok: true,
        connexions: connexionsOuvertes,
        salons,
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

  const salon = nettoyerSalon(url.searchParams.get("salon"));
  const salle = salles.get(salon);

  if (!salle && salles.size >= MAX_SALLES) {
    socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    return;
  }

  if (salle && salle.joueurs.size >= MAX_JOUEURS_PAR_SALLE) {
    socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    return;
  }

  const co = accepter(requete, socket);
  if (!co) return;

  const cible = salle || new Salle(salon, (s) => salles.delete(s.nom));
  if (!salle) salles.set(salon, cible);

  cible.arrivee(
    co,
    nettoyerPseudo(url.searchParams.get("nom")),
    nettoyerSprite(url.searchParams.get("perso")),
    nettoyerAvatar(url.searchParams.get("avatar"))
  );

  // Après arrivee(), surtout pas avant : c'est arrivee() qui pose le
  // gestionnaire de fermeture de la salle. En s'enveloppant ici, on est sûr
  // de ne pas l'écraser — et le compteur ne se met pas à mentir.
  connexionsOuvertes++;
  const fermetureSalle = co.surFermeture;
  co.surFermeture = () => {
    connexionsOuvertes--;
    fermetureSalle();
  };
});

serveur.listen(PORT, () => {
  console.log(`Arène MGS — en écoute sur le port ${PORT}`);
});

// `docker compose restart` envoie SIGTERM : on ferme proprement plutôt que
// de laisser Docker tuer le processus au bout de 10 s.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`${signal} reçu — arrêt.`);
    for (const salle of salles.values()) {
      salle.arreterBoucle();
      for (const j of salle.joueurs.values()) j.co.fermer(1001);
    }
    serveur.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

export { serveur, salles };
