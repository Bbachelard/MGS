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
  BOUCLIERS,
  BOUCLIER_RAYON,
  BOUCLIER_RECHARGE,
  METEORITE_RAYON,
  RAYON_ULTI,
  MURS,
} from "./shared.js";

import { image, decor } from "./sprites.js";

// La caméra du dernier rendu. Le client s'en sert pour transformer la
// position de la souris (pixels écran) en angle de visée (monde).
export const camera = { x: 0, y: 0 };

// Le projectile change de tête à mesure que l'arme progresse. Deux familles :
// chaud quand c'est la puissance qui monte, froid quand c'est la cadence.
const TEINTES_DEGATS = ["#ffe9c4", "#ffd08a", "#ff9d5c", "#ff6b6b", "#ff4fd8", "#c084fc"];
const TEINTES_CADENCE = ["#ffe9c4", "#cdf3ff", "#8fe6ff", "#4fd6ff", "#22d3ee", "#7c5cff"];

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
  pastilles(ctx, etat, etat.temps);
  murs(ctx);
  missiles(ctx, etat.missiles);
  joueurs(ctx, etat);
  meteorites(ctx, etat.meteorites, etat.temps);
  if (etat.gel) horloge(ctx, etat);

  ctx.restore();

  if (etat.gel) voileDeGel(ctx, vue, etat);
  viseur(ctx, etat.souris, etat.gel && etat.gel.par === etat.monId);
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

/* ------------------------------------------------------- soins et boucliers */

function pastilles(ctx, etat, temps) {
  pastille(ctx, SOINS, etat.soins, SOIN_RAYON, SOIN_RECHARGE, "74, 222, 128", temps, croix);
  pastille(ctx, BOUCLIERS, etat.boucliers, BOUCLIER_RAYON, BOUCLIER_RECHARGE, "56, 189, 248", temps, ecusson);
}

function pastille(ctx, places, recharges, rayon, duree, rvb, temps, symbole) {
  for (let i = 0; i < places.length; i++) {
    const p = places[i];
    const recharge = recharges ? recharges[i] || 0 : 0;

    if (recharge > 0) {
      // Absente : on laisse l'emplacement visible, avec le décompte et un
      // arc qui se remplit. Savoir QUAND elle revient fait partie du jeu.
      ctx.strokeStyle = `rgba(${rvb}, .18)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rayon, 0, Math.PI * 2);
      ctx.stroke();

      const avance = 1 - recharge / duree;
      ctx.strokeStyle = `rgba(${rvb}, .5)`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rayon, -Math.PI / 2, -Math.PI / 2 + avance * Math.PI * 2);
      ctx.stroke();

      ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = `rgba(${rvb}, .65)`;
      ctx.fillText(Math.ceil(recharge) + " s", p.x, p.y + 5);
      continue;
    }

    // Disponible : ça respire doucement pour attirer l'œil.
    const pulse = 1 + Math.sin(temps / 320) * 0.06;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(pulse, pulse);

    const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, rayon);
    halo.addColorStop(0, `rgba(${rvb}, .45)`);
    halo.addColorStop(1, `rgba(${rvb}, 0)`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, rayon, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgb(${rvb})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, rayon - 6, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = `rgb(${rvb})`;
    symbole(ctx);
    ctx.restore();
  }
}

function croix(ctx) {
  ctx.fillRect(-3, -11, 6, 22);
  ctx.fillRect(-11, -3, 22, 6);
}

function ecusson(ctx) {
  ctx.beginPath();
  ctx.moveTo(0, -11);
  ctx.lineTo(9, -6);
  ctx.lineTo(9, 3);
  ctx.quadraticCurveTo(9, 9, 0, 12);
  ctx.quadraticCurveTo(-9, 9, -9, 3);
  ctx.lineTo(-9, -6);
  ctx.closePath();
  ctx.fill();
}

/* -------------------------------------------------------------- missiles */

function missiles(ctx, liste) {
  for (const m of liste) {
    const td = m.td || 0;
    const tv = m.tv || 0;

    // La tête du projectile grossit avec la puissance, la traînée s'allonge
    // avec la cadence : on voit d'un coup d'œil à quoi on a affaire.
    const teinte =
      td >= tv
        ? TEINTES_DEGATS[Math.min(td, TEINTES_DEGATS.length - 1)]
        : TEINTES_CADENCE[Math.min(tv, TEINTES_CADENCE.length - 1)];
    const taille = RAYON_MISSILE * (1 + 0.16 * td);
    const longueur = 16 + 5 * tv;

    const tx = m.x - Math.cos(m.a) * longueur;
    const ty = m.y - Math.sin(m.a) * longueur;

    const trainee = ctx.createLinearGradient(tx, ty, m.x, m.y);
    trainee.addColorStop(0, teinte + "00");
    trainee.addColorStop(1, teinte + "cc");

    ctx.strokeStyle = trainee;
    ctx.lineWidth = taille;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(m.x, m.y);
    ctx.stroke();

    ctx.fillStyle = "#fff8ec";
    ctx.beginPath();
    ctx.arc(m.x, m.y, taille * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ------------------------------------------------------------ météorites */

function meteorites(ctx, liste, temps) {
  if (!liste) return;

  const img = decor("meteorite");

  for (const m of liste) {
    // La traînée de feu : c'est elle qui dit d'où ça vient, donc où ça va.
    const tx = m.x - Math.cos(m.a) * 130;
    const ty = m.y - Math.sin(m.a) * 130;

    // Deux traits superposés : un halo large et diffus, un cœur clair et
    // étroit. Un seul dégradé donnerait une bande plate et sale.
    ctx.lineCap = "round";

    const halo = ctx.createLinearGradient(tx, ty, m.x, m.y);
    halo.addColorStop(0, "rgba(255, 110, 40, 0)");
    halo.addColorStop(1, "rgba(255, 140, 55, .28)");
    ctx.strokeStyle = halo;
    ctx.lineWidth = METEORITE_RAYON * 1.9;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(m.x, m.y);
    ctx.stroke();

    const coeur = ctx.createLinearGradient(tx, ty, m.x, m.y);
    coeur.addColorStop(0, "rgba(255, 210, 140, 0)");
    coeur.addColorStop(1, "rgba(255, 232, 180, .65)");
    ctx.strokeStyle = coeur;
    ctx.lineWidth = METEORITE_RAYON * 0.6;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(m.x, m.y);
    ctx.stroke();

    ctx.save();
    ctx.translate(m.x, m.y);

    if (img) {
      // Elle tourne sur elle-même en plus d'avancer : le PNG peut donc être
      // dessiné dans n'importe quel sens.
      ctx.rotate(m.a + temps / 420);
      const taille = METEORITE_RAYON * 2.4;
      ctx.drawImage(img, -taille / 2, -taille / 2, taille, taille);
    } else {
      const boule = ctx.createRadialGradient(-6, -6, 4, 0, 0, METEORITE_RAYON);
      boule.addColorStop(0, "#fff0c4");
      boule.addColorStop(0.45, "#ff9d3c");
      boule.addColorStop(1, "#a33208");
      ctx.fillStyle = boule;
      ctx.beginPath();
      ctx.arc(0, 0, METEORITE_RAYON, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 220, 160, .6)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();
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

    if (j.b > 0) bouclier(ctx, x, y, etat.temps);

    barreDeVie(ctx, x, y, j.pv);

    ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = estMoi ? "#ffffff" : "#c3cbdd";
    ctx.fillText(j.n, x, y - RAYON - 20);
  }
}

// Un anneau bleu qui tourne : on voit tout de suite qui va encaisser un tir
// pour rien.
function bouclier(ctx, x, y, temps) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(temps / 700);
  ctx.strokeStyle = "rgba(56, 189, 248, .9)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 7]);
  ctx.beginPath();
  ctx.arc(0, 0, RAYON + 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
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

function horloge(ctx, etat) {
  const gel = etat.gel;
  const jeLance = gel.par === etat.monId;

  // Le cadran.
  ctx.strokeStyle = "rgba(124, 92, 255, .16)";
  ctx.lineWidth = 1;
  for (const r of [gel.lg * 0.33, gel.lg * 0.66, gel.lg]) {
    ctx.beginPath();
    ctx.arc(gel.x, gel.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Les repères : la direction de chaque adversaire, marquée sur le cadran.
  // Sans eux, tirer au bon moment relèverait de la loterie ; avec eux, c'est
  // un exercice de rythme — ce qui est tout l'intérêt.
  if (jeLance) {
    for (const j of etat.liste) {
      if (j.i === gel.par) continue;
      const a = Math.atan2(j.y - gel.y, j.x - gel.x);
      const r1 = gel.lg * 0.9;
      const r2 = gel.lg * 1.06;
      ctx.strokeStyle = j.c;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(gel.x + Math.cos(a) * r1, gel.y + Math.sin(a) * r1);
      ctx.lineTo(gel.x + Math.cos(a) * r2, gel.y + Math.sin(a) * r2);
      ctx.stroke();
    }
  }

  // L'aiguille.
  const bx = gel.x + Math.cos(gel.an) * gel.lg;
  const by = gel.y + Math.sin(gel.an) * gel.lg;

  const trait = ctx.createLinearGradient(gel.x, gel.y, bx, by);
  trait.addColorStop(0, "rgba(155, 131, 255, .25)");
  trait.addColorStop(1, "rgba(220, 210, 255, .95)");
  ctx.strokeStyle = trait;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(gel.x, gel.y);
  ctx.lineTo(bx, by);
  ctx.stroke();

  const halo = ctx.createRadialGradient(bx, by, 2, bx, by, 24);
  halo.addColorStop(0, "rgba(200, 185, 255, .9)");
  halo.addColorStop(1, "rgba(124, 92, 255, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(bx, by, 24, 0, Math.PI * 2);
  ctx.fill();

  // Le rayon, une fois tiré.
  if (gel.ray) {
    const qx = gel.ray.x - Math.cos(gel.ray.a) * 70;
    const qy = gel.ray.y - Math.sin(gel.ray.a) * 70;

    const faisceau = ctx.createLinearGradient(qx, qy, gel.ray.x, gel.ray.y);
    faisceau.addColorStop(0, "rgba(180, 160, 255, 0)");
    faisceau.addColorStop(1, "rgba(235, 225, 255, .95)");
    ctx.strokeStyle = faisceau;
    ctx.lineWidth = RAYON_ULTI * 1.6;
    ctx.beginPath();
    ctx.moveTo(qx, qy);
    ctx.lineTo(gel.ray.x, gel.ray.y);
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(gel.ray.x, gel.ray.y, RAYON_ULTI * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
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

  if (etat.gel.par === etat.monId && !etat.gel.ray) {
    ctx.font = "700 15px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("CLIC pour tirer — " + etat.gel.r.toFixed(1) + " s", vue.l / 2, 126);
  }
}

/* --------------------------------------------------------------- viseur */

function viseur(ctx, souris, jeVise) {
  if (!souris) return;

  // Pendant sa propre ulti, le viseur ne sert plus à rien : c'est l'aiguille
  // qui décide. On le montre autrement pour éviter de croire qu'on vise.
  ctx.strokeStyle = jeVise ? "rgba(200, 185, 255, .35)" : "rgba(255,255,255,.55)";
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
