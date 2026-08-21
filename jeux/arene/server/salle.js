// ============================================================================
//  server/salle.js — une salle de jeu, et TOUTES les règles.
//
//  Le serveur décide de tout : qui tire, qui touche, qui meurt, qui se soigne,
//  qui ramasse un bouclier, quand tombe une météorite, qui déclenche son ulti
//  et ce que fait son rayon. Le client ne fait que dessiner ce qu'on lui envoie
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
  INVULN_RESPAWN,
  SOIN_AU_KILL,
  RAYON_MISSILE,
  DUREE_MISSILE,
  AVANCE_TIR,
  CADENCE_TIR,
  DEGATS_MISSILE,
  KILLS_PAR_PALIER,
  cadenceDe,
  degatsDe,
  SOIN_RAYON,
  SOIN_RECHARGE,
  SOINS,
  BOUCLIER_RAYON,
  BOUCLIER_RECHARGE,
  BOUCLIERS,
  METEORITE_RAYON,
  METEORITE_VITESSE,
  METEORITE_DEGATS,
  METEORITE_DELAI_MIN,
  METEORITE_DELAI_MAX,
  ULTI_MAX,
  ULTI_PAR_TOUCHE,
  ULTI_DUREE,
  ULTI_LONGUEUR,
  RAYON_ULTI,
  VITESSE_RAYON,
  DUREE_RAYON,
  FLASH_DISTANCE,
  FLASH_RECHARGE,
  angleAiguille,
  avancerMissile,
  toucheMur,
  horsMonde,
} from "../public/shared.js";

// Nombre max de commandes traitées par tick et par joueur.
// Sans ça, un tricheur enverrait 1000 commandes d'un coup et avancerait
// 1000 fois plus vite. Le serveur décide, toujours.
const MAX_CMD_PAR_TICK = 5;

const DT = TICK_MS / 1000; // 0,05 s

// Le rayon d'ulti et les météorites vont vite : on découpe leur pas en
// morceaux, sinon ils « sautent » par-dessus un joueur d'un tick à l'autre.
const SOUS_PAS = 8;

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

    // Une pastille par emplacement : `recharge` = secondes restantes avant
    // réapparition (0 = disponible).
    this.soins = SOINS.map(() => ({ recharge: 0 }));
    this.boucliers = BOUCLIERS.map(() => ({ recharge: 0 }));

    this.meteorites = [];
    this.prochaineMeteorite = this.delaiMeteorite();
    this.prochainMeteore = 1;

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
      bouclier: 0, // 1 = une attaque sera annulée
      invuln: INVULN_RESPAWN,
      rechargeTir: 0,
      flashRecharge: 0, // secondes avant de pouvoir relancer le flash

      // Progression de l'arme
      nivCadence: 0,
      nivDegats: 0,
      killsPalier: 0, // kills depuis le dernier palier obtenu
      paliers: 0, // paliers gagnés, pas encore dépensés
      choixOuvert: false, // un choix d'amélioration est affiché au joueur

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
          boucliers: BOUCLIERS,
          bouclierRayon: BOUCLIER_RAYON,
          ultiMax: ULTI_MAX,
          ultiParTouche: ULTI_PAR_TOUCHE,
          ultiDuree: ULTI_DUREE,
          killsParPalier: KILLS_PAR_PALIER,
          flashRecharge: FLASH_RECHARGE,
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
      const a = Number(msg.a);

      // `c` (cible) : le point cliqué, envoyé tel quel à chaque commande —
      // exactement comme l'étaient les touches enfoncées avant. Un client qui
      // n'a rien cliqué (ou vient d'arriver à destination) envoie `null`.
      const c =
        msg.c && Number.isFinite(msg.c.x) && Number.isFinite(msg.c.y)
          ? { x: msg.c.x, y: msg.c.y }
          : null;

      joueur.fileCommandes.push({
        seq: msg.seq | 0,
        dt: Math.min(Math.max(Number(msg.dt) || 0, 0), 0.1), // borne : anti-triche
        c,
        a: Number.isFinite(a) ? a : joueur.angle,
        f: !!msg.f, // le joueur maintient le tir
      });

      // Si un client spamme, on jette le surplus.
      if (joueur.fileCommandes.length > 60) {
        joueur.fileCommandes.splice(0, joueur.fileCommandes.length - 60);
      }
    } else if (msg.t === "ulti") {
      this.declencherUlti(joueur);
    } else if (msg.t === "ultiTir") {
      this.tirerRayon(joueur);
    } else if (msg.t === "flash") {
      this.declencherFlash(joueur);
    } else if (msg.t === "amelioration") {
      this.appliquerAmelioration(joueur, msg.choix);
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
      // pastilles ne rechargent pas, les météorites restent suspendues. Seule
      // l'aiguille tourne — et le rayon, une fois tiré.
      this.avancerCommandesGelees();
      this.avancerUlti();
    } else {
      this.avancerJoueurs();
      this.separerJoueurs();
      this.avancerMissiles();
      this.avancerMeteorites();
      this.avancerRamassages();
    }

    this.diffuser();
  }

  /* ---------------------------------------------------------- déplacements */

  avancerJoueurs() {
    for (const j of this.joueurs.values()) {
      if (j.invuln > 0) j.invuln = Math.max(0, j.invuln - DT);
      if (j.rechargeTir > 0) j.rechargeTir = Math.max(0, j.rechargeTir - DT);
      if (j.flashRecharge > 0) j.flashRecharge = Math.max(0, j.flashRecharge - DT);

      const lot = j.fileCommandes.splice(0, MAX_CMD_PAR_TICK);

      for (const cmd of lot) {
        simuler(j, cmd.c, cmd.dt);
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

  /* ------------------------------------------------------------------ flash */

  /**
   * Un bond instantané dans la direction visée. Comme pour l'ulti, le client
   * ne fait que DEMANDER : c'est le serveur qui vérifie la recharge et qui
   * calcule où le joueur atterrit — sinon n'importe qui rejouerait le message
   * `flash` en boucle pour traverser la carte.
   *
   * On avance par petits pas (comme le rayon d'ulti ou les météorites) pour
   * s'arrêter juste avant un mur plutôt que de le traverser d'un bond.
   */
  declencherFlash(j) {
    if (j.flashRecharge > 0) return;
    if (this.gel) return; // pas de déplacement pendant la pause temporelle

    const PAS = 12;
    const dx = (Math.cos(j.angle) * FLASH_DISTANCE) / PAS;
    const dy = (Math.sin(j.angle) * FLASH_DISTANCE) / PAS;

    let x = j.x;
    let y = j.y;

    for (let i = 0; i < PAS; i++) {
      const nx = x + dx;
      const ny = y + dy;
      if (horsMonde(nx, ny, RAYON) || toucheMur(nx, ny, RAYON)) break;
      x = nx;
      y = ny;
    }

    j.x = Math.max(RAYON, Math.min(MONDE.l - RAYON, x));
    j.y = Math.max(RAYON, Math.min(MONDE.h - RAYON, y));
    j.flashRecharge = FLASH_RECHARGE;

    this.evenements.push({ t: "flash", x: j.x, y: j.y, sur: j.id });
  }

  /* ---------------------------------------------------------------- missiles */

  tirer(j) {
    j.rechargeTir = cadenceDe(j.nivCadence);

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
      // Les dégâts sont figés au départ : améliorer son arme n'augmente pas
      // les missiles déjà en vol.
      degats: degatsDe(j.nivDegats),
      td: j.nivDegats, // sert au client à dessiner le bon projectile
      tv: j.nivCadence,
    });

    this.evenements.push({ t: "tir", x, y, td: j.nivDegats, tv: j.nivCadence });
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
        this.appliquerDegats(cible, this.joueurs.get(m.par) || null, m.degats, true);
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

  /* -------------------------------------------------------------- météorites */

  delaiMeteorite() {
    return (
      METEORITE_DELAI_MIN + Math.random() * (METEORITE_DELAI_MAX - METEORITE_DELAI_MIN)
    );
  }

  /**
   * Une météorite part de loin hors du terrain, vise grossièrement le centre,
   * et le traverse. Elle vole AU-DESSUS des murs : rien ne l'arrête, et c'est
   * ce qui la rend redoutable. Aucun avertissement — c'est le choix assumé.
   */
  lancerMeteorite() {
    const cx = MONDE.l / 2;
    const cy = MONDE.h / 2;

    const depuis = Math.random() * Math.PI * 2;
    const x = cx + Math.cos(depuis) * 1200;
    const y = cy + Math.sin(depuis) * 1200;

    // La visée n'est pas le centre exact, sinon toutes les météorites se
    // ressembleraient.
    const versX = cx + (Math.random() - 0.5) * 700;
    const versY = cy + (Math.random() - 0.5) * 500;

    this.meteorites.push({
      id: this.prochainMeteore++,
      x,
      y,
      a: Math.atan2(versY - y, versX - x),
    });

    this.evenements.push({ t: "meteorite", x, y });
  }

  avancerMeteorites() {
    this.prochaineMeteorite -= DT;
    if (this.prochaineMeteorite <= 0) {
      this.lancerMeteorite();
      this.prochaineMeteorite = this.delaiMeteorite();
    }

    const restantes = [];

    for (const m of this.meteorites) {
      const dx = (Math.cos(m.a) * METEORITE_VITESSE * DT) / SOUS_PAS;
      const dy = (Math.sin(m.a) * METEORITE_VITESSE * DT) / SOUS_PAS;

      for (let k = 0; k < SOUS_PAS; k++) {
        m.x += dx;
        m.y += dy;

        // Elle traverse : elle peut faucher plusieurs joueurs d'affilée.
        for (const j of [...this.joueurs.values()]) {
          if (j.invuln > 0) continue;
          if (Math.hypot(j.x - m.x, j.y - m.y) >= RAYON + METEORITE_RAYON) continue;
          this.appliquerDegats(j, null, METEORITE_DEGATS, false);
        }
      }

      // On la garde tant qu'elle n'est pas franchement sortie du cadre.
      const dehors =
        m.x < -300 || m.y < -300 || m.x > MONDE.l + 300 || m.y > MONDE.h + 300;

      if (!dehors) restantes.push(m);
    }

    this.meteorites = restantes;
  }

  /* ------------------------------------------------------------------ dégâts */

  appliquerDegats(cible, tireur, degats, chargeUlti) {
    // Le bouclier passe avant tout le reste : il annule l'attaque en entier,
    // qu'elle vienne d'un missile, d'une météorite ou d'un rayon d'ulti.
    if (cible.bouclier > 0) {
      cible.bouclier--;
      this.evenements.push({ t: "bouclier", x: cible.x, y: cible.y, sur: cible.id });

      // Le tireur ne marque rien, mais son missile a quand même « servi » :
      // la charge d'ulti monte, sinon un bouclier annulerait aussi sa
      // progression, ce qui serait doublement puni.
      if (tireur && chargeUlti) {
        tireur.ulti = Math.min(ULTI_MAX, tireur.ulti + ULTI_PAR_TOUCHE);
      }
      return;
    }

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

    if (tueur && tueur.id !== cible.id) {
      tueur.kills++;

      // Éliminer remet à pleine vie : c'est la récompense de l'agressivité.
      if (SOIN_AU_KILL && tueur.pv < PV_MAX) {
        tueur.pv = PV_MAX;
        this.evenements.push({ t: "soin", x: tueur.x, y: tueur.y, sur: tueur.id });
      }

      // Même récompense pour le flash : un kill le rend disponible tout de
      // suite, qu'il ait été utilisé ou non.
      tueur.flashRecharge = 0;

      // Un palier d'arme tous les 10 kills. Il est mis de côté et proposé à
      // la mort suivante — pas tout de suite : on ne coupe pas un duel pour
      // afficher un menu.
      tueur.killsPalier++;
      if (tueur.killsPalier >= KILLS_PAR_PALIER) {
        tueur.killsPalier -= KILLS_PAR_PALIER;
        tueur.paliers++;
        this.evenements.push({
          t: "palier",
          sur: tueur.id,
          nom: tueur.nom,
          enAttente: tueur.paliers,
        });
      }
    }

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
    cible.rechargeTir = cadenceDe(cible.nivCadence);
    cible.bouclier = 0; // le bouclier ne survit pas à son porteur

    // C'est ici que le choix d'arme est proposé : à la mort, pas avant.
    if (cible.paliers > 0) cible.choixOuvert = true;

    // Les missiles de la victime disparaissent avec elle : sinon on encaisse
    // un tir venu d'un joueur qui n'est plus là.
    this.missiles = this.missiles.filter((m) => m.par !== cible.id);
  }

  /* ------------------------------------------------------- amélioration d'arme */

  appliquerAmelioration(j, choix) {
    // Le client propose, le serveur vérifie : sans palier en réserve, il ne se
    // passe rien, quel que soit le nombre de messages envoyés.
    if (!j.choixOuvert || j.paliers <= 0) return;
    if (choix !== "cadence" && choix !== "degats") return;

    if (choix === "cadence") j.nivCadence++;
    else j.nivDegats++;

    j.paliers--;
    if (j.paliers <= 0) j.choixOuvert = false;

    this.evenements.push({
      t: "amelioration",
      sur: j.id,
      nom: j.nom,
      choix,
      nc: j.nivCadence,
      nd: j.nivDegats,
    });
  }

  /* ------------------------------------------------------ soins et boucliers */

  avancerRamassages() {
    this.ramasser(this.soins, SOINS, SOIN_RAYON, SOIN_RECHARGE, (j) => {
      if (j.pv >= PV_MAX) return false; // à pleine vie, on ne gaspille pas
      j.pv = PV_MAX;
      this.evenements.push({ t: "soin", x: j.x, y: j.y, sur: j.id });
      return true;
    });

    this.ramasser(this.boucliers, BOUCLIERS, BOUCLIER_RAYON, BOUCLIER_RECHARGE, (j) => {
      if (j.bouclier > 0) return false; // on n'en empile pas deux
      j.bouclier = 1;
      this.evenements.push({ t: "bouclier-pris", x: j.x, y: j.y, sur: j.id });
      return true;
    });
  }

  /** Fait tourner un jeu de pastilles : recharge, détection, effet. */
  ramasser(etats, places, rayon, recharge, effet) {
    for (let i = 0; i < etats.length; i++) {
      const pastille = etats[i];

      if (pastille.recharge > 0) {
        pastille.recharge = Math.max(0, pastille.recharge - DT);
        continue;
      }

      const p = places[i];

      for (const j of this.joueurs.values()) {
        if (Math.hypot(j.x - p.x, j.y - p.y) > rayon + RAYON) continue;
        if (!effet(j)) continue;
        pastille.recharge = recharge;
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
      angle: j.angle, // l'aiguille démarre dans la direction visée
      t: 0,
      rayon: null, // le projectile, une fois tiré
    };

    this.evenements.push({ t: "ulti", x: j.x, y: j.y, par: j.id, nom: j.nom });
  }

  /**
   * Le lanceur clique : l'aiguille se fige et le rayon part dans son axe.
   * C'est tout l'intérêt de la compétence — le temps est arrêté, mais il faut
   * quand même viser juste.
   */
  tirerRayon(j) {
    if (!this.gel || this.gel.parId !== j.id || this.gel.rayon) return;

    const angle = angleAiguille(this.gel, this.gel.t);
    const depart = RAYON + RAYON_ULTI + 2;

    this.gel.rayon = {
      x: this.gel.x + Math.cos(angle) * depart,
      y: this.gel.y + Math.sin(angle) * depart,
      a: angle,
      vie: DUREE_RAYON,
    };

    this.evenements.push({ t: "ulti-tir", x: this.gel.x, y: this.gel.y });
  }

  avancerUlti() {
    const g = this.gel;

    // --- phase 1 : l'aiguille tourne, on attend le clic -------------------
    if (!g.rayon) {
      g.t = Math.min(g.t + DT, ULTI_DUREE);
      // Un tour et demi sans tirer : l'ulti est perdue.
      if (g.t >= ULTI_DUREE) this.finUlti(false, { x: g.x, y: g.y });
      return;
    }

    // --- phase 2 : le rayon vole, temps toujours figé ---------------------
    const r = g.rayon;
    const dx = (Math.cos(r.a) * VITESSE_RAYON * DT) / SOUS_PAS;
    const dy = (Math.sin(r.a) * VITESSE_RAYON * DT) / SOUS_PAS;

    for (let k = 0; k < SOUS_PAS; k++) {
      r.x += dx;
      r.y += dy;

      // Un mur arrête le rayon net : il n'y a plus de ligne de vue à
      // vérifier, la trajectoire EST une ligne droite.
      if (horsMonde(r.x, r.y, RAYON_ULTI) || toucheMur(r.x, r.y, RAYON_ULTI)) {
        this.finUlti(false, r);
        return;
      }

      const cible = this.premierTouche(r.x, r.y, RAYON_ULTI, g.parId);

      if (cible) {
        const tireur = this.joueurs.get(g.parId) || null;
        // Une touche = une élimination, quel que soit le nombre de PV.
        this.appliquerDegats(cible, tireur, PV_MAX + 999, false);
        this.finUlti(true, r);
        return;
      }
    }

    r.vie -= DT;
    if (r.vie <= 0) this.finUlti(false, r);
  }

  finUlti(touche, p) {
    this.evenements.push({
      t: touche ? "ulti-touche" : "ulti-rate",
      x: Math.round(p.x),
      y: Math.round(p.y),
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
        b: j.bouclier,
        fl: Math.round(j.flashRecharge * 10) / 10,
        nc: j.nivCadence,
        nd: j.nivDegats,
        kp: j.killsPalier,
        ch: j.choixOuvert ? j.paliers : 0,
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
        td: m.td,
        tv: m.tv,
      })),
      mt: this.meteorites.map((m) => ({
        i: m.id,
        x: Math.round(m.x),
        y: Math.round(m.y),
        a: Math.round(m.a * 100) / 100,
      })),
      // Recharge des pastilles, au dixième de seconde : le client affiche le
      // compte à rebours sans avoir à le deviner.
      so: this.soins.map((s) => Math.round(s.recharge * 10) / 10),
      bo: this.boucliers.map((s) => Math.round(s.recharge * 10) / 10),
    };

    if (this.gel) {
      etat.g = {
        par: this.gel.parId,
        nom: this.gel.nom,
        c: this.gel.couleur,
        x: Math.round(this.gel.x),
        y: Math.round(this.gel.y),
        // L'angle courant de l'aiguille est calculé ici et envoyé tel quel :
        // ce que le joueur voit est ce que le serveur utilisera au clic.
        an: Math.round(angleAiguille(this.gel, this.gel.t) * 1000) / 1000,
        lg: ULTI_LONGUEUR,
        r: Math.round(1000 * (ULTI_DUREE - this.gel.t)) / 1000,
      };

      if (this.gel.rayon) {
        etat.g.ray = {
          x: Math.round(this.gel.rayon.x),
          y: Math.round(this.gel.rayon.y),
          a: Math.round(this.gel.rayon.a * 1000) / 1000,
        };
      }
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
