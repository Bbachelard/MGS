// ============================================================================
//  public/client.js — réseau, état des écrans, entrées.
//
//  Un seul WebSocket, un seul état de partie en mémoire. Les fonctions de
//  dessin.js/rendu.js ne touchent le réseau nulle part — client.js est le
//  seul point de contact avec le serveur, et distribue les messages reçus
//  vers les bonnes fonctions d'affichage.
// ============================================================================

import { PHASES, JOUEURS_MIN, CATEGORIES_THEME } from "./shared.js";
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
let imagesStickersPlanche = null;

const ECRANS = {
  accueil: "ecran-accueil",
  lobby: "ecran-lobby",
  jeu: "ecran-jeu",
  "partie-finie": "ecran-partie-finie",
};

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

function masquerToutesLesZones() {
  ["zone-dessin", "zone-planche", "zone-vote", "zone-devinette", "zone-resultat-manche"].forEach((id) => {
    el(id).hidden = true;
  });
}

function envoyer(objet) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(objet));
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
      rendu.ajouterMessageChat(el("messages-chat"), msg);
      break;
    case "exclu":
      surExclu();
      break;
    case "erreur":
      surErreur(msg);
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
    el("reg-temps").value = msg.reglages.tempsParCase;
    el("reg-temps-val").textContent = msg.reglages.tempsParCase;
    el("reg-manches").value = msg.reglages.manches;
    el("reg-manches-val").textContent = msg.reglages.manches;
    el("cat-familial").checked = msg.reglages.categories.includes(CATEGORIES_THEME.FAMILIAL);
    el("cat-soiree").checked = msg.reglages.categories.includes(CATEGORIES_THEME.SOIREE);
    el("bouton-lancer").disabled = msg.joueurs.length < JOUEURS_MIN;
  }
}

const envoyerReglages = debounce(() => {
  envoyer({
    t: "reglages",
    cases: Number(el("reg-cases").value),
    tempsParCase: Number(el("reg-temps").value),
    manches: Number(el("reg-manches").value),
    categories: [
      ...(el("cat-familial").checked ? [CATEGORIES_THEME.FAMILIAL] : []),
      ...(el("cat-soiree").checked ? [CATEGORIES_THEME.SOIREE] : []),
    ],
  });
}, 150);

const envoyerCases = debounce(() => envoyer({ t: "cases", contenus: tousLesContenus() }), 400);

function surDebutManche(msg) {
  afficherEcran("jeu");
  masquerToutesLesZones();
  el("zone-dessin").hidden = false;
  el("jeu-titre-phase").textContent = "Dessin";
  el("jeu-manche").textContent = `Manche ${msg.manche}/${msg.totalManches}`;

  const astuce = el("astuce-theme");
  astuce.innerHTML = "";
  if (msg.theme) {
    astuce.append("Thème : ");
    const fort = document.createElement("strong");
    fort.textContent = msg.theme;
    astuce.appendChild(fort);
  } else {
    astuce.textContent = "Tu es l'imposteur : personne ne doit s'en douter. Improvise !";
  }

  rendu.demarrerMinuteur(msg.finPhase);
  chargerCases(msg.casesDeMoi, msg.contenusExistants || []);
}

function surRevelation(msg) {
  masquerToutesLesZones();
  el("zone-planche").hidden = false;
  el("jeu-titre-phase").textContent = "Révélation";
  const dessiner = () => rendu.afficherPlanche(el("grille-planche"), msg.planche, joueursParId, imagesStickersPlanche);
  if (imagesStickersPlanche) dessiner();
  else rendu.chargerImagesStickers().then((images) => { imagesStickersPlanche = images; dessiner(); });
}

function surVote(msg) {
  masquerToutesLesZones();
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
  masquerToutesLesZones();
  el("zone-devinette").hidden = false;
  el("jeu-titre-phase").textContent = "Dernière chance";
  el("champ-devinette").value = "";
  el("bouton-devinette").disabled = false;
  rendu.demarrerMinuteur(msg.finPhase);
}

function surResultatManche(msg) {
  masquerToutesLesZones();
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
  ["reg-cases", "reg-temps", "reg-manches"].forEach((id) => {
    el(id).addEventListener("input", (evt) => {
      el(id + "-val").textContent = evt.target.value;
      envoyerReglages();
    });
  });

  function brancherCategorie(id, autreId) {
    el(id).addEventListener("change", (evt) => {
      if (!evt.target.checked && !el(autreId).checked) {
        evt.target.checked = true; // au moins une catégorie doit rester active
        return;
      }
      envoyerReglages();
    });
  }
  brancherCategorie("cat-familial", "cat-soiree");
  brancherCategorie("cat-soiree", "cat-familial");

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
  brancherDevinette();
  brancherRejouer();
  await initEditeurDessin({ surModification: envoyerCases });
}

demarrer();
