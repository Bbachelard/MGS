// ============================================================================
//  shared.js — LE CODE PARTAGÉ entre le navigateur et le serveur.
//
//  C'est le fichier le plus important du jeu. La règle d'or du multijoueur :
//  le client et le serveur doivent calculer le mouvement EXACTEMENT de la même
//  façon. Si les deux calculs diffèrent, le joueur voit son perso « téléporter »
//  en permanence. Donc : une seule fonction de simulation, un seul fichier,
//  importé des deux côtés.
// ============================================================================

// Taille du terrain, en pixels « monde » (indépendant de la taille de l'écran).
export const MONDE = { l: 1600, h: 900 };

// Vitesse d'un joueur, en pixels par seconde.
export const VITESSE = 260;

// Rayon du joueur (un simple cercle pour l'instant).
export const RAYON = 18;

// Le serveur avance la simulation 20 fois par seconde (toutes les 50 ms).
export const TICK_MS = 50;

// Le client envoie ses commandes 30 fois par seconde.
export const PAS_CLIENT = 1 / 30;

// Les obstacles de l'arène : de simples rectangles.
export const MURS = [
  { x: 300, y: 200, l: 40, h: 300 },
  { x: 300, y: 200, l: 300, h: 40 },
  { x: 1260, y: 400, l: 40, h: 300 },
  { x: 1000, y: 660, l: 300, h: 40 },
  { x: 700, y: 420, l: 200, h: 60 },
  { x: 760, y: 100, l: 60, h: 160 },
  { x: 760, y: 640, l: 60, h: 160 },
];

// Palette utilisée pour donner une couleur à chaque joueur.
// La première est l'accent MGS (#7c5cff), pour rester dans la charte du site.
export const COULEURS = [
  "#7c5cff", "#ff6b6b", "#4ade80", "#fbbf24",
  "#c084fc", "#22d3ee", "#fb923c", "#f472b6",
];

// Est-ce qu'un joueur placé en (x, y) touche le mur m ?
// On traite le joueur comme un carré de côté 2*RAYON : c'est approximatif mais
// simple, rapide, et suffisant pour un prototype.
function touche(x, y, m) {
  return (
    x + RAYON > m.x &&
    x - RAYON < m.x + m.l &&
    y + RAYON > m.y &&
    y - RAYON < m.y + m.h
  );
}

/**
 * Avance UN joueur d'un pas de temps, EN LIGNE DROITE vers une cible cliquée.
 *
 * @param {{x:number,y:number}} j            le joueur (modifié sur place)
 * @param {{x:number,y:number}|null} cible   le point cliqué, ou null si personne n'a cliqué
 * @param {number} dt                        durée du pas, en secondes
 *
 * Le déplacement au clic (façon LoL) remplace les touches directionnelles :
 * `cible` est le dernier point cliqué, envoyé dans chaque commande exactement
 * comme l'étaient les touches avant — le client et le serveur en tirent donc
 * un déplacement identique, ce qui reste la seule règle qui compte ici.
 *
 * Point clé, inchangé : on déplace d'abord sur X, on corrige les collisions,
 * PUIS sur Y. Ça évite de rester bloqué dans un coin et ça permet de
 * « glisser » le long des murs, ce qui est beaucoup plus agréable à jouer.
 */
export function simuler(j, cible, dt, facteurVitesse = 1) {
  if (!cible) return; // rien cliqué, ou déjà arrivé : on ne bouge pas

  const versX = cible.x - j.x;
  const versY = cible.y - j.y;
  const distance = Math.hypot(versX, versY);
  if (distance < 1) return; // arrivé — évite de trembler sur place

  // `facteurVitesse` : 1 par défaut, < 1 pendant un ralentissement. Le
  // serveur ET le client doivent connaître ce facteur pour rester
  // synchronisés — voir le champ `rl` du snapshot et `avancerZones()`.
  const pas = Math.min(VITESSE * facteurVitesse * dt, distance);
  const dx = (versX / distance) * pas;
  const dy = (versY / distance) * pas;

  // --- axe X ---
  let nx = j.x + dx;
  for (const m of MURS) {
    if (touche(nx, j.y, m)) {
      nx = dx > 0 ? m.x - RAYON : m.x + m.l + RAYON;
    }
  }
  j.x = Math.max(RAYON, Math.min(MONDE.l - RAYON, nx));

  // --- axe Y ---
  let ny = j.y + dy;
  for (const m of MURS) {
    if (touche(j.x, ny, m)) {
      ny = dy > 0 ? m.y - RAYON : m.y + m.h + RAYON;
    }
  }
  j.y = Math.max(RAYON, Math.min(MONDE.h - RAYON, ny));
}

// Trouve une position de départ libre (pas dans un mur).
export function positionDeDepart() {
  for (let essai = 0; essai < 200; essai++) {
    const x = RAYON + Math.random() * (MONDE.l - 2 * RAYON);
    const y = RAYON + Math.random() * (MONDE.h - 2 * RAYON);
    if (!MURS.some((m) => touche(x, y, m))) return { x, y };
  }
  return { x: MONDE.l / 2, y: MONDE.h / 2 };
}

/* ==========================================================================
   COMBAT — tout ce qui a été ajouté à la version « simple déplacement ».

   Les valeurs sont ici, et nulle part ailleurs : le client s'en sert pour
   dessiner (barres de vie, jauge d'ulti, portée), le serveur pour décider.
   Une seule source de vérité, sinon l'affichage ment.
   ========================================================================== */

// --- points de vie -------------------------------------------------------
export const PV_MAX = 20;             // 5 missiles de base encaissés = mort

// Après la mort : réapparition IMMÉDIATE, à un endroit tiré au sort.
// Une seconde d'invulnérabilité, juste assez pour ne pas mourir deux fois
// dans le même souffle si on réapparaît sous le nez de quelqu'un.
// Mettre 0 pour l'enlever complètement.
export const INVULN_RESPAWN = 1.0;    // secondes

// Éliminer quelqu'un remet à pleine vie. C'est la règle qui récompense
// l'agressivité : finir un adversaire vaut mieux que fuir se soigner.
export const SOIN_AU_KILL = true;

// --- missiles ------------------------------------------------------------
// L'arme de DÉPART est volontairement lente et faible : c'est le point bas
// d'une progression. Chaque palier (voir plus bas) la rapproche de ce qu'elle
// était avant, puis la dépasse.
export const CADENCE_TIR = 0.5;       // secondes entre deux tirs (2 tirs/s)
export const DEGATS_MISSILE = 4;      // 5 touches pour éliminer
export const VITESSE_MISSILE = 720;   // px/s — plus dur à esquiver qu'avant
export const RAYON_MISSILE = 6;
export const DUREE_MISSILE = 2.2;     // s de vol avant disparition
// Le missile naît un peu devant le joueur, sinon il se cogne à son propre
// corps quand on tire en marchant.
export const AVANCE_TIR = RAYON + RAYON_MISSILE + 2;

// --- progression de l'arme ----------------------------------------------
// Tous les 3 kills, un palier est mis de côté. Il est proposé À LA MORT
// SUIVANTE : le joueur choisit alors de gagner en cadence ou en puissance.
// Les paliers se cumulent sans plafond et ne se perdent pas.
export const KILLS_PAR_PALIER = 3;
export const GAIN_CADENCE = 1 / 1.15;  // délai ÷1,15 = +15 % de tirs/s
export const GAIN_DEGATS = 1.15;       // ×1,15 sur les dégâts

/** Le délai entre deux tirs, pour un joueur ayant `n` paliers de cadence. */
export function cadenceDe(n) {
  return CADENCE_TIR * Math.pow(GAIN_CADENCE, n || 0);
}

/** Les dégâts d'un missile, pour un joueur ayant `n` paliers de puissance. */
export function degatsDe(n) {
  // Arrondi : un joueur doit pouvoir compter ses touches. 4 → 5 → 6 → 8 → 10.
  return Math.round(DEGATS_MISSILE * Math.pow(GAIN_DEGATS, n || 0));
}

// --- zones de soin -------------------------------------------------------
export const SOIN_RAYON = 26;         // rayon de la pastille
export const SOIN_RECHARGE = 15;      // s avant réapparition
export const SOINS = [
  { x: 160, y: 160 },
  { x: 1440, y: 160 },
  { x: 160, y: 740 },
  { x: 1440, y: 740 },
];

// --- boucliers -----------------------------------------------------------
// Deux emplacements seulement, au milieu du terrain : le bouclier est un
// enjeu de position, pas un consommable qu'on ramasse en passant.
// Un bouclier annule UNE attaque, quelle qu'elle soit — missile, météorite
// ou rayon d'ulti — puis disparaît.
export const BOUCLIER_RAYON = 26;
export const BOUCLIER_RECHARGE = 20;  // s avant réapparition
export const BOUCLIERS = [
  { x: 620, y: 120 },
  { x: 980, y: 780 },
];

// --- météorites ----------------------------------------------------------
// Elles traversent la carte en ligne droite, SANS prévenir, et éliminent ce
// qu'elles touchent. Elles volent au-dessus des murs : rien ne les arrête
// avant l'autre bord du terrain.
export const METEORITE_RAYON = 34;
export const METEORITE_VITESSE = 620;  // px/s
export const METEORITE_DEGATS = 999;   // c'est une élimination, pas un chiffre
export const METEORITE_DELAI_MIN = 30; // s entre deux météorites
export const METEORITE_DELAI_MAX = 45;
export const METEORITE_ROTATION = 2.4; // rad/s — juste pour le rendu

// --- attaque spéciale : la pause temporelle ------------------------------
// À 100 %, le temps s'arrête pour TOUT LE MONDE et une aiguille se met à
// tourner autour du lanceur. À lui de tirer au bon moment : le rayon part
// dans l'axe de l'aiguille et élimine le premier joueur rencontré. S'il ne
// tire pas au bout d'un tour et demi, l'ulti est perdue.
export const ULTI_MAX = 100;
export const ULTI_PAR_TOUCHE = 10;     // 10 missiles touchés = 1 ulti
export const ULTI_TOURS = 1.5;         // tours décrits par l'aiguille
export const ULTI_DUREE = 3.0;         // s — le temps qu'on a pour tirer
export const ULTI_LONGUEUR = 300;      // longueur de l'aiguille à l'écran
export const RAYON_ULTI = 16;          // rayon du rayon (généreux : c'est dur)
export const VITESSE_RAYON = 1600;     // px/s — pendant que le temps est figé
export const DUREE_RAYON = 0.8;        // s de vol maximum

// --- attaque utilitaire : le flash ---------------------------------------
// Un court bond dans la direction visée, à la LoL : ça ne soigne pas, ça ne
// fait pas de dégâts, mais ça sort d'un mauvais pas ou permet d'en achever
// un. Recharge courte, et surtout : une élimination la réinitialise aussitôt
// — c'est la récompense de l'agressivité, comme le soin au kill.
export const FLASH_DISTANCE = 220;    // px parcourus d'un coup
export const FLASH_RECHARGE = 3;      // s avant de pouvoir la relancer
// Le flash traverse les murs — seules les limites de la carte l'arrêtent
// (voir server/salle.js#declencherFlash). C'est ce qui en fait un VRAI outil
// d'évasion : se réfugier derrière un mur ne suffit plus à être à l'abri.

// --- compétence de zone : le champ de ralentissement ---------------------
// Une zone au sol, invoquée instantanément (pas de temps de charge, contrairement
// à l'ulti), qui ralentit et grignote la vie de quiconque s'y attarde — sauf
// son lanceur. Inspirée d'un sort de zone classique façon MOBA : on la pose
// pour contrôler un couloir, pas pour viser précisément.
export const ZONE_RECHARGE = 10;       // s avant de pouvoir la relancer
// Plus loin que la diagonale du monde (1600×900 ≈ 1836 px) : la portée
// n'est donc jamais ce qui arrête la pose, seuls les murs et les bords de
// la carte le font — la zone peut viser n'importe quel point visible.
export const ZONE_PORTEE = 2000;
export const ZONE_RAYON = 90;          // rayon de la zone au sol
export const ZONE_DUREE = 3.0;         // s pendant lesquelles elle agit
export const ZONE_RALENTI = 0.5;       // ×0,5 sur la vitesse de déplacement
export const ZONE_TIC = 0.5;           // s entre deux tics de dégâts
export const ZONE_DEGATS_TIC = 2;      // dégâts par tic (6 tics max = 12 dégâts)

/**
 * Direction de l'aiguille à l'instant `t` (0 → ULTI_DUREE).
 * Client et serveur appellent LA MÊME fonction : ce que le joueur voit au
 * moment où il clique est exactement ce que le serveur calcule.
 */
export function angleAiguille(gel, t) {
  const p = Math.min(Math.max(t / ULTI_DUREE, 0), 1);
  return gel.angle + 2 * Math.PI * ULTI_TOURS * p;
}

/** Un disque de rayon r placé en (x, y) touche-t-il un mur ? */
export function toucheMur(x, y, r) {
  for (const m of MURS) {
    if (x + r > m.x && x - r < m.x + m.l && y + r > m.y && y - r < m.y + m.h) {
      return true;
    }
  }
  return false;
}

/** Le disque est-il sorti du terrain ? */
export function horsMonde(x, y, r) {
  return x < r || y < r || x > MONDE.l - r || y > MONDE.h - r;
}

/**
 * Avance un missile d'un pas de temps.
 * Renvoie true s'il vit encore, false s'il doit disparaître (mur ou bord).
 * Le serveur seul appelle ceci ; le client se contente d'interpoler ce qu'on
 * lui envoie. Un missile est trop rapide pour valoir une prédiction.
 */
export function avancerMissile(m, dt) {
  m.x += Math.cos(m.a) * VITESSE_MISSILE * dt;
  m.y += Math.sin(m.a) * VITESSE_MISSILE * dt;
  m.vie -= dt;

  if (m.vie <= 0) return false;
  if (horsMonde(m.x, m.y, RAYON_MISSILE)) return false;
  if (toucheMur(m.x, m.y, RAYON_MISSILE)) return false;

  return true;
}

/** Un point de réapparition libre : ni dans un mur, ni sur quelqu'un. */
export function positionDeRespawn(occupants = []) {
  for (let essai = 0; essai < 200; essai++) {
    const p = positionDeDepart();
    const libre = occupants.every(
      (o) => Math.hypot(o.x - p.x, o.y - p.y) > RAYON * 3
    );
    if (libre) return p;
  }
  return positionDeDepart();
}

/**
 * Y a-t-il un mur entre deux points ?
 * Échantillonnage simple : 24 points le long du segment. C'est approximatif
 * (un mur très fin pris de biais peut passer entre deux échantillons), mais
 * c'est suffisant ici — les murs de l'arène font 40 px d'épaisseur minimum.
 */
export function ligneDeVue(x1, y1, x2, y2) {
  const PAS = 24;
  for (let i = 1; i < PAS; i++) {
    const x = x1 + ((x2 - x1) * i) / PAS;
    const y = y1 + ((y2 - y1) * i) / PAS;
    if (toucheMur(x, y, 0)) return false;
  }
  return true;
}
