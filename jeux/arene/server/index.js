// ============================================================================
//  server/index.js — le serveur de l'Arène MGS.
//
//  Il fait deux choses :
//    1. servir les fichiers de public/ (le client) ;
//    2. tenir les salles de jeu et pousser l'état 20 fois par seconde.
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

import { accepter, Connexion } from "./ws.js";
import {
  MONDE,
  TICK_MS,
  RAYON,
  COULEURS,
  MURS,
  simuler,
  positionDeDepart,
} from "../public/shared.js";

const PORT = Number(process.env.PORT || 8080);
const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

// Nombre max de commandes traitées par tick et par joueur.
// Sans ça, un tricheur enverrait 1000 commandes d'un coup et avancerait
// 1000 fois plus vite. Le serveur décide, toujours.
const MAX_CMD_PAR_TICK = 5;

// Garde-fous. Le VPS est petit : mieux vaut refuser proprement que ramer.
const MAX_JOUEURS_PAR_SALLE = 32;
const MAX_SALLES = 20;
const MAX_CONNEXIONS = 200;

let connexionsOuvertes = 0;

/* ==========================================================================
   Les salles
   ========================================================================== */

const salles = new Map(); // nom -> Salle

class Salle {
  constructor(nom) {
    this.nom = nom;
    this.joueurs = new Map(); // id -> joueur
    this.prochainId = 1;
    this.tick = 0;
    this.boucle = null;
  }

  arrivee(co, nom) {
    const id = this.prochainId++;
    const depart = positionDeDepart();

    const joueur = {
      id,
      nom,
      couleur: COULEURS[id % COULEURS.length],
      x: depart.x,
      y: depart.y,
      co,
      fileCommandes: [], // commandes reçues, pas encore appliquées
      dernierSeq: 0, // dernière commande appliquée (sert au client)
    };

    this.joueurs.set(id, joueur);

    co.surMessage = (texte) => this.message(joueur, texte);
    co.surFermeture = () => this.depart(id);

    // Message de bienvenue : le client apprend qui il est et à quoi
    // ressemble le monde.
    co.envoyer(
      JSON.stringify({
        t: "init",
        moi: id,
        monde: MONDE,
        rayon: RAYON,
        murs: MURS,
        tickMs: TICK_MS,
      })
    );

    this.demarrerBoucle();
    return joueur;
  }

  message(joueur, texte) {
    let msg;
    try {
      msg = JSON.parse(texte);
    } catch {
      return; // message pourri : on ignore
    }

    if (msg.t === "cmd") {
      const e = msg.e || {};

      joueur.fileCommandes.push({
        seq: msg.seq | 0,
        dt: Math.min(Math.max(Number(msg.dt) || 0, 0), 0.1), // borne : anti-triche
        e: {
          haut: !!e.haut,
          bas: !!e.bas,
          gauche: !!e.gauche,
          droite: !!e.droite,
        },
      });

      // Si un client spamme, on jette le surplus.
      if (joueur.fileCommandes.length > 60) {
        joueur.fileCommandes.splice(0, joueur.fileCommandes.length - 60);
      }
    } else if (msg.t === "ping") {
      joueur.co.envoyer(JSON.stringify({ t: "pong", t0: msg.t0 }));
    }
  }

  depart(id) {
    if (!this.joueurs.delete(id)) return;

    if (this.joueurs.size === 0) {
      this.arreterBoucle();
      salles.delete(this.nom);
    }
  }

  demarrerBoucle() {
    if (this.boucle) return;
    this.boucle = setInterval(() => this.pas(), TICK_MS);
  }

  arreterBoucle() {
    if (!this.boucle) return;
    clearInterval(this.boucle);
    this.boucle = null;
  }

  // Un « tick » : on applique les commandes en attente, on résout les
  // chevauchements, on envoie l'état du monde à tout le monde.
  pas() {
    this.tick++;

    for (const j of this.joueurs.values()) {
      const lot = j.fileCommandes.splice(0, MAX_CMD_PAR_TICK);
      for (const cmd of lot) {
        simuler(j, cmd.e, cmd.dt);
        j.dernierSeq = cmd.seq;
      }
    }

    this.separerJoueurs();

    // Snapshot : noms de champs très courts, positions arrondies au dixième.
    // À 20 messages/seconde et par joueur, chaque octet compte.
    const joueurs = [];
    for (const j of this.joueurs.values()) {
      joueurs.push({
        i: j.id,
        n: j.nom,
        c: j.couleur,
        x: Math.round(j.x * 10) / 10,
        y: Math.round(j.y * 10) / 10,
        s: j.dernierSeq,
      });
    }

    // La trame est fabriquée UNE fois, puis écrite telle quelle sur chaque
    // socket : c'est ce qui rend la diffusion peu chère quand la salle
    // se remplit.
    const trame = Connexion.trameTexte(
      JSON.stringify({ t: "etat", tick: this.tick, joueurs })
    );

    for (const j of [...this.joueurs.values()]) j.co.envoyerTrame(trame);
  }

  // Deux joueurs ne peuvent pas occuper le même espace : on les écarte
  // doucement. C'est ce qui donne la sensation de « corps » dans l'arène.
  separerJoueurs() {
    const liste = [...this.joueurs.values()];

    for (let a = 0; a < liste.length; a++) {
      for (let b = a + 1; b < liste.length; b++) {
        const p = liste[a];
        const q = liste[b];

        let dx = q.x - p.x;
        let dy = q.y - p.y;
        let d = Math.hypot(dx, dy);

        if (d === 0) {
          dx = 1;
          dy = 0;
          d = 0.0001;
        }

        const chevauchement = 2 * RAYON - d;

        if (chevauchement > 0) {
          const ux = dx / d;
          const uy = dy / d;
          const poussee = chevauchement / 2;
          p.x -= ux * poussee;
          p.y -= uy * poussee;
          q.x += ux * poussee;
          q.y += uy * poussee;
        }
      }
    }
  }
}

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

/* ==========================================================================
   Les fichiers statiques (le client)
   ========================================================================== */

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
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

    reponse.writeHead(200, {
      "content-type": TYPES[path.extname(cible)] || "application/octet-stream",
      // Le client et la physique changent ensemble : un shared.js en cache
      // face à un serveur à jour, et tout le monde tressaute.
      "cache-control": "no-cache",
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

  const cible = salle || new Salle(salon);
  if (!salle) salles.set(salon, cible);

  cible.arrivee(co, nettoyerPseudo(url.searchParams.get("nom")));

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
