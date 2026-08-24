// ============================================================================
//  public/stickers.js — la palette de stickers et leur manipulation.
//
//  Deux responsabilités bien séparées :
//    1. construirePalette() : construit la grille de la palette dans le DOM.
//    2. le reste : des fonctions PURES qui transforment un tableau de
//       stickers (placer, déplacer, redimensionner, pivoter, supprimer) —
//       dessin.js est seul à toucher le canvas et les évènements pointeur,
//       ce fichier ne fait que calculer le nouvel état.
//
//  Le placement/déplacement se fait par simple clic-glisser (pas de poignée
//  de redimensionnement à la souris) : la taille et la rotation passent par
//  les boutons +/− et « Pivoter » du panneau, qui apparaît quand un sticker
//  est sélectionné. Plus simple à utiliser au doigt qu'une poignée.
// ============================================================================

import { STICKERS, STICKER_TAILLE_BASE } from "./shared.js";

const ECHELLE_MIN = 0.25;
const ECHELLE_MAX = 4;
const ECHELLE_PAS_DEFAUT = 0.15;
const ROTATION_PAS_DEFAUT = 15;

/**
 * Construit la grille de stickers dans `conteneur`. `onChoisir(id)` est
 * appelé au clic sur un sticker — à dessin.js de décider ce que ça veut
 * dire (armer un placement).
 */
export function construirePalette(conteneur, onChoisir) {
  conteneur.innerHTML = "";
  for (const { id } of STICKERS) {
    const img = document.createElement("img");
    img.src = `stickers/${id}.svg`;
    img.alt = id;
    img.title = id;
    img.dataset.id = id;
    img.addEventListener("click", () => onChoisir(id));
    conteneur.appendChild(img);
  }
}

/** @returns {object[]} nouveau tableau, avec le sticker posé en dernière position (donc au-dessus). */
export function placerSticker(stickers, id, x, y) {
  return [...stickers, { id, x, y, echelle: 1, rotation: 0 }];
}

/**
 * Trouve le sticker sous (x, y), en partant du dessus (dernier posé) —
 * cohérent avec l'ordre de rendu.
 * @returns {number} index dans `stickers`, ou -1
 */
export function trouverStickerSous(stickers, x, y) {
  for (let i = stickers.length - 1; i >= 0; i--) {
    const s = stickers[i];
    const rayon = (STICKER_TAILLE_BASE / 2) * s.echelle;
    const dx = x - s.x;
    const dy = y - s.y;
    if (dx * dx + dy * dy <= rayon * rayon) return i;
  }
  return -1;
}

function remplacer(stickers, index, patch) {
  if (index < 0 || index >= stickers.length) return stickers;
  const copie = stickers.slice();
  copie[index] = { ...copie[index], ...patch };
  return copie;
}

export function deplacerSticker(stickers, index, x, y) {
  return remplacer(stickers, index, { x, y });
}

export function redimensionnerSticker(stickers, index, delta = ECHELLE_PAS_DEFAUT) {
  const actuel = stickers[index];
  if (!actuel) return stickers;
  const echelle = Math.min(ECHELLE_MAX, Math.max(ECHELLE_MIN, Math.round((actuel.echelle + delta) * 100) / 100));
  return remplacer(stickers, index, { echelle });
}

export function pivoterSticker(stickers, index, deltaDeg = ROTATION_PAS_DEFAUT) {
  const actuel = stickers[index];
  if (!actuel) return stickers;
  let rotation = (actuel.rotation + deltaDeg) % 360;
  if (rotation > 180) rotation -= 360;
  if (rotation < -180) rotation += 360;
  return remplacer(stickers, index, { rotation });
}

export function supprimerSticker(stickers, index) {
  if (index < 0 || index >= stickers.length) return stickers;
  return stickers.slice(0, index).concat(stickers.slice(index + 1));
}
