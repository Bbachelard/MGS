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
