// ============================================================================
//  public/rendu.js — tout ce qui affiche quelque chose : composer une case
//  (traits + stickers) sur un canvas, la planche complète, le chat, la
//  liste de vote, les scores, le minuteur.
//
//  dessin.js (l'éditeur) et client.js (les écrans en lecture seule) partagent
//  les mêmes fonctions de composition — un trait posé pendant l'édition doit
//  se dessiner PIXEL POUR PIXEL comme il apparaîtra dans la planche finale.
// ============================================================================

import { STICKERS, STICKER_TAILLE_BASE, CASE_LARGEUR, CASE_HAUTEUR } from "./shared.js";

/* --------------------------------------------------------------------------
   Composition d'une case
   -------------------------------------------------------------------------- */

export function chargerImagesStickers() {
  const entrees = STICKERS.map(
    ({ id }) =>
      new Promise((resoudre) => {
        const img = new Image();
        img.onload = () => resoudre([id, img]);
        img.onerror = () => resoudre([id, null]);
        img.src = `stickers/${id}.svg`;
      })
  );
  return Promise.all(entrees).then((paires) => new Map(paires));
}

/** Dessine un seul trait (ou un point si un seul point) sur `ctx`, tel quel. */
export function dessinerTrait(ctx, trait) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = trait.epaisseur;

  if (trait.couleur === "gomme") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "#000000";
    ctx.fillStyle = "#000000";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = trait.couleur;
    ctx.fillStyle = trait.couleur;
  }

  const points = trait.points || [];
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0][0], points[0][1], trait.epaisseur / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (points.length > 1) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.stroke();
  }
  ctx.restore();
}

function dessinerSticker(ctx, sticker, imagesStickers) {
  const img = imagesStickers?.get(sticker.id);
  if (!img) return;
  ctx.save();
  ctx.translate(sticker.x, sticker.y);
  ctx.rotate((sticker.rotation * Math.PI) / 180);
  ctx.scale(sticker.echelle, sticker.echelle);
  ctx.drawImage(img, -STICKER_TAILLE_BASE / 2, -STICKER_TAILLE_BASE / 2, STICKER_TAILLE_BASE, STICKER_TAILLE_BASE);
  ctx.restore();
}

/**
 * Compose une case entière : fond blanc, tous les traits dans l'ordre, puis
 * tous les stickers par-dessus (la gomme n'efface donc que l'encre, jamais
 * un sticker déjà posé — pour retirer un sticker, on le sélectionne et on
 * le supprime).
 */
export function dessinerContenu(ctx, contenu, imagesStickers, { largeur, hauteur } = {}) {
  const l = largeur ?? CASE_LARGEUR;
  const h = hauteur ?? CASE_HAUTEUR;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, l, h);
  ctx.restore();

  for (const trait of contenu?.traits || []) dessinerTrait(ctx, trait);

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  for (const sticker of contenu?.stickers || []) dessinerSticker(ctx, sticker, imagesStickers);
  ctx.restore();
}

/* --------------------------------------------------------------------------
   La planche complète (révélation / vote / résultats)
   -------------------------------------------------------------------------- */

/**
 * @param {HTMLElement} conteneur
 * @param {{index:number, proprietaire:string, contenu:object}[]} planche
 * @param {Map<string, {pseudo:string}>} joueursParId
 * @param {Map<string, HTMLImageElement>} imagesStickers
 */
export function afficherPlanche(conteneur, planche, joueursParId, imagesStickers) {
  conteneur.innerHTML = "";
  for (const { proprietaire, contenu } of planche) {
    const carte = document.createElement("div");
    carte.className = "case-planche";

    const canvas = document.createElement("canvas");
    canvas.width = CASE_LARGEUR;
    canvas.height = CASE_HAUTEUR;
    carte.appendChild(canvas);

    const qui = document.createElement("div");
    qui.className = "qui";
    qui.textContent = joueursParId.get(proprietaire)?.pseudo || "?";
    carte.appendChild(qui);

    conteneur.appendChild(carte);
    dessinerContenu(canvas.getContext("2d"), contenu, imagesStickers, { largeur: CASE_LARGEUR, hauteur: CASE_HAUTEUR });
  }
}

/* --------------------------------------------------------------------------
   Chat
   -------------------------------------------------------------------------- */

export function ajouterMessageChat(conteneur, { pseudo, texte }) {
  const div = document.createElement("div");
  div.className = "msg-chat";
  const nom = document.createElement("span");
  nom.className = "pseudo";
  nom.textContent = pseudo + " : ";
  div.appendChild(nom);
  div.appendChild(document.createTextNode(texte));
  conteneur.appendChild(div);
  conteneur.scrollTop = conteneur.scrollHeight;
}

export function ajouterMessageSysteme(conteneur, texte) {
  const div = document.createElement("div");
  div.className = "msg-chat systeme";
  div.textContent = texte;
  conteneur.appendChild(div);
  conteneur.scrollTop = conteneur.scrollHeight;
}

export function viderChat(conteneur) {
  conteneur.innerHTML = "";
}

/* --------------------------------------------------------------------------
   Vote
   -------------------------------------------------------------------------- */

export function afficherListeVote(conteneur, joueurs, moiId, onVoter) {
  conteneur.innerHTML = "";
  for (const j of joueurs) {
    if (j.id === moiId) continue;
    const ligne = document.createElement("div");
    ligne.className = "vote-joueur";
    ligne.dataset.id = j.id;

    const nom = document.createElement("span");
    nom.textContent = j.pseudo + (j.connecte ? "" : " (déconnecté)");
    ligne.appendChild(nom);

    const statut = document.createElement("span");
    statut.className = "a-vote";
    ligne.appendChild(statut);

    ligne.addEventListener("click", () => onVoter(j.id));
    conteneur.appendChild(ligne);
  }
}

export function marquerChoixVote(conteneur, cibleId) {
  conteneur.querySelectorAll(".vote-joueur").forEach((el) => {
    el.classList.toggle("choisi", el.dataset.id === cibleId);
  });
}

export function marquerVotants(conteneur, votantsIds) {
  const votants = new Set(votantsIds);
  conteneur.querySelectorAll(".vote-joueur").forEach((el) => {
    const statut = el.querySelector(".a-vote");
    if (statut) statut.textContent = votants.has(el.dataset.id) ? "✓ a voté" : "";
  });
}

/* --------------------------------------------------------------------------
   Scores
   -------------------------------------------------------------------------- */

export function afficherScores(conteneur, scores, joueurs) {
  conteneur.innerHTML = "";
  const tries = [...joueurs].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0));
  for (const j of tries) {
    const points = scores[j.id] ?? 0;
    const ligne = document.createElement("div");
    ligne.className = "ligne-score";

    const nom = document.createElement("span");
    nom.textContent = j.pseudo;
    const pts = document.createElement("span");
    pts.textContent = `${points} pt${points > 1 ? "s" : ""}`;

    ligne.appendChild(nom);
    ligne.appendChild(pts);
    conteneur.appendChild(ligne);
  }
}

/* --------------------------------------------------------------------------
   Minuteur
   -------------------------------------------------------------------------- */

let minuterieId = null;

export function demarrerMinuteur(finPhase) {
  const el = document.getElementById("jeu-minuteur");
  arreterMinuteur();
  const maj = () => {
    const restant = Math.max(0, Math.round((finPhase - Date.now()) / 1000));
    el.textContent = `${restant}s`;
    el.classList.toggle("urgent", restant <= 10);
    if (restant <= 0) arreterMinuteur();
  };
  maj();
  minuterieId = setInterval(maj, 250);
}

export function arreterMinuteur() {
  if (minuterieId) clearInterval(minuterieId);
  minuterieId = null;
}
