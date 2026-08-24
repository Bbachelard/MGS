// ============================================================================
//  public/client.js — réseau, état des écrans, entrées.
//
//  Un seul WebSocket, un seul état de partie en mémoire. Les fonctions de
//  dessin.js/rendu.js ne touchent le réseau nulle part — client.js est le
//  seul point de contact avec le serveur, et distribue les messages reçus
//  vers les bonnes fonctions d'affichage.
// ============================================================================

import { PHASES, JOUEURS_MIN, CATEGORIES_THEME, CASE_LARGEUR, CASE_HAUTEUR } from "./shared.js";
import { initEditeurDessin, chargerCases, tousLesContenus } from "./dessin.js";
import * as rendu from "./rendu.js";

/* ==========================================================================
   État
   ========================================================================== */

let ws = null;
let monId = null;
let monJeton = null;
let salonActuel = "";
let dernierPseudo = "";
let ecranActuel = "accueil";
let dernierSalonState = { hote: null, joueurs: [] };
let joueursParId = new Map();

// Chargé en parallèle du reste dès le démarrage ; `imagesStickersPromise` se
// résout une seule fois, `imagesStickers` (sa valeur) sert aux gestionnaires
// d'évènements synchrones (clic sur une vignette) une fois le chargement fini
// — largement le cas avant qu'une vraie manche ne commence.
const imagesStickersPromise = rendu.chargerImagesStickers();
let imagesStickers = null;
imagesStickersPromise.then((images) => {
  imagesStickers = images;
});

let themeCourant = null; // null = je suis l'imposteur

// Tour de mise en route en cours.
let miseEnRoutePlanche = [];
let miseEnRouteIndexActif = -1;

let chatReplie = false;
let messagesNonLus = 0;

let hardDeverrouille = false; // la catégorie Hard a déjà été débloquée pour ce salon

const ECRANS = {
  accueil: "ecran-accueil",
  lobby: "ecran-lobby",
  jeu: "ecran-jeu",
  "partie-finie": "ecran-partie-finie",
};

const TOUTES_ZONES = [
  "zone-vignettes",
  "zone-spectateur",
  "zone-dessin",
  "zone-planche",
  "zone-vote",
  "zone-devinette",
  "zone-resultat-manche",
];

/* ==========================================================================
   Aides
   ========================================================================== */

function el(id) {
  return document.getElementById(id);
}

function cleJeton(salon) {
  return `bdbluff-jeton-${salon}`;
}

function debounce(fn, delai) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delai);
  };
}

function afficherEcran(nom) {
  ecranActuel = nom;
  for (const [cle, id] of Object.entries(ECRANS)) {
    el(id).hidden = cle !== nom;
  }
}

/** @param {string[]} sauf zones à laisser telles quelles (ex. la planche pendant le vote) */
function masquerToutesLesZones(sauf = []) {
  for (const id of TOUTES_ZONES) {
    if (!sauf.includes(id)) el(id).hidden = true;
  }
}

function envoyer(objet) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(objet));
}

function afficherAstuceTheme() {
  const astuce = el("astuce-theme");
  astuce.innerHTML = "";
  if (themeCourant) {
    astuce.append("Thème : ");
    const fort = document.createElement("strong");
    fort.textContent = themeCourant;
    astuce.appendChild(fort);
  } else {
    astuce.textContent = "Tu es l'imposteur : personne ne doit s'en douter. Improvise !";
  }
}

function dessinerSpectateur(contenu) {
  const canvas = el("canvas-spectateur");
  rendu.dessinerContenu(canvas.getContext("2d"), contenu || { traits: [], stickers: [] }, imagesStickers, {
    largeur: CASE_LARGEUR,
    hauteur: CASE_HAUTEUR,
  });
}

function redessinerVignettes() {
  rendu.afficherVignettes(el("vignettes-liste"), miseEnRoutePlanche, joueursParId, imagesStickers, miseEnRouteIndexActif, (index) => {
    const item = miseEnRoutePlanche.find((c) => c.index === index);
    if (item) rendu.ouvrirLoupe(item.contenu, imagesStickers, joueursParId.get(item.proprietaire)?.pseudo || "?");
  });
}

/* ==========================================================================
   Connexion
   ========================================================================== */

function connecterSalon(pseudo, salon) {
  salonActuel = salon;
  dernierPseudo = pseudo;
  const jetonExistant = localStorage.getItem(cleJeton(salon)) || "";
  const protocole = location.protocol === "https:" ? "wss:" : "ws:";
  // Chemin RELATIF à la page, pas à la racine du domaine : BDBluff est
  // proxifié en /bd/ (contrairement à un sous-domaine dédié), donc "/ws"
  // en dur pointerait à côté une fois derrière Apache. On garde tout
  // jusqu'au dernier "/" de l'URL courante (ex. "/bd/") et on y ajoute "ws".
  const base = location.pathname.replace(/[^/]*$/, "");
  const url =
    `${protocole}//${location.host}${base}ws?salon=${encodeURIComponent(salon)}` +
    `&nom=${encodeURIComponent(pseudo)}&jeton=${encodeURIComponent(jetonExistant)}`;

  ws = new WebSocket(url);
  ws.addEventListener("message", surMessageServeur);
  ws.addEventListener("close", surFermetureConnexion);
}

function surFermetureConnexion() {
  if (ecranActuel === "accueil") return; // fermeture volontaire (exclusion, erreur d'entrée)
  setTimeout(() => {
    if (salonActuel) connecterSalon(dernierPseudo, salonActuel);
  }, 2000);
}

function surMessageServeur(evt) {
  let msg;
  try {
    msg = JSON.parse(evt.data);
  } catch {
    return;
  }
  switch (msg.t) {
    case "bienvenue":
      surBienvenue(msg);
      break;
    case "salon":
      surSalon(msg);
      break;
    case "debutManche":
      surDebutManche(msg);
      break;
    case "tourMiseEnRoute":
      surTourMiseEnRoute(msg);
      break;
    case "miseEnRouteMaj":
      surMiseEnRouteMaj(msg);
      break;
    case "debutDessin":
      surDebutDessin(msg);
      break;
    case "revelation":
      surRevelation(msg);
      break;
    case "vote":
      surVote(msg);
      break;
    case "voteMaj":
      rendu.marquerVotants(el("liste-vote"), msg.votants);
      break;
    case "resultatVote":
      surResultatVote(msg);
      break;
    case "demandeDevinette":
      surDemandeDevinette(msg);
      break;
    case "resultatManche":
      surResultatManche(msg);
      break;
    case "resultatPartie":
      surResultatPartie(msg);
      break;
    case "chat":
      surChat(msg);
      break;
    case "exclu":
      surExclu();
      break;
    case "erreur":
      surErreur(msg);
      break;
    case "erreurReglages":
      surErreurReglages(msg);
      break;
    default:
      break;
  }
}

/* ==========================================================================
   Messages reçus
   ========================================================================== */

function surBienvenue(msg) {
  monId = msg.id;
  monJeton = msg.jeton;
  localStorage.setItem(cleJeton(salonActuel), monJeton);
  rendu.viderChat(el("messages-chat"));
  for (const entree of msg.chat || []) rendu.ajouterMessageChat(el("messages-chat"), entree);
}

function surSalon(msg) {
  dernierSalonState = msg;
  joueursParId = new Map(msg.joueurs.map((j) => [j.id, j]));

  if (msg.phase === PHASES.LOBBY) {
    afficherEcran("lobby");
    peuplerLobby(msg);
  } else if (msg.phase !== PHASES.RESULTATS_PARTIE) {
    afficherEcran("jeu");
    el("jeu-manche").textContent = `Manche ${msg.manche}/${msg.totalManches}`;
  }
}

function peuplerLobby(msg) {
  el("lobby-code").textContent = salonActuel;
  el("lobby-nb").textContent = String(msg.joueurs.length);
  el("lobby-note-min").hidden = msg.joueurs.length >= JOUEURS_MIN;

  const estHote = msg.hote === monId;

  const liste = el("liste-joueurs");
  liste.innerHTML = "";
  for (const j of msg.joueurs) {
    const li = document.createElement("li");
    const nom = document.createElement("span");
    nom.textContent = j.pseudo + (j.connecte ? "" : " (déconnecté)");
    if (!j.connecte) nom.classList.add("hors-ligne");
    if (j.id === msg.hote) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Hôte";
      nom.appendChild(badge);
    }
    li.appendChild(nom);
    if (estHote && j.id !== monId) {
      const bouton = document.createElement("button");
      bouton.type = "button";
      bouton.className = "exclure";
      bouton.textContent = "Exclure";
      bouton.addEventListener("click", () => envoyer({ t: "exclure", id: j.id }));
      li.appendChild(bouton);
    }
    liste.appendChild(li);
  }

  el("reglages-hote").hidden = !estHote;
  el("lobby-attente-hote").hidden = estHote;

  if (estHote) {
    el("reg-cases").value = msg.reglages.cases;
    el("reg-cases-val").textContent = msg.reglages.cases;
    el("reg-mise-en-route").value = msg.reglages.tempsMiseEnRoute;
    el("reg-mise-en-route-val").textContent = msg.reglages.tempsMiseEnRoute;
    el("reg-temps").value = msg.reglages.tempsParCase;
    el("reg-temps-val").textContent = msg.reglages.tempsParCase;
    el("reg-manches").value = msg.reglages.manches;
    el("reg-manches-val").textContent = msg.reglages.manches;
    el("cat-familial").checked = msg.reglages.categories.includes(CATEGORIES_THEME.FAMILIAL);
    el("cat-soiree").checked = msg.reglages.categories.includes(CATEGORIES_THEME.SOIREE);
    el("cat-hard").checked = msg.reglages.categories.includes(CATEGORIES_THEME.HARD);
    hardDeverrouille = msg.hardDeverrouille === true;
    // Le champ mot de passe ne sert que pour LA demande de déverrouillage :
    // une fois "hard" accepté par le serveur (dans msg.reglages.categories
    // ou hardDeverrouille), plus besoin de le montrer.
    el("ligne-mdp-hard").hidden = !el("cat-hard").checked || hardDeverrouille;
    el("bouton-lancer").disabled = msg.joueurs.length < JOUEURS_MIN;
  }
}

const envoyerReglages = debounce(() => {
  envoyer({
    t: "reglages",
    cases: Number(el("reg-cases").value),
    tempsMiseEnRoute: Number(el("reg-mise-en-route").value),
    tempsParCase: Number(el("reg-temps").value),
    manches: Number(el("reg-manches").value),
    categories: [
      ...(el("cat-familial").checked ? [CATEGORIES_THEME.FAMILIAL] : []),
      ...(el("cat-soiree").checked ? [CATEGORIES_THEME.SOIREE] : []),
      ...(el("cat-hard").checked ? [CATEGORIES_THEME.HARD] : []),
    ],
    motDePasseHard: el("mdp-hard").value,
  });
}, 150);

const envoyerCases = debounce(() => envoyer({ t: "cases", contenus: tousLesContenus() }), 400);

function surDebutManche(msg) {
  afficherEcran("jeu");
  el("jeu-manche").textContent = `Manche ${msg.manche}/${msg.totalManches}`;
  themeCourant = msg.theme;
}

function surTourMiseEnRoute(msg) {
  afficherEcran("jeu");
  miseEnRoutePlanche = msg.planche;
  miseEnRouteIndexActif = msg.index;

  masquerToutesLesZones();
  el("zone-vignettes").hidden = false;
  el("jeu-titre-phase").textContent = "Mise en route";
  rendu.demarrerMinuteur(msg.finTour);
  redessinerVignettes();

  if (msg.proprietaire === monId) {
    el("zone-dessin").hidden = false;
    afficherAstuceTheme();
    chargerCases([msg.index], []);
  } else {
    el("zone-spectateur").hidden = false;
    const pseudo = joueursParId.get(msg.proprietaire)?.pseudo || "?";
    el("spectateur-statut").textContent = `${pseudo} pose son premier trait — à toi de le regarder venir…`;
    const item = miseEnRoutePlanche.find((c) => c.index === msg.index);
    dessinerSpectateur(item?.contenu);
  }
}

function surMiseEnRouteMaj(msg) {
  const item = miseEnRoutePlanche.find((c) => c.index === msg.index);
  if (item) item.contenu = msg.contenu;
  if (msg.index === miseEnRouteIndexActif) dessinerSpectateur(msg.contenu);
  redessinerVignettes();
}

function surDebutDessin(msg) {
  masquerToutesLesZones();
  el("zone-dessin").hidden = false;
  el("jeu-titre-phase").textContent = "Dessin";
  afficherAstuceTheme();
  rendu.demarrerMinuteur(msg.finPhase);
  chargerCases(msg.casesDeMoi, msg.contenusExistants || []);
}

function surRevelation(msg) {
  masquerToutesLesZones();
  el("zone-planche").hidden = false;
  el("jeu-titre-phase").textContent = "Révélation";
  rendu.afficherPlanche(el("grille-planche"), msg.planche, joueursParId, imagesStickers, (index) => {
    const item = msg.planche.find((c) => c.index === index);
    if (item) rendu.ouvrirLoupe(item.contenu, imagesStickers, joueursParId.get(item.proprietaire)?.pseudo || "?");
  });
}

function surVote(msg) {
  // La planche reste affichée : seule une petite fenêtre de vote flottante s'ajoute.
  masquerToutesLesZones(["zone-planche"]);
  el("zone-vote").hidden = false;
  el("jeu-titre-phase").textContent = "Vote";
  rendu.demarrerMinuteur(msg.finPhase);
  rendu.afficherListeVote(el("liste-vote"), [...joueursParId.values()], monId, (cibleId) => {
    envoyer({ t: "vote", cible: cibleId });
    rendu.marquerChoixVote(el("liste-vote"), cibleId);
  });
}

function surResultatVote(msg) {
  const cible = msg.cible ? joueursParId.get(msg.cible)?.pseudo : null;
  let texte;
  if (msg.egalite) texte = "Égalité au vote : personne n'est démasqué.";
  else if (!cible) texte = "Vote non concluant : personne n'est démasqué.";
  else if (msg.demasque) texte = `${cible} est démasqué !`;
  else texte = `${cible} a été accusé à tort.`;
  rendu.ajouterMessageSysteme(el("messages-chat"), texte);
}

function surDemandeDevinette(msg) {
  masquerToutesLesZones(["zone-planche"]);
  el("zone-devinette").hidden = false;
  el("jeu-titre-phase").textContent = "Dernière chance";
  el("champ-devinette").value = "";
  el("bouton-devinette").disabled = false;
  rendu.demarrerMinuteur(msg.finPhase);
}

function surResultatManche(msg) {
  masquerToutesLesZones(["zone-planche"]);
  el("zone-resultat-manche").hidden = false;
  el("jeu-titre-phase").textContent = "Résultats";
  rendu.arreterMinuteur();

  const imposteurPseudo = joueursParId.get(msg.imposteur)?.pseudo || "?";
  const titre = el("resultat-titre");
  if (msg.imposteurGagne) {
    titre.textContent = `${imposteurPseudo} (l'imposteur) gagne la manche`;
    titre.className = "verdict-imposteur";
  } else {
    titre.textContent = `Les innocents gagnent la manche — ${imposteurPseudo} était l'imposteur`;
    titre.className = "verdict-innocents";
  }
  el("resultat-detail").textContent = `Le thème était : ${msg.theme}`;
  rendu.afficherScores(el("resultat-scores"), msg.scores, [...joueursParId.values()]);
}

function surResultatPartie(msg) {
  afficherEcran("partie-finie");
  rendu.afficherScores(el("classement-final"), msg.scores, [...joueursParId.values()]);
  const estHote = dernierSalonState.hote === monId;
  el("bouton-rejouer").hidden = !estHote;
  el("attente-hote-fin").hidden = estHote;
}

function surChat(msg) {
  rendu.ajouterMessageChat(el("messages-chat"), msg);
  if (chatReplie) {
    messagesNonLus++;
    rendu.majBadgeChat(messagesNonLus);
  }
}

function surExclu() {
  afficherEcran("accueil");
  el("erreur-accueil").hidden = false;
  el("erreur-accueil").textContent = "Tu as été exclu du salon.";
  salonActuel = "";
  ws?.close();
}

function surErreur(msg) {
  el("erreur-accueil").hidden = false;
  el("erreur-accueil").textContent = msg.message || "Une erreur est survenue.";
}

function surErreurReglages(msg) {
  el("erreur-mdp-hard").hidden = false;
  el("erreur-mdp-hard").textContent = msg.message || "Réglage refusé.";
  // Le prochain message "salon" fera de toute façon retomber la case Hard
  // à décochée (le serveur n'a pas accepté la catégorie) : pas besoin de
  // le faire ici, juste garder le mot de passe tapé pour une nouvelle tentative.
}

/* ==========================================================================
   Entrées
   ========================================================================== */

function brancherAccueil() {
  const params = new URLSearchParams(location.search);
  if (params.get("nom")) el("champ-pseudo").value = params.get("nom");
  if (params.get("salon")) el("champ-salon").value = params.get("salon");

  el("bouton-rejoindre").addEventListener("click", () => {
    const pseudo = el("champ-pseudo").value.trim() || "Anonyme";
    const salon = el("champ-salon").value.trim() || "principal";
    el("erreur-accueil").hidden = true;
    connecterSalon(pseudo, salon);
  });
}

function brancherLobby() {
  ["reg-cases", "reg-mise-en-route", "reg-temps", "reg-manches"].forEach((id) => {
    el(id).addEventListener("input", (evt) => {
      el(id + "-val").textContent = evt.target.value;
      envoyerReglages();
    });
  });

  const idsCategories = ["cat-familial", "cat-soiree", "cat-hard"];
  function brancherCategorie(id) {
    el(id).addEventListener("change", (evt) => {
      const plusAucuneCochee = idsCategories.every((autre) => !el(autre).checked);
      if (plusAucuneCochee) {
        evt.target.checked = true; // au moins une catégorie doit rester active
        return;
      }
      if (id === "cat-hard") {
        el("ligne-mdp-hard").hidden = !el("cat-hard").checked || hardDeverrouille;
        el("erreur-mdp-hard").hidden = true;
      }
      envoyerReglages();
    });
  }
  idsCategories.forEach(brancherCategorie);

  el("bouton-lancer").addEventListener("click", () => envoyer({ t: "lancer" }));
}

function brancherChat() {
  el("form-chat").addEventListener("submit", (evt) => {
    evt.preventDefault();
    const champ = el("champ-chat");
    const texte = champ.value.trim();
    if (!texte) return;
    envoyer({ t: "chat", texte });
    champ.value = "";
  });
}

function brancherJeuEntete() {
  el("bouton-plein-ecran").addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      // Refusé (iframe sans permission, navigateur récalcitrant…) : tant pis, pas bloquant.
    }
  });

  el("bouton-chat-toggle").addEventListener("click", () => {
    chatReplie = !chatReplie;
    el("ecran-jeu").classList.toggle("chat-replie", chatReplie);
    if (!chatReplie) {
      messagesNonLus = 0;
      rendu.majBadgeChat(0);
    }
  });
}

function brancherLoupe() {
  el("loupe-fermer").addEventListener("click", rendu.fermerLoupe);
  el("loupe").addEventListener("click", (evt) => {
    if (evt.target.id === "loupe") rendu.fermerLoupe();
  });
}

function brancherDevinette() {
  el("bouton-devinette").addEventListener("click", () => {
    const texte = el("champ-devinette").value.trim();
    if (!texte) return;
    envoyer({ t: "devinette", texte });
    el("bouton-devinette").disabled = true;
  });
}

function brancherRejouer() {
  el("bouton-rejouer").addEventListener("click", () => envoyer({ t: "rejouer" }));
}

/* ==========================================================================
   Démarrage
   ========================================================================== */

async function demarrer() {
  brancherAccueil();
  brancherLobby();
  brancherChat();
  brancherJeuEntete();
  brancherLoupe();
  brancherDevinette();
  brancherRejouer();
  await initEditeurDessin({ surModification: envoyerCases });
}

demarrer();
