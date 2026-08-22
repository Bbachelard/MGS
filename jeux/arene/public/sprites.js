// ============================================================================
//  sprites.js — les personnages dessinés à la main.
//
//  Un personnage = UNE image PNG vue du dessus, tournée vers la DROITE.
//  Le jeu la fait pivoter vers la souris : tu n'as donc qu'un seul dessin à
//  produire par personnage, pas huit.
//
//  Pour ajouter le tien :
//    1. dessine `public/perso/<id>.png` (96×96, fond transparent, nez à droite) ;
//    2. ajoute une ligne dans `public/perso/persos.json` ;
//    3. recharge la page — il apparaît dans la liste de l'écran d'accueil.
//
//  `public/perso/gabarit.png` est là pour servir de calque de départ.
// ============================================================================

const images = new Map(); // id -> HTMLImageElement (chargée) ou null (absente)
const enCours = new Set(); // chargements lancés, pas encore terminés
let liste = [];

/** Lit le manifeste et précharge toutes les images qu'il annonce. */
export async function charger() {
  try {
    const reponse = await fetch("perso/persos.json", { cache: "no-cache" });
    if (!reponse.ok) throw new Error("manifeste absent");

    const brut = await reponse.json();

    liste = (Array.isArray(brut) ? brut : [])
      .filter((p) => p && typeof p.id === "string")
      // Même filtre que côté serveur : l'id finit dans un chemin de fichier.
      .filter((p) => /^[a-z0-9-]{1,24}$/.test(p.id))
      .map((p) => ({
        id: p.id,
        nom: String(p.nom || p.id).slice(0, 24),
        fichier: `perso/${p.id}.png`,
      }));
  } catch {
    liste = [];
  }

  await Promise.all(liste.map((p) => precharger(p.id)));
  return liste;
}

export function personnages() {
  return liste;
}

/**
 * Charge une image de personnage. Un échec est mémorisé (null) : sans ça, un
 * fichier manquant relancerait une requête à chaque image de chaque frame.
 */
function precharger(id) {
  if (images.has(id)) return Promise.resolve(images.get(id));
  if (enCours.has(id)) return Promise.resolve(null);
  enCours.add(id);

  return new Promise((resoudre) => {
    const img = new Image();
    img.onload = () => {
      images.set(id, img);
      resoudre(img);
    };
    img.onerror = () => {
      images.set(id, null);
      resoudre(null);
    };
    img.src = `perso/${id}.png`;
  });
}

/**
 * L'image d'un personnage, ou null s'il n'y en a pas.
 * Appelée pendant le rendu : elle ne doit jamais bloquer. Un id inconnu
 * (un joueur avec un perso qu'on n'a pas) lance un chargement en tâche de
 * fond et renvoie null en attendant — le rendu retombe alors sur le cercle
 * de couleur.
 */
export function image(id) {
  if (!id) return null;
  if (!/^[a-z0-9-]{1,24}$/.test(id)) return null;

  if (!images.has(id)) {
    precharger(id); // une seule fois : `enCours` empêche la rafale
    return null;
  }

  return images.get(id) || null;
}

/* ==========================================================================
   Le décor : les images qui ne sont pas des personnages.

   Pour l'instant une seule, `decor/meteorite.png`. Même principe que les
   personnages : remplace le fichier, le jeu s'en sert au prochain
   rechargement. S'il manque, le rendu retombe sur une boule de feu dessinée
   en code.
   ========================================================================== */

const decors = new Map();
const decorsEnCours = new Set();

export function decor(nom) {
  if (decors.has(nom)) return decors.get(nom);
  if (decorsEnCours.has(nom)) return null;

  decorsEnCours.add(nom);
  const img = new Image();
  img.onload = () => decors.set(nom, img);
  img.onerror = () => decors.set(nom, null);
  img.src = `decor/${nom}.png`;

  return null;
}

/* ==========================================================================
   Photos de profil Steam (skin "steam") — images distantes, une par joueur.

   Même principe de cache que les personnages et le décor : un chargement en
   tâche de fond par URL, jamais relancé, jamais bloquant pour le rendu.
   ========================================================================== */

const avatars = new Map(); // url -> HTMLImageElement (chargée) ou null (échec)
const avatarsEnCours = new Set();

/**
 * L'image d'une photo Steam, ou null tant qu'elle n'est pas prête.
 * `url` vient du serveur (déjà revalidée contre le CDN Steam côté serveur) :
 * aucun filtre supplémentaire n'est nécessaire ici.
 */
export function avatar(url) {
  if (!url) return null;

  if (avatars.has(url)) return avatars.get(url);
  if (avatarsEnCours.has(url)) return null;

  avatarsEnCours.add(url);
  const img = new Image();
  img.onload = () => avatars.set(url, img);
  img.onerror = () => avatars.set(url, null);
  img.src = url;

  return null;
}
