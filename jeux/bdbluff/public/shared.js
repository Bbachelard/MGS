// ============================================================================
//  public/shared.js — les règles de BDBluff, écrites une seule fois.
//
//  Importé par le serveur (server/salon.js) ET par le client (public/*.js) :
//  si les deux calculaient les bornes ou la répartition des cases chacun de
//  leur côté, ils finiraient par diverger. Exactement le rôle de shared.js
//  dans l'Arène (bloc COMBAT) — un seul endroit à modifier pour rééquilibrer,
//  et les fonctions pures d'ici sont testables sans réseau.
// ============================================================================

/* --------------------------------------------------------------------------
   Bornes de partie
   -------------------------------------------------------------------------- */

export const JOUEURS_MIN = 3;
export const JOUEURS_MAX = 6;

export const CASES_MIN = 4;
export const CASES_MAX = 8;
export const CASES_DEFAUT = 6;

export const TEMPS_PAR_CASE_MIN = 20; // secondes
export const TEMPS_PAR_CASE_MAX = 90;
export const TEMPS_PAR_CASE_DEFAUT = 45;

export const MANCHES_MIN = 1;
export const MANCHES_MAX = 5;
export const MANCHES_DEFAUT = 3;

export const TEMPS_VOTE = 90; // secondes, fixe (pas réglable par l'hôte)
export const DUREE_REVELATION = 8; // secondes, pause avant le vote pour lire la planche
export const DUREE_DEVINETTE = 30; // secondes, dernière chance de l'imposteur démasqué
export const DUREE_PAUSE_RESULTATS = 12; // secondes, avant la manche suivante

export const POINTS_INNOCENT = 1;
export const POINTS_IMPOSTEUR = 3;

/* --------------------------------------------------------------------------
   Garde-fous sur le contenu d'une case (anti-abus mémoire, comme les MAX_*
   de l'Arène) — vérifiés côté serveur, jamais seulement côté client.
   -------------------------------------------------------------------------- */

export const CASE_TRAITS_MAX = 60; // traits par case
export const CASE_STICKERS_MAX = 40; // stickers posés par case
export const TRAIT_POINTS_MAX = 400; // points par trait

// Espace logique d'une case : tout le monde dessine dans ce repère, quelle
// que soit la taille réelle de son écran — le client met à l'échelle, le
// serveur ne connaît que ces coordonnées-là.
export const CASE_LARGEUR = 480;
export const CASE_HAUTEUR = 360;
export const STICKER_TAILLE_BASE = 64; // px logiques, à échelle 1
const MARGE_COORD = 200; // tolérance hors-cadre (trait qui déborde un peu)

export const PALETTE_COULEURS = Object.freeze([
  "#1f1f1f", // noir
  "#ffffff", // blanc
  "#e0393e", // rouge
  "#f2a93b", // orange
  "#f5e042", // jaune
  "#3ea16c", // vert
  "#3b82c4", // bleu
  "#7c5cff", // violet — l'accent du site
]);

export const EPAISSEURS_TRAIT = Object.freeze([4, 10]); // fin / épais, en px
export const GOMME_EPAISSEUR = 24;

/* --------------------------------------------------------------------------
   Catalogue des stickers. Les fichiers vivent dans public/stickers/<id>.svg
   — cette liste est la source de vérité des id valides, y compris côté
   serveur qui ne charge jamais les SVG (voir stickers/README.md).
   -------------------------------------------------------------------------- */

export const STICKERS = Object.freeze([
  // personnages
  { id: "bonhomme", categorie: "personnage" },
  { id: "bonhomme-content", categorie: "personnage" },
  { id: "bonhomme-triste", categorie: "personnage" },
  { id: "robot", categorie: "personnage" },
  { id: "fantome", categorie: "personnage" },
  { id: "chat", categorie: "personnage" },
  { id: "chien", categorie: "personnage" },
  { id: "extraterrestre", categorie: "personnage" },
  // émotions / symboles
  { id: "coeur", categorie: "emotion" },
  { id: "coeur-brise", categorie: "emotion" },
  { id: "etoile", categorie: "emotion" },
  { id: "eclair-colere", categorie: "emotion" },
  { id: "point-interrogation", categorie: "emotion" },
  { id: "point-exclamation", categorie: "emotion" },
  // objets
  { id: "chapeau", categorie: "objet" },
  { id: "lunettes", categorie: "objet" },
  { id: "epee", categorie: "objet" },
  { id: "bouclier", categorie: "objet" },
  { id: "valise", categorie: "objet" },
  { id: "telephone", categorie: "objet" },
  { id: "cadeau", categorie: "objet" },
  { id: "cle", categorie: "objet" },
  { id: "bombe", categorie: "objet" },
  { id: "potion", categorie: "objet" },
  // décor
  { id: "soleil", categorie: "decor" },
  { id: "lune", categorie: "decor" },
  { id: "nuage", categorie: "decor" },
  { id: "arbre", categorie: "decor" },
  { id: "maison", categorie: "decor" },
  { id: "montagne", categorie: "decor" },
  { id: "porte", categorie: "decor" },
  { id: "fenetre", categorie: "decor" },
  // effets et bulles de BD
  { id: "boom", categorie: "effet" },
  { id: "paf", categorie: "effet" },
  { id: "zzz", categorie: "effet" },
  { id: "bulle-parole", categorie: "effet" },
  { id: "bulle-pensee", categorie: "effet" },
  { id: "splash", categorie: "effet" },
  { id: "etincelles", categorie: "effet" },
  { id: "fumee", categorie: "effet" },
]);

export const STICKER_IDS = new Set(STICKERS.map((s) => s.id));

/* --------------------------------------------------------------------------
   Catégories de thèmes (voir themes.js pour le contenu)
   -------------------------------------------------------------------------- */

export const CATEGORIES_THEME = Object.freeze({
  FAMILIAL: "familial",
  SOIREE: "soiree",
});

/* --------------------------------------------------------------------------
   Phases de la manche
   -------------------------------------------------------------------------- */

export const PHASES = Object.freeze({
  LOBBY: "lobby",
  DESSIN: "dessin",
  REVELATION: "revelation",
  VOTE: "vote",
  RESULTATS_MANCHE: "resultats_manche",
  RESULTATS_PARTIE: "resultats_partie",
});

/* --------------------------------------------------------------------------
   Réglages d'un salon — bornage
   -------------------------------------------------------------------------- */

function bornerEntier(valeur, min, max, defaut) {
  const n = Number(valeur);
  if (!Number.isFinite(n)) return defaut;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function bornerCases(v) {
  return bornerEntier(v, CASES_MIN, CASES_MAX, CASES_DEFAUT);
}

export function bornerTempsParCase(v) {
  return bornerEntier(v, TEMPS_PAR_CASE_MIN, TEMPS_PAR_CASE_MAX, TEMPS_PAR_CASE_DEFAUT);
}

export function bornerManches(v) {
  return bornerEntier(v, MANCHES_MIN, MANCHES_MAX, MANCHES_DEFAUT);
}

/* --------------------------------------------------------------------------
   Répartition des cases entre joueurs
   -------------------------------------------------------------------------- */

/**
 * Répartition "à la donne" (round-robin) : la case i (0-indexée) revient au
 * joueur (i % joueurs.length). Deux cases adjacentes n'appartiennent donc
 * jamais au même joueur — dès que joueurs.length >= 2, ce qui est toujours
 * vrai (minimum 3 joueurs) — et l'écart entre deux joueurs quelconques est
 * au plus une case.
 *
 * @param {string[]} idsJoueurs ordre stable (ordre d'arrivée dans le salon)
 * @param {number} nbCases
 * @returns {string[]} propriétaire de chaque case, longueur nbCases
 */
export function repartirCases(idsJoueurs, nbCases) {
  if (idsJoueurs.length === 0) return [];
  const proprietaires = [];
  for (let i = 0; i < nbCases; i++) {
    proprietaires.push(idsJoueurs[i % idsJoueurs.length]);
  }
  return proprietaires;
}

/** Indices (0-indexés, dans l'ordre de la planche) des cases d'un joueur. */
export function casesDe(idJoueur, proprietaires) {
  const indices = [];
  for (let i = 0; i < proprietaires.length; i++) {
    if (proprietaires[i] === idJoueur) indices.push(i);
  }
  return indices;
}

/**
 * Durée (s) de la phase DESSIN pour TOUT le salon : un seul minuteur pour
 * tous, calé sur le joueur qui a le plus de cases. Les autres ont donc du
 * temps de marge, mais personne n'attend un joueur qui traînerait alors que
 * lui-même a fini plus tôt.
 */
export function dureeDessinPhase(proprietaires, tempsParCase) {
  const comptes = new Map();
  for (const id of proprietaires) comptes.set(id, (comptes.get(id) || 0) + 1);
  const max = comptes.size === 0 ? 0 : Math.max(...comptes.values());
  return max * tempsParCase;
}

/* --------------------------------------------------------------------------
   Contenu d'une case — validation (anti-abus, pas anti-mauvais-goût : le
   serveur ne juge jamais CE qui est dessiné, seulement la taille)
   -------------------------------------------------------------------------- */

function nombreFini(v, min, max) {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

function traitValide(trait) {
  if (!trait || typeof trait !== "object") return false;
  if (!EPAISSEURS_TRAIT.includes(trait.epaisseur) && trait.epaisseur !== GOMME_EPAISSEUR) {
    return false;
  }
  if (typeof trait.couleur !== "string" || !PALETTE_COULEURS.includes(trait.couleur)) {
    // La gomme n'a pas de couleur valide dans la palette : elle utilise "gomme".
    if (trait.couleur !== "gomme") return false;
  }
  if (!Array.isArray(trait.points) || trait.points.length === 0 || trait.points.length > TRAIT_POINTS_MAX) {
    return false;
  }
  for (const p of trait.points) {
    if (!Array.isArray(p) || p.length !== 2) return false;
    if (!nombreFini(p[0], -MARGE_COORD, CASE_LARGEUR + MARGE_COORD)) return false;
    if (!nombreFini(p[1], -MARGE_COORD, CASE_HAUTEUR + MARGE_COORD)) return false;
  }
  return true;
}

function stickerValide(sticker) {
  if (!sticker || typeof sticker !== "object") return false;
  if (typeof sticker.id !== "string" || !STICKER_IDS.has(sticker.id)) return false;
  if (!nombreFini(sticker.x, -MARGE_COORD, CASE_LARGEUR + MARGE_COORD)) return false;
  if (!nombreFini(sticker.y, -MARGE_COORD, CASE_HAUTEUR + MARGE_COORD)) return false;
  if (!nombreFini(sticker.echelle, 0.25, 4)) return false;
  if (!nombreFini(sticker.rotation, -360, 360)) return false;
  return true;
}

/** Valide un contenu de case envoyé par un client, tel quel (traits+stickers). */
export function caseValide(contenu) {
  if (!contenu || typeof contenu !== "object") return false;
  const traits = contenu.traits;
  const stickers = contenu.stickers;
  if (!Array.isArray(traits) || traits.length > CASE_TRAITS_MAX) return false;
  if (!Array.isArray(stickers) || stickers.length > CASE_STICKERS_MAX) return false;
  return traits.every(traitValide) && stickers.every(stickerValide);
}

export function caseVide() {
  return { traits: [], stickers: [] };
}

/* --------------------------------------------------------------------------
   Tirage de l'imposteur — sans répétition avant que tout le monde soit
   passé une fois (façon "sac de jetons" qu'on remélange une fois vidé).
   -------------------------------------------------------------------------- */

/**
 * @param {string[]} idsJoueurs joueurs actuellement dans le salon
 * @param {string[]} restants joueurs qui n'ont pas encore été imposteur
 *   dans le cycle en cours (peut être vide, ou contenir des id partis)
 * @param {() => number} rng injectable pour les tests
 * @returns {{ imposteur: string, restants: string[] }}
 */
export function tirerImposteur(idsJoueurs, restants, rng = Math.random) {
  let bassin = restants.filter((id) => idsJoueurs.includes(id));
  if (bassin.length === 0) bassin = [...idsJoueurs];
  const i = Math.floor(rng() * bassin.length);
  const imposteur = bassin[Math.min(i, bassin.length - 1)];
  return { imposteur, restants: bassin.filter((id) => id !== imposteur) };
}

/* --------------------------------------------------------------------------
   Vote
   -------------------------------------------------------------------------- */

/**
 * Dépouille un vote. `votes` : Map idVotant -> idCible, DÉJÀ filtrée par
 * l'appelant aux seuls joueurs connectés (un déconnecté ne compte pas dans
 * le dénominateur, mais son vote posé avant sa déconnexion reste valable).
 */
export function depouillerVote(votes, idImposteur) {
  const comptes = new Map();
  for (const cible of votes.values()) {
    comptes.set(cible, (comptes.get(cible) || 0) + 1);
  }
  let max = 0;
  let gagnants = [];
  for (const [cible, n] of comptes) {
    if (n > max) {
      max = n;
      gagnants = [cible];
    } else if (n === max) {
      gagnants.push(cible);
    }
  }
  if (max === 0 || gagnants.length !== 1) {
    return { demasque: false, cible: null, egalite: gagnants.length > 1 };
  }
  const cible = gagnants[0];
  return { demasque: cible === idImposteur, cible, egalite: false };
}

/* --------------------------------------------------------------------------
   Score
   -------------------------------------------------------------------------- */

/** @returns {{id: string, delta: number}[]} */
export function pointsManche(idsJoueurs, idImposteur, imposteurGagne) {
  return idsJoueurs.map((id) => {
    if (id === idImposteur) {
      return { id, delta: imposteurGagne ? POINTS_IMPOSTEUR : 0 };
    }
    return { id, delta: imposteurGagne ? 0 : POINTS_INNOCENT };
  });
}

/* --------------------------------------------------------------------------
   Devinette de l'imposteur démasqué — comparaison volontairement souple
   (pas d'égalité stricte de chaîne : "un vampire qui paie ses impôts" doit
   compter comme juste pour "Un vampire qui doit payer ses impôts").
   -------------------------------------------------------------------------- */

const MOTS_VIDES = new Set([
  "un", "une", "des", "le", "la", "les", "de", "du", "au", "aux", "qui", "que",
  "a", "à", "et", "en", "sur", "dans", "son", "sa", "ses", "l", "d", "c", "est",
  "avec", "pour", "par", "se", "sa", "ce", "cette",
]);

function normaliserMots(texte) {
  return String(texte || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((m) => m.length > 2 && !MOTS_VIDES.has(m));
}

/**
 * @param {string} proposition ce que tape l'imposteur
 * @param {string} themeReel le vrai thème de la manche
 * @returns {boolean} juste si au moins la moitié des mots significatifs du
 *   thème réel se retrouvent dans la proposition.
 */
export function devinetteCorrecte(proposition, themeReel) {
  const motsReel = normaliserMots(themeReel);
  if (motsReel.length === 0) return false;
  const motsProp = new Set(normaliserMots(proposition));
  const communs = motsReel.filter((m) => motsProp.has(m)).length;
  return communs / motsReel.length >= 0.5;
}
