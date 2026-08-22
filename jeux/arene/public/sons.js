// ============================================================================
//  sons.js — la table de mixage du jeu.
//
//  Deux sources possibles pour chaque son :
//
//    1. TON fichier, dans public/sons/ (voir public/sons/README.md) ;
//    2. à défaut, une synthèse WebAudio générée à la volée.
//
//  Autrement dit : le jeu a du son dès maintenant, et chaque fichier que tu
//  déposes remplace automatiquement le son de secours correspondant. Rien à
//  déclarer, rien à recompiler — il suffit que le nom du fichier soit bon.
//
//  Le navigateur interdit de jouer un son avant que l'utilisateur ait cliqué :
//  tout démarre donc à `demarrer()`, appelé au clic sur « Entrer dans l'arène ».
// ============================================================================

// Les sons que le jeu sait jouer, et le son de secours à utiliser si le
// fichier correspondant n'existe pas.
export const SONS = [
  "tir",         // à chaque missile parti
  "impact",      // missile qui finit dans un mur
  "touche",      // missile qui touche quelqu'un
  "mort",        // je me fais éliminer
  "kill",        // j'élimine quelqu'un
  "soin",        // pastille de soin ramassée
  "bouclier",    // bouclier ramassé, ou bouclier qui encaisse
  "meteorite",   // une météorite entre dans l'arène
  "palier",      // arme améliorée
  "ulti",        // pause temporelle déclenchée
  "ulti-tir",    // le rayon part
  "ulti-touche", // le rayon a touché
  "ulti-rate",   // 1 tour et demi pour rien
  "flash",       // bond instantané
  "zone",        // champ de ralentissement invoqué

  // Séries de kills (multikill), façon LoL / Call of Duty — voir
  // FENETRE_MULTIKILL et NOMS_SERIE dans shared.js. Un fichier par palier,
  // du même nom que le libellé (en minuscules, tirets) : "double-kill.ogg"
  // remplace le "Double Kill" synthétisé, etc.
  "double-kill",
  "triple-kill",
  "quadra-kill",
  "penta-kill",
];

// L'ordre compte : on prend le premier format trouvé.
const EXTENSIONS = ["ogg", "mp3", "wav", "webm"];

let ctx = null;
let volumeGeneral = null;
const tampons = new Map(); // nom -> AudioBuffer (uniquement tes fichiers)
let actif = false;

/** Appelé au premier clic : c'est la seule façon d'avoir le droit au son. */
export async function demarrer() {
  if (ctx) return;

  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return; // navigateur sans WebAudio : le jeu marche, en silence

  ctx = new AC();
  volumeGeneral = ctx.createGain();
  volumeGeneral.gain.value = 0.6;
  volumeGeneral.connect(ctx.destination);
  actif = true;

  await Promise.all(SONS.map(charger));
}

export function couper(silence) {
  if (volumeGeneral) volumeGeneral.gain.value = silence ? 0 : 0.6;
  actif = !silence;
}

export function disponible() {
  return actif;
}

/** Combien de tes fichiers ont été trouvés — affiché dans l'aide du jeu. */
export function fichiersCharges() {
  return tampons.size;
}

/**
 * Essaie de charger `sons/<nom>.<ext>` pour chaque extension connue.
 * Un 404 n'est pas une erreur : il veut juste dire « pas encore enregistré ».
 */
async function charger(nom) {
  for (const ext of EXTENSIONS) {
    try {
      const reponse = await fetch(`sons/${nom}.${ext}`, { cache: "force-cache" });
      if (!reponse.ok) continue;

      const brut = await reponse.arrayBuffer();
      const tampon = await ctx.decodeAudioData(brut);
      tampons.set(nom, tampon);
      return;
    } catch {
      // fichier absent ou format refusé : on passe au suivant
    }
  }
}

/**
 * Joue un son.
 * @param {string} nom     un des noms de SONS
 * @param {number} volume  0 à 1 — sert à baisser ce qui se passe au loin
 */
export function jouer(nom, volume = 1) {
  if (!ctx || !actif) return;
  if (ctx.state === "suspended") ctx.resume();

  const tampon = tampons.get(nom);

  if (tampon) {
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.buffer = tampon;
    source.connect(gain).connect(volumeGeneral);
    source.start();
    return;
  }

  synthese(nom, volume);
}

/* ==========================================================================
   Les sons de secours, fabriqués à la main.

   Rien d'exotique : un oscillateur, une enveloppe qui descend, parfois un
   filtre. C'est le vocabulaire du son de jeu vidéo des années 80, et ça se
   remplace fichier par fichier quand tes enregistrements arrivent.
   ========================================================================== */

function enveloppe(duree, volume) {
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0001), t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
  g.connect(volumeGeneral);
  return g;
}

function bip({ de, vers, duree, type = "square", volume = 0.3 }) {
  const o = ctx.createOscillator();
  const t = ctx.currentTime;
  o.type = type;
  o.frequency.setValueAtTime(de, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(vers, 1), t + duree);
  o.connect(enveloppe(duree, volume));
  o.start(t);
  o.stop(t + duree + 0.02);
}

/**
 * Un oscillateur dont la fréquence tremble vite (vibrato) en même temps
 * qu'elle plonge : la texture "molle" qui distingue un bruit organique
 * d'un simple bip qui descend.
 */
function grognement({ de, vers, duree, volume = 0.3 }) {
  const o = ctx.createOscillator();
  const t = ctx.currentTime;
  o.type = "sawtooth";
  o.frequency.setValueAtTime(de, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(vers, 1), t + duree);

  const vibrato = ctx.createOscillator();
  const profondeur = ctx.createGain();
  vibrato.frequency.value = 55; // tremblement rapide : le grain "mou"
  profondeur.gain.value = de * 0.35;
  vibrato.connect(profondeur).connect(o.frequency);
  vibrato.start(t);
  vibrato.stop(t + duree + 0.02);

  o.connect(enveloppe(duree, volume));
  o.start(t);
  o.stop(t + duree + 0.02);
}

function souffle({ duree, coupure, volume = 0.35 }) {
  const taille = Math.floor(ctx.sampleRate * duree);
  const tampon = ctx.createBuffer(1, taille, ctx.sampleRate);
  const donnees = tampon.getChannelData(0);

  for (let i = 0; i < taille; i++) {
    // Bruit blanc qui s'éteint : la base de toute explosion.
    donnees[i] = (Math.random() * 2 - 1) * (1 - i / taille);
  }

  const source = ctx.createBufferSource();
  source.buffer = tampon;

  const filtre = ctx.createBiquadFilter();
  filtre.type = "lowpass";
  filtre.frequency.value = coupure;

  source.connect(filtre).connect(enveloppe(duree, volume));
  source.start();
}

/** Bruit filtré (l'humidité) + petit "flop" descendant (l'aplatissement). */
function squelch({ duree, coupure, volume = 0.3 }) {
  souffle({ duree, coupure, volume });
  bip({ de: 260, vers: 90, duree: duree * 0.7, type: "triangle", volume: volume * 0.55 });
}

/**
 * La résonance claire d'une vitre : deux tons sinusoïdaux aigus qui
 * s'éteignent vite, superposés au squelch mouillé. C'est ce qui distingue à
 * l'oreille "j'ai touché quelqu'un" de "j'ai fini dans un mur" — le mur reste
 * un squelch sourd, sans cette brillance.
 */
function verre({ duree = 0.12, volume = 0.2 } = {}) {
  bip({ de: 2600, vers: 2200, duree, type: "sine", volume });
  bip({ de: 4200, vers: 3600, duree: duree * 0.7, type: "sine", volume: volume * 0.5 });
}

function synthese(nom, volume) {
  switch (nom) {
    case "tir":
      // Le "prrt" du jet — un grognement bref plutôt qu'un bip laser.
      grognement({ de: 240, vers: 70, duree: 0.11, volume: 0.22 * volume });
      break;
    case "impact":
      // Le tas qui s'écrase sur un mur : sec, plus haut que "touche", sans
      // la résonance vitrée — un mur n'a rien de cristallin.
      squelch({ duree: 0.14, coupure: 1000, volume: 0.16 * volume });
      break;
    case "touche":
      // En pleine cible : le squelch mouillé, plus le "tink" de vitre qui
      // dit tout de suite qu'on a touché quelqu'un, pas juste un mur.
      squelch({ duree: 0.2, coupure: 650, volume: 0.24 * volume });
      verre({ duree: 0.14, volume: 0.16 * volume });
      break;
    case "mort":
      bip({ de: 420, vers: 60, duree: 0.55, type: "sawtooth", volume: 0.34 * volume });
      souffle({ duree: 0.4, coupure: 900, volume: 0.3 * volume });
      break;
    case "kill":
      // Deux notes qui montent : la petite récompense.
      bip({ de: 660, vers: 660, duree: 0.09, type: "triangle", volume: 0.25 * volume });
      setTimeout(() => actif && bip({ de: 990, vers: 990, duree: 0.14, type: "triangle", volume: 0.25 * volume }), 90);
      break;
    case "soin":
      bip({ de: 520, vers: 1040, duree: 0.22, type: "sine", volume: 0.24 * volume });
      break;
    case "bouclier":
      // Un « ting » métallique : quelque chose a rebondi.
      bip({ de: 1400, vers: 900, duree: 0.18, type: "triangle", volume: 0.22 * volume });
      break;
    case "meteorite":
      // Un grondement long et grave : ça arrive de loin.
      souffle({ duree: 1.2, coupure: 420, volume: 0.32 * volume });
      bip({ de: 90, vers: 40, duree: 1.1, type: "sine", volume: 0.22 * volume });
      break;
    case "palier":
      // Trois notes qui montent : l'arme change.
      bip({ de: 520, vers: 520, duree: 0.1, type: "triangle", volume: 0.24 * volume });
      setTimeout(() => actif && bip({ de: 660, vers: 660, duree: 0.1, type: "triangle", volume: 0.24 * volume }), 100);
      setTimeout(() => actif && bip({ de: 880, vers: 880, duree: 0.2, type: "triangle", volume: 0.26 * volume }), 200);
      break;
    case "ulti-tir":
      bip({ de: 1800, vers: 300, duree: 0.16, type: "sawtooth", volume: 0.3 * volume });
      break;
    case "ulti":
      // Descente lente : le temps qui se fige.
      bip({ de: 700, vers: 90, duree: 0.9, type: "sine", volume: 0.3 * volume });
      break;
    case "ulti-touche":
      bip({ de: 140, vers: 1200, duree: 0.5, type: "sawtooth", volume: 0.34 * volume });
      break;
    case "ulti-rate":
      bip({ de: 240, vers: 150, duree: 0.35, type: "triangle", volume: 0.2 * volume });
      break;
    case "flash":
      // Un « whoosh » très bref, montant : on part d'un coup.
      bip({ de: 300, vers: 1600, duree: 0.1, type: "sine", volume: 0.28 * volume });
      break;
    case "zone":
      // Un grondement sourd, court : quelque chose vient de s'ouvrir au sol.
      souffle({ duree: 0.3, coupure: 500, volume: 0.26 * volume });
      bip({ de: 220, vers: 90, duree: 0.28, type: "sawtooth", volume: 0.2 * volume });
      break;

    /* --------------------------------------------------------------------
       Séries de kills — chaque palier reprend l'idée de "kill" (des notes
       qui montent) mais en ajoute une de plus et en durcit le grain, pour
       qu'on sente la montée en gamme rien qu'à l'oreille, sans regarder
       l'écran.
       -------------------------------------------------------------------- */
    case "double-kill":
      bip({ de: 660, vers: 660, duree: 0.09, type: "triangle", volume: 0.28 * volume });
      setTimeout(() => actif && bip({ de: 880, vers: 880, duree: 0.09, type: "triangle", volume: 0.28 * volume }), 90);
      setTimeout(() => actif && bip({ de: 1100, vers: 1100, duree: 0.16, type: "triangle", volume: 0.3 * volume }), 180);
      break;

    case "triple-kill":
      bip({ de: 660, vers: 660, duree: 0.08, type: "triangle", volume: 0.28 * volume });
      setTimeout(() => actif && bip({ de: 830, vers: 830, duree: 0.08, type: "triangle", volume: 0.28 * volume }), 80);
      setTimeout(() => actif && bip({ de: 1046, vers: 1046, duree: 0.08, type: "triangle", volume: 0.3 * volume }), 160);
      setTimeout(() => actif && bip({ de: 1318, vers: 1318, duree: 0.2, type: "triangle", volume: 0.32 * volume }), 240);
      setTimeout(() => actif && verre({ duree: 0.16, volume: 0.16 * volume }), 240);
      break;

    case "quadra-kill":
      // Un peu de sawtooth en dessous, pour que ça pèse davantage qu'un
      // simple arpège de "kill" : quatre éliminations, ça se mérite.
      for (let i = 0; i < 4; i++) {
        setTimeout(() => actif && bip({
          de: 660 * Math.pow(1.26, i), vers: 660 * Math.pow(1.26, i),
          duree: i === 3 ? 0.24 : 0.09, type: "triangle", volume: (0.28 + i * 0.02) * volume,
        }), i * 80);
      }
      setTimeout(() => actif && grognement({ de: 180, vers: 90, duree: 0.3, volume: 0.14 * volume }), 0);
      break;

    case "penta-kill":
      // Le grand moment : un arpège rapide de cinq notes, une basse qui
      // gronde en dessous, et un éclat de verre à la fin — la plus longue et
      // la plus forte des cinq sonorités de série.
      for (let i = 0; i < 5; i++) {
        setTimeout(() => actif && bip({
          de: 523 * Math.pow(1.26, i), vers: 523 * Math.pow(1.26, i),
          duree: i === 4 ? 0.32 : 0.1, type: "triangle", volume: (0.3 + i * 0.02) * volume,
        }), i * 90);
      }
      grognement({ de: 130, vers: 65, duree: 0.6, volume: 0.22 * volume });
      setTimeout(() => actif && verre({ duree: 0.22, volume: 0.22 * volume }), 360);
      break;
  }
}
