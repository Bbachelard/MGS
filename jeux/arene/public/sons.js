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

function synthese(nom, volume) {
  switch (nom) {
    case "tir":
      bip({ de: 880, vers: 180, duree: 0.09, type: "square", volume: 0.16 * volume });
      break;
    case "impact":
      souffle({ duree: 0.13, coupure: 1400, volume: 0.18 * volume });
      break;
    case "touche":
      bip({ de: 320, vers: 120, duree: 0.12, type: "sawtooth", volume: 0.26 * volume });
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
  }
}
