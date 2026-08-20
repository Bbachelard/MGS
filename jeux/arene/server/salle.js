// ============================================================================
//  server/salle.js — une salle de jeu, et TOUTES les règles.
//
//  Le serveur décide de tout : qui tire, qui touche, qui meurt, qui se soigne,
//  qui déclenche son ulti. Le client ne fait que dessiner ce qu'on lui envoie
//  (sauf son propre déplacement, qu'il prédit — voir README).
//
//  Règle à ne jamais oublier : si une décision compte, elle est prise ici.
//  Tout ce qui est laissé au client est, tôt ou tard, contourné.
// ============================================================================

import { Connexion } from "./ws.js";
import {
  MONDE,
  TICK_MS,
  RAYON,
  COULEURS,
  MURS,
  simuler,
  positionDeDepart,
  positionDeRespawn,
  // combat
  PV_MAX,
  DEGATS_MISSILE,
  INVULN_RESPAWN,
  CADENCE_TIR,
  RAYON_MISSILE,
  DUREE_MISSILE,
  AVANCE_TIR,
  SOIN_RAYON,
  SOIN_RECHARGE,
  SOINS,
  ULTI_MAX,
  ULTI_PAR_TOUCHE,
  ULTI_DUREE,
  RAYON_ULTI,
  DEGATS_ULTI,
  positionUlti,
  avancerMissile,
  toucheMur,
  horsMonde,
  ligneDeVue,
} from "../public/shared.js";

// Nombre max de commandes traitées par tick et par joueur.
// Sans ça, un tricheur enverrait 1000 commandes d'un coup et avancerait
// 1000 fois plus vite. Le serveur décide, toujours.
const MAX_CMD_PAR_TICK = 5;

const DT = TICK_MS / 1000; // 0,05 s

// Le projectile d'ulti va vite et tourne : on découpe son pas en morceaux,
// sinon il « saute » par-dessus un joueur d'un tick à l'autre.
const SOUS_PAS_ULTI = 8;

export class Salle {
  constructor(nom, quandVide) {
    this.nom = nom;
    this.quandVide = quandVide; // appelé quand la salle se vide
    this.joueurs = new Map(); // id -> joueur
    this.prochainId = 1;
    this.tick = 0;
    this.boucle = null;

    this.missiles = [];
    this.prochainMissile = 1;

    // Une pastille de soin par emplacement : `recharge` = secondes restantes
    // avant réapparition (0 = disponible).
    this.soins = SOINS.map(() => ({ recharge: 0 }));

    // La pause temporelle en cours, ou null.
    this.gel = null;

    // Ce qui s'est passé pendant le tick : le client en tire les sons et le
    // fil des éliminations. Vidé à chaque diffusion.
    this.evenements = [];
  }

  /* ---------------------------------------------------------------- entrée */

  arrivee(co, nom, sprite) {
    const id = this.prochainId++;
    const depart = positionDeRespawn([...this.joueurs.values()]);

    const joueur = {
      id,
      nom,
      sprite,
      couleur: COULEURS[id % COULEURS.length],
      x: depart.x,
      y: depart.y,
      angle: 0, // direction visée, en radians
      pv: PV_MAX,
      kills: 0,
      morts: 0,
      degats: 0, // dégâts infligés cumulés — pour le tableau des scores
      ulti: 0, // charge, de 0 à 100
      invuln: INVULN_RESPAWN,
      rechargeTir: 0,
      co,
      fileCommandes: [],
      dernierSeq: 0,
    };

    this.joueurs.set(id, joueur);

    co.surMessage = (texte) => this.message(joueur, texte);
    co.surFermeture = () => this.depart(id);

    co.envoyer(
      JSON.stringify({
        t: "init",
        moi: id,
        monde: MONDE,
        rayon: RAYON,
        murs: MURS,
        tickMs: TICK_MS,
        // Le client reçoit les règles plutôt que de les redéclarer : le jour
        // où on rééquilibre, une seule valeur bouge.
        regles: {
          pvMax: PV_MAX,
          degats: DEGATS_MISSILE,
          cadence: CADENCE_TIR,
          soins: SOINS,
          soinRayon: SOIN_RAYON,
          ultiMax: ULTI_MAX,
          ultiParTouche: ULTI_PAR_TOUCHE,
          ultiDuree: ULTI_DUREE,
        },
      })
    );

    this.demarrerBoucle();
    return joueur;
  }

  depart(id) {
    if (!this.joueurs.delete(id)) return;

    // Les missiles d'un partant continuent leur route mais ne créditent plus
    // personne : on les laisse mourir de leur belle mort.
    if (this.gel && this.gel.parId === id) this.gel = null;

    if (this.joueurs.size === 0) {
      this.arreterBoucle();
      this.quandVide?.(this);
    }
  }

  /* --------------------------------------------------------------- messages */

  message(joueur, texte) {
    let msg;
    try {
      msg = JSON.parse(texte);
    } catch {
      return; // message pourri : on ignore
    }

    if (msg.t === "cmd") {
      const e = msg.e || {};
      const a = Number(msg.a);

      joueur.fileCommandes.push({
        seq: msg.seq | 0,
        dt: Math.min(Math.max(Number(msg.dt) || 0, 0), 0.1), // borne : anti-triche
        e: {
          haut: !!e.haut,
          bas: !!e.bas,
          gauche: !!e.gauche,
          droite: !!e.droite,
        },
        a: Number.isFinite(a) ? a : joueur.angle,
        f: !!msg.f, // le joueur maintient le tir
      });

      // Si un client spamme, on jette le surplus.
      if (joueur.fileCommandes.length > 60) {
        joueur.fileCommandes.splice(0, joueur.fileCommandes.length - 60);
      }
    } else if (msg.t === "ulti") {
      this.declencherUlti(joueur);
    } else if (msg.t === "ping") {
      joueur.co.envoyer(JSON.stringify({ t: "pong", t0: msg.t0 }));
    }
  }

  /* ----------------------------------------------------------------- boucle */

  demarrerBoucle() {
    if (this.boucle) return;
    this.boucle = setInterval(() => this.pas(), TICK_MS);
  }

  arreterBoucle() {
    if (!this.boucle) return;
    clearInterval(this.boucle);
    this.boucle = null;
  }

  pas() {
    this.tick++;

    if (this.gel) {
      // PAUSE TEMPORELLE : plus personne ne bouge, plus rien ne vole, les
      // pastilles de soin ne rechargent pas. Seul le projectile d'horloge
      // avance. C'est tout l'intérêt de la compétence.
      this.avancerCommandesGelees();
      this.avancerUlti();
    } else {
      this.avancerJoueurs();
      this.separerJoueurs();
      this.avancerMissiles();
      this.avancerSoins();
    }

    this.diffuser();
  }

  /* ---------------------------------------------------------- déplacements */

  avancerJoueurs() {
    for (const j of this.joueurs.values()) {
      if (j.invuln > 0) j.invuln = Math.max(0, j.invuln - DT);
      if (j.rechargeTir > 0) j.rechargeTir = Math.max(0, j.rechargeTir - DT);

      const lot = j.fileCommandes.splice(0, MAX_CMD_PAR_TICK);

      for (const cmd of lot) {
        simuler(j, cmd.e, cmd.dt);
        j.angle = cmd.a;
        j.dernierSeq = cmd.seq;

        // La cadence ne se contourne pas : elle ne redescend qu'au rythme des
        // ticks, pas à celui des commandes reçues. Envoyer 100 « je tire »
        // dans le même tick ne produit qu'un seul missile.
        if (cmd.f && j.rechargeTir <= 0) this.tirer(j);
      }
    }
  }

  // Pendant le gel, les commandes ne font rien — mais on accuse quand même
  // réception (`dernierSeq`), sinon le client rejouerait à la fin du gel
  // toutes les commandes accumulées et se téléporterait.
  avancerCommandesGelees() {
    for (const j of this.joueurs.values()) {
      const lot = j.fileCommandes.splice(0, MAX_CMD_PAR_TICK);
      for (const cmd of lot) {
        j.angle = cmd.a; // viser reste permis : c'est gratuit et c'est joli
        j.dernierSeq = cmd.seq;
      }
    }
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

  /* ---------------------------------------------------------------- missiles */

  tirer(j) {
    j.rechargeTir = CADENCE_TIR;

    const x = j.x + Math.cos(j.angle) * AVANCE_TIR;
    const y = j.y + Math.sin(j.angle) * AVANCE_TIR;

    // Tirer le nez contre un mur ne doit pas faire naître le missile de
    // l'autre côté.
    if (toucheMur(x, y, RAYON_MISSILE) || horsMonde(x, y, RAYON_MISSILE)) {
      this.evenements.push({ t: "tir", x: j.x, y: j.y });
      return;
    }

    this.missiles.push({
      id: this.prochainMissile++,
      par: j.id,
      x,
      y,
      a: j.angle,
      vie: DUREE_MISSILE,
    });

    this.evenements.push({ t: "tir", x, y });
  }

  avancerMissiles() {
    const restants = [];

    for (const m of this.missiles) {
      if (!avancerMissile(m, DT)) {
        this.evenements.push({ t: "impact", x: m.x, y: m.y });
        continue;
      }

      const cible = this.premierTouche(m.x, m.y, RAYON_MISSILE, m.par);

      if (cible) {
        this.evenements.push({ t: "impact", x: m.x, y: m.y });
        this.appliquerDegats(cible, this.joueurs.get(m.par) || null, DEGATS_MISSILE, true);
        continue;
      }

      restants.push(m);
    }

    this.missiles = restants;
  }

  /** Le premier joueur touchable par un disque en (x, y), en excluant `sauf`. */
  premierTouche(x, y, rayon, sauf) {
    for (const j of this.joueurs.values()) {
      if (j.id === sauf) continue;
      if (j.invuln > 0) continue;
      if (Math.hypot(j.x - x, j.y - y) < RAYON + rayon) return j;
    }
    return null;
  }

  /* ------------------------------------------------------------------ dégâts */

  appliquerDegats(cible, tireur, degats, chargeUlti) {
    const effectifs = Math.min(degats, cible.pv);
    cible.pv -= degats;

    if (tireur) {
      tireur.degats += effectifs;
      // La charge ne monte QUE sur un missile qui touche : l'ulti ne
      // recharge pas l'ulti.
      if (chargeUlti) {
        tireur.ulti = Math.min(ULTI_MAX, tireur.ulti + ULTI_PAR_TOUCHE);
      }
    }

    this.evenements.push({ t: "touche", x: cible.x, y: cible.y, sur: cible.id });

    if (cible.pv <= 0) this.mourir(cible, tireur);
  }

  mourir(cible, tueur) {
    cible.morts++;
    if (tueur && tueur.id !== cible.id) tueur.kills++;

    this.evenements.push({
      t: "mort",
      x: cible.x,
      y: cible.y,
      victime: cible.id,
      nomVictime: cible.nom,
      tueur: tueur ? tueur.id : null,
      nomTueur: tueur ? tueur.nom : null,
    });

    // Réapparition immédiate, à un endroit tiré au sort.
    const ailleurs = positionDeRespawn(
      [...this.joueurs.values()].filter((j) => j.id !== cible.id)
    );

    cible.x = ailleurs.x;
    cible.y = ailleurs.y;
    cible.pv = PV_MAX;
    cible.invuln = INVULN_RESPAWN;
    cible.rechargeTir = CADENCE_TIR;

    // Les missiles de la victime disparaissent avec elle : sinon on encaisse
    // un tir venu d'un joueur qui n'est plus là.
    this.missiles = this.missiles.filter((m) => m.par !== cible.id);
  }

  /* -------------------------------------------------------------------- soins */

  avancerSoins() {
    for (let i = 0; i < this.soins.length; i++) {
      const pastille = this.soins[i];

      if (pastille.recharge > 0) {
        pastille.recharge = Math.max(0, pastille.recharge - DT);
        continue;
      }

      const p = SOINS[i];

      for (const j of this.joueurs.values()) {
        if (j.pv >= PV_MAX) continue; // à pleine vie, on ne gaspille pas la pastille
        if (Math.hypot(j.x - p.x, j.y - p.y) > SOIN_RAYON + RAYON) continue;

        j.pv = PV_MAX;
        pastille.recharge = SOIN_RECHARGE;
        this.evenements.push({ t: "soin", x: p.x, y: p.y, sur: j.id });
        break;
      }
    }
  }

  /* --------------------------------------------------------- pause temporelle */

  declencherUlti(j) {
    if (this.gel) return; // une seule à la fois
    if (j.ulti < ULTI_MAX) return; // le client peut demander, le serveur refuse

    j.ulti = 0;

    this.gel = {
      parId: j.id,
      nom: j.nom,
      couleur: j.couleur,
      x: j.x,
      y: j.y,
      angle: j.angle, // la spirale démarre dans la direction visée
      t: 0,
    };

    this.evenements.push({ t: "ulti", x: j.x, y: j.y, par: j.id, nom: j.nom });
  }

  avancerUlti() {
    const g = this.gel;
    const debut = g.t;
    const fin = Math.min(debut + DT, ULTI_DUREE);

    // On échantillonne la spirale : sans ça, à 1,5 tour en 2,4 s, le
    // projectile passerait au travers d'un joueur entre deux ticks.
    for (let k = 1; k <= SOUS_PAS_ULTI; k++) {
      const t = debut + ((fin - debut) * k) / SOUS_PAS_ULTI;
      const p = positionUlti(g, t);

      // Ni le bord du terrain ni les murs n'arrêtent l'aiguille : sinon
      // l'ulti serait perdue d'avance dès qu'on la déclenche ailleurs qu'au
      // centre exact de l'arène. Ce qu'un mur fait, c'est PROTÉGER : on ne
      // touche personne à travers.
      const cible = this.premierTouche(p.x, p.y, RAYON_ULTI, g.parId);

      if (cible && ligneDeVue(g.x, g.y, cible.x, cible.y)) {
        const tireur = this.joueurs.get(g.parId) || null;
        this.appliquerDegats(cible, tireur, DEGATS_ULTI, false);
        this.finUlti(true, p);
        return;
      }
    }

    g.t = fin;

    // 1 tour et demi et personne : l'ulti est perdue.
    if (g.t >= ULTI_DUREE) this.finUlti(false, positionUlti(g, ULTI_DUREE));
  }

  finUlti(touche, p) {
    this.evenements.push({
      t: touche ? "ulti-touche" : "ulti-rate",
      x: p.x,
      y: p.y,
    });
    this.gel = null;
  }

  /* ---------------------------------------------------------------- diffusion */

  diffuser() {
    // Snapshot : noms de champs très courts, positions arrondies au dixième.
    // À 20 messages/seconde et par joueur, chaque octet compte.
    const joueurs = [];

    for (const j of this.joueurs.values()) {
      joueurs.push({
        i: j.id,
        n: j.nom,
        c: j.couleur,
        sp: j.sprite,
        x: Math.round(j.x * 10) / 10,
        y: Math.round(j.y * 10) / 10,
        a: Math.round(j.angle * 100) / 100,
        s: j.dernierSeq,
        pv: j.pv,
        k: j.kills,
        m: j.morts,
        d: j.degats,
        u: j.ulti,
        iv: j.invuln > 0 ? 1 : 0,
      });
    }

    const etat = {
      t: "etat",
      tick: this.tick,
      joueurs,
      pr: this.missiles.map((m) => ({
        i: m.id,
        x: Math.round(m.x),
        y: Math.round(m.y),
        a: Math.round(m.a * 100) / 100,
        p: m.par,
      })),
      // Recharge des pastilles, au dixième de seconde : le client affiche le
      // compte à rebours sans avoir à le deviner.
      so: this.soins.map((s) => Math.round(s.recharge * 10) / 10),
    };

    if (this.gel) {
      const p = positionUlti(this.gel, this.gel.t);
      etat.g = {
        par: this.gel.parId,
        nom: this.gel.nom,
        c: this.gel.couleur,
        x: Math.round(this.gel.x),
        y: Math.round(this.gel.y),
        an: Math.round(this.gel.angle * 1000) / 1000,
        px: Math.round(p.x),
        py: Math.round(p.y),
        r: Math.round(1000 * (ULTI_DUREE - this.gel.t)) / 1000,
      };
    }

    if (this.evenements.length) {
      etat.ev = this.evenements;
      this.evenements = [];
    }

    // La trame est fabriquée UNE fois, puis écrite telle quelle sur chaque
    // socket : c'est ce qui rend la diffusion peu chère quand la salle
    // se remplit.
    const trame = Connexion.trameTexte(JSON.stringify(etat));

    for (const j of [...this.joueurs.values()]) j.co.envoyerTrame(trame);
  }
}

export { positionDeDepart };
