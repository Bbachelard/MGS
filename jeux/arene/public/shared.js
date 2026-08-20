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
 * Avance UN joueur d'un pas de temps.
 *
 * @param {{x:number,y:number}} j       le joueur (modifié sur place)
 * @param {{haut,bas,gauche,droite}} e  les touches enfoncées
 * @param {number} dt                   durée du pas, en secondes
 *
 * Point clé : on déplace d'abord sur X, on corrige les collisions, PUIS sur Y.
 * Ça évite de rester bloqué dans un coin et ça permet de « glisser » le long
 * des murs, ce qui est beaucoup plus agréable à jouer.
 */
export function simuler(j, e, dt) {
  let dx = (e.droite ? 1 : 0) - (e.gauche ? 1 : 0);
  let dy = (e.bas ? 1 : 0) - (e.haut ? 1 : 0);

  // Normalisation : sans ça, aller en diagonale serait 1,41x plus rapide.
  const norme = Math.hypot(dx, dy);
  if (norme > 0) {
    dx /= norme;
    dy /= norme;
  }

  // --- axe X ---
  let nx = j.x + dx * VITESSE * dt;
  for (const m of MURS) {
    if (touche(nx, j.y, m)) {
      nx = dx > 0 ? m.x - RAYON : m.x + m.l + RAYON;
    }
  }
  j.x = Math.max(RAYON, Math.min(MONDE.l - RAYON, nx));

  // --- axe Y ---
  let ny = j.y + dy * VITESSE * dt;
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
export const PV_MAX = 20;             // 4 missiles encaissés = mort
export const DEGATS_MISSILE = 5;

// Après la mort : réapparition IMMÉDIATE, à un endroit tiré au sort.
// Une seconde d'invulnérabilité, juste assez pour ne pas mourir deux fois
// dans le même souffle si on réapparaît sous le nez de quelqu'un.
// Mettre 0 pour l'enlever complètement.
export const INVULN_RESPAWN = 1.0;    // secondes

// --- missiles ------------------------------------------------------------
export const CADENCE_TIR = 0.25;      // secondes entre deux tirs (4 tirs/s)
export const VITESSE_MISSILE = 480;   // px/s — volontairement esquivable
export const RAYON_MISSILE = 6;
export const DUREE_MISSILE = 2.2;     // s de vol avant disparition
// Le missile naît un peu devant le joueur, sinon il se cogne à son propre
// corps quand on tire en marchant.
export const AVANCE_TIR = RAYON + RAYON_MISSILE + 2;

// --- zones de soin -------------------------------------------------------
export const SOIN_RAYON = 26;         // rayon de la pastille
export const SOIN_RECHARGE = 15;      // s avant réapparition
export const SOINS = [
  { x: 160, y: 160 },
  { x: 1440, y: 160 },
  { x: 160, y: 740 },
  { x: 1440, y: 740 },
];

// --- attaque spéciale : la pause temporelle ------------------------------
export const ULTI_MAX = 100;
export const ULTI_PAR_TOUCHE = 10;    // 10 missiles touchés = 1 ulti
export const ULTI_TOURS = 1.5;        // tours d'horloge décrits par le projectile
export const ULTI_DUREE = 2.4;        // s — durée du gel ET du vol
export const ULTI_RAYON_DEBUT = 40;   // le projectile part collé au lanceur
export const ULTI_RAYON_FIN = 380;    // et finit loin : la spirale balaie large
export const RAYON_ULTI = 12;
export const DEGATS_ULTI = 20;        // touche = mort, c'est le prix de 10 touches

/**
 * Position du projectile d'ulti à l'instant `t` (0 → ULTI_DUREE).
 * Une spirale : l'angle tourne à vitesse constante, le rayon grandit.
 * Client et serveur appellent LA MÊME fonction — sinon le joueur voit le
 * projectile passer à côté alors que le serveur le compte comme touché.
 */
export function positionUlti(gel, t) {
  const p = Math.min(Math.max(t / ULTI_DUREE, 0), 1);
  const angle = gel.angle + 2 * Math.PI * ULTI_TOURS * p;
  const rayon = ULTI_RAYON_DEBUT + (ULTI_RAYON_FIN - ULTI_RAYON_DEBUT) * p;

  return {
    x: gel.x + Math.cos(angle) * rayon,
    y: gel.y + Math.sin(angle) * rayon,
    angle,
    rayon,
  };
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
