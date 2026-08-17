// ============================================================================
//  server.js — le serveur de jeu, exécuté sur Cloudflare.
//
//  Deux morceaux :
//    1. le Worker (export default)   -> le « standard téléphonique ». Il ne fait
//       que router : /ws  ->  la bonne salle.
//    2. la classe ArenaRoom          -> un Durable Object. C'est UNE salle de
//       jeu : elle garde en mémoire la liste des joueurs, leurs positions, et
//       tourne 20 fois par seconde. Toutes les connexions d'une même salle
//       arrivent forcément sur la MÊME instance, quelque part dans le monde.
//       C'est ce qui rend le multijoueur possible sur Cloudflare (un Worker
//       normal, lui, est sans mémoire et redémarre à chaque requête).
// ============================================================================

import {
  MONDE,
  TICK_MS,
  RAYON,
  COULEURS,
  MURS,
  simuler,
  positionDeDepart,
} from "../public/shared.js";

// Nombre max de commandes traitées par tick et par joueur.
// Sans ça, un tricheur pourrait envoyer 1000 commandes d'un coup et avancer
// 1000 fois plus vite. Le serveur décide, toujours.
const MAX_CMD_PAR_TICK = 5;

// Garde-fou : au-delà, la salle refuse les nouveaux arrivants. Une salle
// n'est qu'un objet en mémoire, mais le snapshot diffusé grossit avec le
// carré du nombre de joueurs (n joueurs × n positions, 20 fois par seconde).
const MAX_JOUEURS = 32;

export class ArenaRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;

    // id -> joueur
    this.joueurs = new Map();
    this.prochainId = 1;
    this.tick = 0;
    this.boucle = null;
  }

  // ---------------------------------------------------------------- entrée
  async fetch(requete) {
    if (requete.headers.get("Upgrade") !== "websocket") {
      return new Response("Cette adresse attend une connexion WebSocket.", {
        status: 426,
      });
    }

    if (this.joueurs.size >= MAX_JOUEURS) {
      return new Response("Salle pleine.", { status: 503 });
    }

    const url = new URL(requete.url);
    const nom = nettoyerPseudo(url.searchParams.get("nom"));

    // Un WebSocketPair, c'est un tuyau à deux bouts : on garde le bout
    // « serveur » et on renvoie le bout « client » au navigateur.
    const paire = new WebSocketPair();
    const client = paire[0];
    const serveur = paire[1];
    serveur.accept();

    this.arrivee(serveur, nom);

    return new Response(null, { status: 101, webSocket: client });
  }

  // ------------------------------------------------------------- connexion
  arrivee(ws, nom) {
    const id = this.prochainId++;
    const depart = positionDeDepart();

    const joueur = {
      id,
      nom,
      couleur: COULEURS[id % COULEURS.length],
      x: depart.x,
      y: depart.y,
      ws,
      fileCommandes: [], // commandes reçues, pas encore appliquées
      dernierSeq: 0, // dernière commande appliquée (sert au client)
    };
    this.joueurs.set(id, joueur);

    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return; // message pourri : on ignore
      }

      if (msg.t === "cmd") {
        // Une commande = un pas de simulation demandé par le client.
        const e = msg.e || {};
        joueur.fileCommandes.push({
          seq: msg.seq | 0,
          dt: Math.min(Math.max(msg.dt || 0, 0), 0.1), // borne : anti-triche
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
        this.envoyer(joueur, { t: "pong", t0: msg.t0 });
      }
    });

    const partir = () => this.depart(id);
    ws.addEventListener("close", partir);
    ws.addEventListener("error", partir);

    // Message de bienvenue : le client apprend qui il est et à quoi ressemble
    // le monde.
    this.envoyer(joueur, {
      t: "init",
      moi: id,
      monde: MONDE,
      rayon: RAYON,
      murs: MURS,
      tickMs: TICK_MS,
    });

    this.demarrerBoucle();
  }

  depart(id) {
    this.joueurs.delete(id);
    if (this.joueurs.size === 0) this.arreterBoucle();
  }

  // ---------------------------------------------------------- boucle de jeu
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

    this.diffuser({ t: "etat", tick: this.tick, joueurs });
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

  // ------------------------------------------------------------------ envoi
  envoyer(joueur, objet) {
    try {
      joueur.ws.send(JSON.stringify(objet));
    } catch {
      this.depart(joueur.id);
    }
  }

  diffuser(objet) {
    const texte = JSON.stringify(objet); // sérialisé UNE fois pour tous
    for (const j of [...this.joueurs.values()]) {
      try {
        j.ws.send(texte);
      } catch {
        this.depart(j.id);
      }
    }
  }
}

/**
 * Le pseudo vient du client (et le site MGS le passe en clair dans l'URL) :
 * il est réaffiché à tous les autres joueurs, donc il ne doit contenir ni
 * balise, ni saut de ligne. Le rendu se fait dans un <canvas> — pas de HTML —
 * mais on nettoie quand même à la source plutôt que de compter dessus.
 */
function nettoyerPseudo(brut) {
  const nom = String(brut || "")
    .replace(/[<>&"'\r\n\t]/g, "")
    .trim()
    .slice(0, 16);

  return nom === "" ? "Anonyme" : nom;
}

// ---------------------------------------------------------------- le Worker
export default {
  async fetch(requete, env) {
    const url = new URL(requete.url);

    if (url.pathname === "/ws") {
      // Le nom du salon devient un identifiant de Durable Object : on le
      // borne, sinon n'importe qui peut en créer une infinité.
      const salon = (url.searchParams.get("salon") || "principal")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "")
        .slice(0, 24) || "principal";

      // idFromName : le même nom de salon donne TOUJOURS le même Durable
      // Object. C'est comme ça que deux joueurs se retrouvent ensemble.
      const id = env.ARENA.idFromName(salon);
      return env.ARENA.get(id).fetch(requete);
    }

    // Les autres URL sont servies par [assets] (le dossier public/).
    return new Response("Introuvable", { status: 404 });
  },
};
