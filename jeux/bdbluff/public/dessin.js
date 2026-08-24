// ============================================================================
//  public/dessin.js — l'éditeur de case : palette de couleurs, épaisseurs,
//  gomme, capture des traits en vecteurs, et l'interaction avec les
//  stickers posés (sélection, glisser, +/− taille, pivoter, supprimer).
//
//  Seul ce fichier écoute les évènements pointeur du canvas d'édition —
//  stickers.js ne fait que calculer le nouvel état d'un tableau de
//  stickers, jamais de DOM/canvas directement (sauf sa palette).
// ============================================================================

import { PALETTE_COULEURS, EPAISSEURS_TRAIT, GOMME_EPAISSEUR, CASE_LARGEUR, CASE_HAUTEUR, CASE_TRAITS_MAX, TRAIT_POINTS_MAX } from "./shared.js";
import { dessinerContenu, dessinerTrait, chargerImagesStickers } from "./rendu.js";
import { construirePalette, placerSticker, trouverStickerSous, deplacerSticker, redimensionnerSticker, pivoterSticker, supprimerSticker } from "./stickers.js";

const canvas = document.getElementById("canvas-case");
const ctx = canvas.getContext("2d");

let imagesStickers = null;

let casesJoueur = [];
let contenusParCase = new Map(); // index -> {traits, stickers}
let caseActiveIndex = null;
let contenuActuel = { traits: [], stickers: [] };
let historique = [];

let couleur = PALETTE_COULEURS[0];
let epaisseur = EPAISSEURS_TRAIT[0];
let gommeActive = false;
let stickerArme = null;
let stickerSelectionne = -1;
let traitEnCours = null;
let dragStickerActif = false;

let onModifie = () => {};

export async function initEditeurDessin({ surModification } = {}) {
  onModifie = surModification || onModifie;
  imagesStickers = await chargerImagesStickers();
  construirePaletteCouleurs();
  construirePalette(document.getElementById("palette-stickers"), armerSticker);
  brancherOutils();
  brancherPointeur();
}

/* --------------------------------------------------------------------------
   Cases possédées par ce joueur pour la manche en cours
   -------------------------------------------------------------------------- */

export function chargerCases(indices, contenusExistants = []) {
  casesJoueur = indices;
  contenusParCase = new Map(indices.map((i) => [i, { traits: [], stickers: [] }]));
  for (const c of contenusExistants) {
    if (contenusParCase.has(c.index)) {
      contenusParCase.set(c.index, { traits: c.traits || [], stickers: c.stickers || [] });
    }
  }
  construireOnglets();
  activerCase(indices[0]);
}

function construireOnglets() {
  const conteneur = document.getElementById("onglets-cases");
  conteneur.innerHTML = "";
  if (casesJoueur.length <= 1) return;
  for (const index of casesJoueur) {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.textContent = `Case ${index + 1}`;
    bouton.dataset.index = String(index);
    bouton.addEventListener("click", () => activerCase(index));
    conteneur.appendChild(bouton);
  }
}

function activerCase(index) {
  if (caseActiveIndex !== null) contenusParCase.set(caseActiveIndex, contenuActuel);
  caseActiveIndex = index;
  contenuActuel = contenusParCase.get(index) || { traits: [], stickers: [] };
  historique = [];
  stickerSelectionne = -1;
  afficherReglagesSticker(false);
  document.querySelectorAll("#onglets-cases button").forEach((b) => {
    b.classList.toggle("actif", Number(b.dataset.index) === index);
  });
  redessiner();
}

/** Toutes les cases du joueur, prêtes à être envoyées au serveur. */
export function tousLesContenus() {
  if (caseActiveIndex !== null) contenusParCase.set(caseActiveIndex, contenuActuel);
  return [...contenusParCase.entries()].map(([index, contenu]) => ({ index, traits: contenu.traits, stickers: contenu.stickers }));
}

/* --------------------------------------------------------------------------
   Outils
   -------------------------------------------------------------------------- */

function construirePaletteCouleurs() {
  const conteneur = document.getElementById("palette-couleurs");
  conteneur.innerHTML = "";
  PALETTE_COULEURS.forEach((c, i) => {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "swatch" + (i === 0 ? " actif" : "");
    bouton.style.background = c;
    bouton.title = c;
    bouton.addEventListener("click", () => {
      couleur = c;
      gommeActive = false;
      document.getElementById("outil-gomme").classList.remove("actif");
      conteneur.querySelectorAll(".swatch").forEach((el) => el.classList.remove("actif"));
      bouton.classList.add("actif");
    });
    conteneur.appendChild(bouton);
  });
}

function brancherOutils() {
  document.querySelectorAll(".outil-epaisseur").forEach((bouton) => {
    bouton.addEventListener("click", () => {
      epaisseur = Number(bouton.dataset.epaisseur);
      gommeActive = false;
      document.getElementById("outil-gomme").classList.remove("actif");
      document.querySelectorAll(".outil-epaisseur").forEach((b) => b.classList.remove("actif"));
      bouton.classList.add("actif");
    });
  });

  document.getElementById("outil-gomme").addEventListener("click", (evt) => {
    gommeActive = !gommeActive;
    evt.currentTarget.classList.toggle("actif", gommeActive);
  });

  document.getElementById("outil-annuler").addEventListener("click", () => {
    if (historique.length === 0) return;
    contenuActuel = historique.pop();
    stickerSelectionne = -1;
    afficherReglagesSticker(false);
    redessiner();
    onModifie();
  });

  document.getElementById("outil-effacer").addEventListener("click", () => {
    if (contenuActuel.traits.length === 0 && contenuActuel.stickers.length === 0) return;
    sauvegarderHistorique();
    contenuActuel = { traits: [], stickers: [] };
    stickerSelectionne = -1;
    afficherReglagesSticker(false);
    redessiner();
    onModifie();
  });

  document.getElementById("sticker-agrandir").addEventListener("click", () => ajusterSticker((s, i) => redimensionnerSticker(s, i, 0.15)));
  document.getElementById("sticker-reduire").addEventListener("click", () => ajusterSticker((s, i) => redimensionnerSticker(s, i, -0.15)));
  document.getElementById("sticker-pivoter").addEventListener("click", () => ajusterSticker((s, i) => pivoterSticker(s, i, 15)));
  document.getElementById("sticker-supprimer").addEventListener("click", () => {
    if (stickerSelectionne === -1) return;
    sauvegarderHistorique();
    contenuActuel.stickers = supprimerSticker(contenuActuel.stickers, stickerSelectionne);
    stickerSelectionne = -1;
    afficherReglagesSticker(false);
    redessiner();
    onModifie();
  });
}

function ajusterSticker(fn) {
  if (stickerSelectionne === -1) return;
  contenuActuel.stickers = fn(contenuActuel.stickers, stickerSelectionne);
  redessiner();
  onModifie();
}

function afficherReglagesSticker(visible) {
  document.getElementById("reglages-sticker").hidden = !visible;
}

function armerSticker(id) {
  stickerArme = id;
  stickerSelectionne = -1;
  afficherReglagesSticker(false);
  document.querySelectorAll("#palette-stickers img").forEach((img) => {
    img.classList.toggle("actif", img.dataset.id === id);
  });
}

function sauvegarderHistorique() {
  historique.push(JSON.parse(JSON.stringify(contenuActuel)));
  if (historique.length > 20) historique.shift();
}

/* --------------------------------------------------------------------------
   Pointeur (souris/tactile) sur le canvas
   -------------------------------------------------------------------------- */

function positionCanvas(evt) {
  const rect = canvas.getBoundingClientRect();
  return [((evt.clientX - rect.left) / rect.width) * CASE_LARGEUR, ((evt.clientY - rect.top) / rect.height) * CASE_HAUTEUR];
}

function brancherPointeur() {
  canvas.addEventListener("pointerdown", surPointerDown);
  canvas.addEventListener("pointermove", surPointerMove);
  window.addEventListener("pointerup", surPointerUp);
}

function surPointerDown(evt) {
  evt.preventDefault();
  canvas.setPointerCapture?.(evt.pointerId);
  const [x, y] = positionCanvas(evt);

  if (stickerArme) {
    sauvegarderHistorique();
    contenuActuel.stickers = placerSticker(contenuActuel.stickers, stickerArme, x, y);
    stickerSelectionne = contenuActuel.stickers.length - 1;
    stickerArme = null;
    document.querySelectorAll("#palette-stickers img").forEach((img) => img.classList.remove("actif"));
    afficherReglagesSticker(true);
    redessiner();
    onModifie();
    return;
  }

  const idx = trouverStickerSous(contenuActuel.stickers, x, y);
  if (idx !== -1) {
    stickerSelectionne = idx;
    dragStickerActif = true;
    afficherReglagesSticker(true);
    redessiner();
    return;
  }

  stickerSelectionne = -1;
  afficherReglagesSticker(false);

  if (contenuActuel.traits.length >= CASE_TRAITS_MAX) return;
  sauvegarderHistorique();
  traitEnCours = {
    couleur: gommeActive ? "gomme" : couleur,
    epaisseur: gommeActive ? GOMME_EPAISSEUR : epaisseur,
    points: [[x, y]],
  };
  redessinerAvecTraitEnCours();
}

function surPointerMove(evt) {
  if (dragStickerActif && stickerSelectionne !== -1) {
    const [x, y] = positionCanvas(evt);
    contenuActuel.stickers = deplacerSticker(contenuActuel.stickers, stickerSelectionne, x, y);
    redessiner();
    return;
  }
  if (!traitEnCours) return;
  const [x, y] = positionCanvas(evt);
  if (traitEnCours.points.length < TRAIT_POINTS_MAX) traitEnCours.points.push([x, y]);
  redessinerAvecTraitEnCours();
}

function surPointerUp() {
  if (dragStickerActif) {
    dragStickerActif = false;
    onModifie();
    return;
  }
  if (traitEnCours) {
    if (traitEnCours.points.length > 0) {
      contenuActuel.traits.push(traitEnCours);
      onModifie();
    }
    traitEnCours = null;
    redessiner();
  }
}

/* --------------------------------------------------------------------------
   Rendu
   -------------------------------------------------------------------------- */

function redessiner() {
  dessinerContenu(ctx, contenuActuel, imagesStickers, { largeur: CASE_LARGEUR, hauteur: CASE_HAUTEUR });
  dessinerSelection();
}

function redessinerAvecTraitEnCours() {
  dessinerContenu(ctx, contenuActuel, imagesStickers, { largeur: CASE_LARGEUR, hauteur: CASE_HAUTEUR });
  if (traitEnCours) dessinerTrait(ctx, traitEnCours);
  dessinerSelection();
}

function dessinerSelection() {
  if (stickerSelectionne === -1) return;
  const s = contenuActuel.stickers[stickerSelectionne];
  if (!s) return;
  ctx.save();
  ctx.strokeStyle = "#7c5cff";
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(s.x, s.y, 32 * s.echelle + 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
