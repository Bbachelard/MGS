// ============================================================================
//  rendu.js — tout ce qui se dessine dans le <canvas>.
//
//  Ce fichier ne décide de rien : il reçoit l'état à afficher et le peint.
//  Le séparer du réseau évite le fichier de 900 lignes où l'on ne retrouve
//  plus rien, et permet de changer le look sans toucher au jeu.
// ============================================================================

import {
  MONDE,
  RAYON,
  RAYON_MISSILE,
  PV_MAX,
  ULTI_MAX,
  SOINS,
  SOIN_RAYON,
  SOIN_RECHARGE,
  MURS,
  positionUlti,
  ULTI_DUREE,
} from "./shared.js";

import { image } from "./sprites.js";

// La caméra du dernier rendu. Le client s'en sert pour transformer la
// position de la souris (pixels écran) en angle de visée (monde).
export const camera = { x: 0, y: 0 };

export function dessiner(ctx, vue, etat) {
  const { mx, my } = etat;

  // Caméra centrée sur nous, bloquée aux bords du monde.
  camera.x =
    MONDE.l <= vue.l
      ? (MONDE.l - vue.l) / 2
      : Math.max(0, Math.min(MONDE.l - vue.l, mx - vue.l / 2));
  camera.y =
    MONDE.h <= vue.h
      ? (MONDE.h - vue.h) / 2
      : Math.max(0, Math.min(MONDE.h - vue.h, my - vue.h / 2));

  ctx.fillStyle = "#121218";
  ctx.fillRect(0, 0, vue.l, vue.h);

  ctx.save();
  ctx.translate(-Math.round(camera.x), -Math.round(camera.y));

  fond(ctx);
  pastillesDeSoin(ctx, etat.soins, etat.temps);
  murs(ctx);
  missiles(ctx, etat.missiles);
  joueurs(ctx, etat);
  if (etat.gel) spirale(ctx, etat.gel, etat.temps);

  ctx.restore();

  if (etat.gel) voileDeGel(ctx, vue, etat);
  viseur(ctx, etat.souris);
}

/* ------------------------------------------------------------------ décor */

function fond(ctx) {
  ctx.strokeStyle = "#1c1c25";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= MONDE.l; x += 80) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, MONDE.h);
  }
  for (let y = 0; y <= MONDE.h; y += 80) {
    ctx.moveTo(0, y);
    ctx.lineTo(MONDE.l, y);
  }
  ctx.stroke();

  ctx.strokeStyle = "rgba(124, 92, 255, .45)";
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, MONDE.l, MONDE.h);
}

function murs(ctx) {
  for (const m of MURS) {
    ctx.fillStyle = "#1d1d24";
    ctx.fillRect(m.x, m.y, m.l, m.h);
    ctx.strokeStyle = "#3b3550";
    ctx.lineWidth = 2;
    ctx.strokeRect(m.x, m.y, m.l, m.h);
  }
}

/* ---------------------------------------------------------------- soins */

function pastillesDeSoin(ctx, recharges, temps) {
  for (let i = 0; i < SOINS.length; i++) {
    const p = SOINS[i];
    const recharge = recharges ? recharges[i] || 0 : 0;

    if (recharge > 0) {
      // Absente : on laisse l'emplacement visible, avec le décompte et un
      // arc qui se remplit. Savoir QUAND elle revient fait partie du jeu.
      ctx.strokeStyle = "rgba(74, 222, 128, .18)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, SOIN_RAYON, 0, Math.PI * 2);
      ctx.stroke();

      const avance = 1 - recharge / SOIN_RECHARGE;
      ctx.strokeStyle = "rgba(74, 222, 128, .5)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, SOIN_RAYON, -Math.PI / 2, -Math.PI / 2 + avance * Math.PI * 2);
      ctx.stroke();

      ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(74, 222, 128, .65)";
      ctx.fillText(Math.ceil(recharge) + " s", p.x, p.y + 5);
      continue;
    }

    // Disponible : ça respire doucement pour attirer l'œil.
    const pulse = 1 + Math.sin(temps / 320) * 0.06;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(pulse, pulse);

    const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, SOIN_RAYON);
    halo.addColorStop(0, "rgba(74, 222, 128, .45)");
    halo.addColorStop(1, "rgba(74, 222, 128, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, SOIN_RAYON, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#4ade80";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, SOIN_RAYON - 6, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#4ade80";
    ctx.fillRect(-3, -11, 6, 22);
    ctx.fillRect(-11, -3, 22, 6);
    ctx.restore();
  }
}

/* -------------------------------------------------------------- missiles */

function missiles(ctx, liste) {
  for (const m of liste) {
    // Une traînée derrière : à 480 px/s, un point seul est illisible.
    const tx = m.x - Math.cos(m.a) * 16;
    const ty = m.y - Math.sin(m.a) * 16;

    const trainee = ctx.createLinearGradient(tx, ty, m.x, m.y);
    trainee.addColorStop(0, "rgba(255, 196, 120, 0)");
    trainee.addColorStop(1, "rgba(255, 196, 120, .75)");

    ctx.strokeStyle = trainee;
    ctx.lineWidth = RAYON_MISSILE;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(m.x, m.y);
    ctx.stroke();

    ctx.fillStyle = "#ffe9c4";
    ctx.beginPath();
    ctx.arc(m.x, m.y, RAYON_MISSILE * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* --------------------------------------------------------------- joueurs */

function joueurs(ctx, etat) {
  for (const j of etat.liste) {
    const estMoi = j.i === etat.monId;
    const x = estMoi ? etat.mx : j.x;
    const y = estMoi ? etat.my : j.y;

    ctx.save();

    // Invulnérable après réapparition : on clignote. C'est le langage
    // universel du « ne tire pas, ça ne servirait à rien ».
    if (j.iv) ctx.globalAlpha = 0.45 + 0.35 * Math.sin(etat.temps / 60);

    // Anneau de couleur : même avec le même sprite, deux joueurs restent
    // distinguables.
    ctx.beginPath();
    ctx.arc(x, y, RAYON + 3, 0, Math.PI * 2);
    ctx.fillStyle = j.c;
    ctx.globalAlpha *= estMoi ? 0.95 : 0.75;
    ctx.fill();
    ctx.globalAlpha = j.iv ? 0.45 + 0.35 * Math.sin(etat.temps / 60) : 1;

    const img = image(j.sp);

    if (img) {
      // Le sprite est dessiné pointe à droite : une rotation de l'angle visé
      // suffit. C'est pour ça qu'un seul PNG par personnage suffit.
      const taille = RAYON * 2.4;
      ctx.translate(x, y);
      ctx.rotate(j.a || 0);
      ctx.drawImage(img, -taille / 2, -taille / 2, taille, taille);
      // Pas besoin de défaire la rotation : le ctx.restore() plus bas le fait.
    } else {
      // Pas d'image : le bon vieux cercle, plus le canon qui montre où on vise.
      ctx.beginPath();
      ctx.arc(x, y, RAYON, 0, Math.PI * 2);
      ctx.fillStyle = j.c;
      ctx.fill();
      ctx.lineWidth = estMoi ? 3 : 2;
      ctx.strokeStyle = estMoi ? "#ffffff" : "rgba(0,0,0,.35)";
      ctx.stroke();

      ctx.strokeStyle = "rgba(255,255,255,.85)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(j.a || 0) * (RAYON + 10), y + Math.sin(j.a || 0) * (RAYON + 10));
      ctx.stroke();
    }

    ctx.restore();

    barreDeVie(ctx, x, y, j.pv);

    ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = estMoi ? "#ffffff" : "#c3cbdd";
    ctx.fillText(j.n, x, y - RAYON - 20);
  }
}

function barreDeVie(ctx, x, y, pv) {
  const l = 42;
  const h = 5;
  const gx = x - l / 2;
  const gy = y - RAYON - 14;
  const part = Math.max(0, Math.min(1, (pv ?? PV_MAX) / PV_MAX));

  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.fillRect(gx - 1, gy - 1, l + 2, h + 2);

  // Vert → orange → rouge : lisible d'un coup d'œil, sans lire le chiffre.
  ctx.fillStyle = part > 0.5 ? "#4ade80" : part > 0.25 ? "#fbbf24" : "#ff6b6b";
  ctx.fillRect(gx, gy, l * part, h);
}

/* ------------------------------------------------------- pause temporelle */

function spirale(ctx, gel, temps) {
  const t = ULTI_DUREE - gel.r; // temps écoulé depuis le déclenchement

  // La trace déjà parcourue : c'est elle qui rend la trajectoire lisible et
  // permet d'anticiper la suite du balayage.
  ctx.strokeStyle = "rgba(124, 92, 255, .35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let k = 0; k <= 60; k++) {
    const p = positionUlti({ x: gel.x, y: gel.y, angle: gel.an }, (t * k) / 60);
    if (k === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  // Le cadran, autour du lanceur.
  ctx.strokeStyle = "rgba(124, 92, 255, .18)";
  ctx.lineWidth = 1;
  for (const r of [80, 160, 240, 320]) {
    ctx.beginPath();
    ctx.arc(gel.x, gel.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // L'aiguille.
  ctx.strokeStyle = "rgba(155, 131, 255, .55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(gel.x, gel.y);
  ctx.lineTo(gel.px, gel.py);
  ctx.stroke();

  const halo = ctx.createRadialGradient(gel.px, gel.py, 2, gel.px, gel.py, 26);
  halo.addColorStop(0, "rgba(180, 160, 255, .95)");
  halo.addColorStop(1, "rgba(124, 92, 255, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(gel.px, gel.py, 26, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(gel.px, gel.py, 7 + Math.sin(temps / 90) * 1.5, 0, Math.PI * 2);
  ctx.fill();
}

// Pendant le gel, l'écran se teinte : personne ne doit se demander pourquoi
// son personnage ne répond plus.
function voileDeGel(ctx, vue, etat) {
  ctx.fillStyle = "rgba(28, 20, 60, .32)";
  ctx.fillRect(0, 0, vue.l, vue.h);

  ctx.textAlign = "center";
  ctx.font = "700 26px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "rgba(200, 190, 255, .9)";
  ctx.fillText("PAUSE TEMPORELLE", vue.l / 2, 74);

  ctx.font = "600 14px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = etat.gel.c || "#9b83ff";
  ctx.fillText(etat.gel.nom, vue.l / 2, 98);
}

/* --------------------------------------------------------------- viseur */

function viseur(ctx, souris) {
  if (!souris) return;

  ctx.strokeStyle = "rgba(255,255,255,.55)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(souris.x, souris.y, 9, 0, Math.PI * 2);
  ctx.moveTo(souris.x - 15, souris.y);
  ctx.lineTo(souris.x - 4, souris.y);
  ctx.moveTo(souris.x + 4, souris.y);
  ctx.lineTo(souris.x + 15, souris.y);
  ctx.moveTo(souris.x, souris.y - 15);
  ctx.lineTo(souris.x, souris.y - 4);
  ctx.moveTo(souris.x, souris.y + 4);
  ctx.lineTo(souris.x, souris.y + 15);
  ctx.stroke();
}

export { PV_MAX, ULTI_MAX };
